package io.github.nookwebapp.native_ui

import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

// The voice of a call with Zenith: Gemini Live, spoken to directly from the phone. The Nook server makes a one use token (the key never
// reaches the phone) and the configuration (his voice, his instructions, the search tool); the microphone goes out as 16 kHz sound, his voice
// comes back as 24 kHz sound. The models are tried in order, a drop in the middle (the 15 minute limit of a connection) is picked up again with
// the saved handle of the conversation, and a search he asks for is done by the server (Tavily) and handed back.
class LiveEngine(private val app: AppState, private val s: CallSession) {
    private val main = Handler(Looper.getMainLooper())
    private fun ui(f: () -> Unit) { main.post(f) }

    @Volatile private var stopped = false
    // true from the moment the model said it is ready until the connection ends
    @Volatile private var open = false
    private var ws: WebSocket? = null
    private var modelIdx = 0
    private var modelName = ""
    @Volatile private var spoke = false
    private var models = 1
    private var resume: String? = null
    private var drops = 0
    // he says hello first, once: the person calling is not made to start the talk
    private var greeted = false

    private var rec: AudioRecord? = null
    private var track: AudioTrack? = null
    private var micThread: Thread? = null
    private var playThread: Thread? = null
    private val out = LinkedBlockingQueue<ByteArray>()
    private var audioOn = false
    private var oldMode = AudioManager.MODE_NORMAL
    private val am: AudioManager? get() = app.ctx?.getSystemService(AudioManager::class.java)

    // a turn of the captions that was finished: the next words of the same person start a new line
    private var closed = true
    // when the sound that was handed to the speaker will have been played: while it plays the microphone is not sent (on the speaker his own voice
    // would come back through it, be taken for the person talking, and stop him every two seconds)
    @Volatile private var playUntil = 0L

    fun start() { app.scope.launch(Dispatchers.IO) { connect() } }

    fun stop() {
        if (stopped) return
        stopped = true
        open = false
        runCatching { ws?.close(1000, "bye") }
        ws = null
        out.clear()
        // the threads see `stopped` and release the sound devices themselves; the audio mode goes back at once
        runCatching { micThread?.interrupt() }
        restoreAudio()
    }

    // the speaker button and the mute button call this
    fun route() { if (audioOn) setRoute() }

    private fun fail(why: String) {
        if (stopped) return
        ui { app.say(why); app.endCall(false) }
    }

    private suspend fun connect() {
        if (stopped) return
        val r = Sb.fn("zenith", JSONObject().put("action", "live").put("model", modelIdx).put("tz", java.util.TimeZone.getDefault().id).put("resume", resume ?: ""), timeoutS = 20)
        if (stopped) return
        models = r.body.optInt("models", models)
        modelName = r.body.optString("model")
        val tok = r.body.optString("token")
        val setup = r.body.optJSONObject("setup")
        if (!r.ok || !r.body.optBoolean("ok") || tok.isEmpty() || setup == null) {
            Log.w("nook", "live token failed " + r.status + " " + r.body.optString("why"))
            // another model; when none is left the call cannot start
            if (!open && modelIdx < models - 1) { modelIdx++; connect() } else fail(if (r.status == 0) "No connection. Try the call again" else "The call could not start" + r.body.optString("why").takeIf { it.isNotEmpty() }?.let { " (" + it.take(120) + ")" }.orEmpty())
            return
        }
        val client = Sb.http.newBuilder().readTimeout(0, TimeUnit.MILLISECONDS).pingInterval(20, TimeUnit.SECONDS).build()
        val url = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=" + URLEncoder.encode(tok, "UTF-8")
        open = false
        ws = client.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) { webSocket.send(JSONObject().put("setup", setup).toString()) }
            override fun onMessage(webSocket: WebSocket, text: String) = onText(webSocket, text)
            override fun onMessage(webSocket: WebSocket, bytes: ByteString) = onText(webSocket, bytes.utf8())
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(1000, null) }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { dropped(webSocket, code, reason) }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { dropped(webSocket, response?.code ?: -1, t.message ?: "") }
        })
    }

    // the connection ended: before it started the next model is tried, in the middle of the call the conversation is picked up again
    private fun dropped(w: WebSocket, code: Int, why: String) {
        if (stopped || w !== ws) return
        Log.w("nook", "live closed $code $why")
        if (!open) {
            if (modelIdx < models - 1) { modelIdx++; app.scope.launch(Dispatchers.IO) { connect() } } else fail("The call could not connect. Try again later")
            return
        }
        open = false
        if (resume != null && drops < 6) {
            drops++
            ui { s.phase = CallPhase.Reconnecting }
            app.scope.launch(Dispatchers.IO) { connect() }
        } else fail("The call dropped")
    }

    private fun onText(w: WebSocket, text: String) {
        if (stopped || w !== ws) return
        val j = runCatching { JSONObject(text) }.getOrNull() ?: return
        if (j.has("setupComplete")) { ready(); return }
        j.optJSONObject("sessionResumptionUpdate")?.let { u ->
            val h = u.optString("newHandle")
            if (h.isNotEmpty() && u.optBoolean("resumable", true)) resume = h
        }
        if (j.has("goAway")) { runCatching { w.close(1000, "go away") }; return }
        j.optJSONObject("toolCall")?.let { tool(it) }
        val sc = j.optJSONObject("serverContent") ?: return
        sc.optJSONObject("modelTurn")?.optJSONArray("parts")?.let { parts ->
            for (i in 0 until parts.length()) {
                val d = parts.optJSONObject(i)?.optJSONObject("inlineData") ?: continue
                if (d.optString("mimeType").startsWith("audio/")) speak(d.optString("data"))
            }
        }
        sc.optJSONObject("inputTranscription")?.optString("text")?.takeIf { it.isNotEmpty() }?.let { caption("You", it) }
        sc.optJSONObject("outputTranscription")?.optString("text")?.takeIf { it.isNotEmpty() }?.let { caption("Zenith", it) }
        if (sc.optBoolean("interrupted")) { flush(); ui { s.phase = CallPhase.Listening }; closed = true }
        if (sc.optBoolean("turnComplete")) { closed = true; ui { if (s.phase == CallPhase.Speaking || s.phase == CallPhase.Thinking) s.phase = CallPhase.Listening } }
    }

    private fun ready() {
        open = true
        startAudio()
        if (!greeted) {
            greeted = true
            hello(false)
            // when nothing was heard after a few seconds the other way of sending a text turn is tried (the models differ in which one they take)
            app.scope.launch(Dispatchers.IO) {
                kotlinx.coroutines.delay(4000)
                if (!stopped && open && !spoke) hello(true)
            }
        }
        ui { s.phase = CallPhase.Listening; s.live() }
    }

    // he speaks first. The newer models take a text turn as realtime input, the 2.5 ones as a turn of the conversation; `other` is the second try
    private fun hello(other: Boolean) {
        val text = "The call just connected. You speak first: say a quick casual hey, like a friend picking up the phone, nothing more, then wait."
        val asTurn = modelName.contains("2.5") != other
        val msg = if (asTurn) JSONObject().put("clientContent", JSONObject().put("turns", JSONArray().put(JSONObject().put("role", "user").put("parts", JSONArray().put(JSONObject().put("text", text))))).put("turnComplete", true))
        else JSONObject().put("realtimeInput", JSONObject().put("text", text))
        ws?.send(msg.toString())
        ui { if (s.phase == CallPhase.Listening) s.phase = CallPhase.Thinking }
    }

    // the words of the call, in the captions: chunks of the same person join into one line until a turn ends
    private fun caption(who: String, text: String) {
        // a guess in another alphabet (the noise of a microphone read as another language) is not shown
        if (text.any { it.isLetter() && Character.UnicodeScript.of(it.code) != Character.UnicodeScript.LATIN }) return
        val fresh = closed
        closed = false
        ui { s.say(who, text, fresh) }
    }

    private fun speak(b64: String) {
        if (b64.isEmpty()) return
        val pcm = runCatching { Base64.decode(b64, Base64.DEFAULT) }.getOrNull() ?: return
        spoke = true
        out.offer(pcm)
        val now = System.currentTimeMillis()
        playUntil = maxOf(playUntil, now) + pcm.size / 2 * 1000L / 24000
        ui { if (s.phase != CallPhase.Speaking) s.phase = CallPhase.Speaking }
    }

    private fun flush() {
        out.clear()
        playUntil = 0
        val t = track ?: return
        runCatching { t.pause(); t.flush(); t.play() }
    }

    // the model asked for a search: the server does it and the words found go back
    private fun tool(tc: JSONObject) {
        val calls = tc.optJSONArray("functionCalls") ?: return
        for (i in 0 until calls.length()) {
            val fc = calls.optJSONObject(i) ?: continue
            val id = fc.optString("id"); val name = fc.optString("name")
            val q = fc.optJSONObject("args")?.optString("query").orEmpty()
            ui { s.phase = CallPhase.Searching }
            app.scope.launch(Dispatchers.IO) {
                val r = if (name == "search" && q.isNotBlank()) Sb.fn("zenith", JSONObject().put("action", "search").put("query", q), timeoutS = 25) else null
                val text = r?.body?.optString("text")?.takeIf { it.isNotEmpty() } ?: "Searching is not possible right now. Tell the user you could not look it up."
                val resp = JSONObject().put("toolResponse", JSONObject().put("functionResponses", JSONArray().put(
                    JSONObject().put("id", id).put("name", name).put("response", JSONObject().put("result", text)))))
                if (!stopped) ws?.send(resp.toString())
                ui { if (s.phase == CallPhase.Searching) s.phase = CallPhase.Thinking }
            }
        }
    }

    // ---- sound ----

    private fun startAudio() {
        if (audioOn || stopped) return
        if (app.ctx == null) return
        runCatching {
            val a = am
            if (a != null) { oldMode = a.mode; a.mode = AudioManager.MODE_IN_COMMUNICATION }
            audioOn = true
            setRoute()

            val inRate = 16000
            val minIn = AudioRecord.getMinBufferSize(inRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
            val r = AudioRecord.Builder().setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
                .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(inRate).setChannelMask(AudioFormat.CHANNEL_IN_MONO).build())
                .setBufferSizeInBytes(maxOf(minIn, 3200 * 4)).build()
            // echo and noise removal, so he does not hear himself from the speaker
            if (AcousticEchoCanceler.isAvailable()) runCatching { AcousticEchoCanceler.create(r.audioSessionId)?.enabled = true }
            if (NoiseSuppressor.isAvailable()) runCatching { NoiseSuppressor.create(r.audioSessionId)?.enabled = true }
            rec = r

            val outRate = 24000
            val minOut = AudioTrack.getMinBufferSize(outRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
            val t = AudioTrack.Builder()
                .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(outRate).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                .setBufferSizeInBytes(maxOf(minOut, outRate / 2)).setTransferMode(AudioTrack.MODE_STREAM).build()
            track = t

            playThread = Thread {
                runCatching { t.play() }
                while (!stopped) {
                    val b = runCatching { out.poll(200, TimeUnit.MILLISECONDS) }.getOrNull() ?: continue
                    runCatching { t.write(b, 0, b.size) }
                }
                runCatching { t.stop() }; runCatching { t.release() }
            }.apply { name = "nook-call-out"; isDaemon = true; start() }

            micThread = Thread {
                val buf = ByteArray(3200)
                runCatching { r.startRecording() }
                while (!stopped) {
                    val n = runCatching { r.read(buf, 0, buf.size) }.getOrDefault(-1)
                    if (n <= 0) { if (n < 0) break else continue }
                    if (s.muted || !open) continue
                    // on the speaker the microphone waits while he talks (and a moment after); on the earpiece or a headset he can be interrupted
                    if (s.speaker && System.currentTimeMillis() < playUntil + 450) continue
                    val msg = "{\"realtimeInput\":{\"audio\":{\"data\":\"" + Base64.encodeToString(buf, 0, n, Base64.NO_WRAP) + "\",\"mimeType\":\"audio/pcm;rate=16000\"}}}"
                    ws?.send(msg)
                }
                runCatching { r.stop() }; runCatching { r.release() }
            }.apply { name = "nook-call-in"; isDaemon = true; start() }
        }.onFailure { Log.w("nook", "call audio failed", it); fail("The microphone could not start") }
    }

    // speaker or earpiece
    private fun setRoute() {
        val a = am ?: return
        val speaker = s.speaker
        runCatching {
            if (Build.VERSION.SDK_INT >= 31) {
                val want = if (speaker) AudioDeviceInfo.TYPE_BUILTIN_SPEAKER else AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
                a.availableCommunicationDevices.firstOrNull { it.type == want }?.let { a.setCommunicationDevice(it) }
            } else {
                @Suppress("DEPRECATION") a.isSpeakerphoneOn = speaker
            }
        }
    }

    private fun restoreAudio() {
        if (!audioOn) return
        audioOn = false
        val a = am ?: return
        runCatching { if (Build.VERSION.SDK_INT >= 31) a.clearCommunicationDevice() else @Suppress("DEPRECATION") { a.isSpeakerphoneOn = false } }
        runCatching { a.mode = oldMode }
    }
}
