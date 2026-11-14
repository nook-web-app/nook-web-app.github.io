package io.github.nookwebapp.native_ui

import android.content.Context
import android.content.Intent
import android.media.AudioFormat
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

// Live captions of what the person says during a call, written on the phone while they talk (the model's own transcript of the voice only
// comes when a sentence is over). The phone's speech recognizer gets the same sound the call sends (lifted for a quiet voice) through a
// pipe, so it never opens the microphone a second time. Android 13 and newer; when the recognizer is missing or keeps failing, the
// captions come from the model as before.
class LocalCaptions(private val ctx: Context, private val onText: (String, Boolean) -> Unit) {
    private val main = Handler(Looper.getMainLooper())
    private val q = LinkedBlockingQueue<ByteArray>(80)
    private var rec: SpeechRecognizer? = null
    @Volatile private var out: ParcelFileDescriptor.AutoCloseOutputStream? = null
    @Volatile private var stopped = false
    // true once it wrote anything: from then on the model's transcript of the person is not shown
    @Volatile var working = false
    private var fails = 0
    private var writer: Thread? = null

    fun start() {
        if (Build.VERSION.SDK_INT < 33) return
        writer = Thread {
            while (!stopped) {
                val b = runCatching { q.poll(300, TimeUnit.MILLISECONDS) }.getOrNull() ?: continue
                // a pipe nobody reads any more is dropped, the next session opens a new one
                runCatching { out?.write(b) }.onFailure { out = null }
            }
        }.apply { name = "nook-captions"; isDaemon = true; start() }
        main.post { open() }
    }

    fun feed(b: ByteArray, n: Int) { if (!stopped && writer != null) q.offer(b.copyOf(n)) }

    private fun open() {
        if (stopped || Build.VERSION.SDK_INT < 33) return
        val r = runCatching {
            when {
                SpeechRecognizer.isOnDeviceRecognitionAvailable(ctx) -> SpeechRecognizer.createOnDeviceSpeechRecognizer(ctx)
                SpeechRecognizer.isRecognitionAvailable(ctx) -> SpeechRecognizer.createSpeechRecognizer(ctx)
                else -> null
            }
        }.getOrNull() ?: return
        val pipe = runCatching { ParcelFileDescriptor.createPipe() }.getOrNull() ?: return
        out = ParcelFileDescriptor.AutoCloseOutputStream(pipe[1])
        val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US")
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, pipe[0])
            putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1)
            putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
            putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, 16000)
            // one long session that keeps going and hands over each finished piece
            putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_AUDIO_SOURCE)
        }
        fun first(b: Bundle?) = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()
        r.setRecognitionListener(object : RecognitionListener {
            override fun onPartialResults(b: Bundle?) { val t = first(b); if (t.isNotEmpty()) { working = true; fails = 0; onText(t, false) } }
            override fun onSegmentResults(b: Bundle) { val t = first(b); if (t.isNotEmpty()) { working = true; fails = 0; onText(t, true) } }
            override fun onResults(b: Bundle?) { val t = first(b); if (t.isNotEmpty()) { working = true; onText(t, true) }; again(300) }
            override fun onEndOfSegmentedSession() { again(300) }
            override fun onError(error: Int) { fails++; if (fails > 6 && !working) stop() else again(if (fails > 3) 2000L else 400L) }
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        runCatching { r.startListening(i) }.onFailure { runCatching { r.destroy() }; return }
        rec = r
        runCatching { pipe[0].close() }
    }

    private fun again(ms: Long) {
        main.post {
            runCatching { rec?.destroy() }; rec = null
            runCatching { out?.close() }; out = null
            if (!stopped) main.postDelayed({ open() }, ms)
        }
    }

    fun stop() {
        stopped = true
        writer?.interrupt()
        main.post { runCatching { rec?.destroy() }; rec = null; runCatching { out?.close() }; out = null }
    }
}
