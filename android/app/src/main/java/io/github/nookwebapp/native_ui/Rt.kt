package io.github.nookwebapp.native_ui

import android.os.Handler
import android.os.Looper
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject

// The live connection supabase-js keeps (Supabase Realtime, the Phoenix channel protocol): new rows of a table that
// concern this person (postgres_changes) and the small signals people send each other (broadcast: typing, deleted
// messages). One socket carries every channel; it reconnects by itself, a little later each time it fails.
object Rt {
    enum class St { SUBSCRIBED, CHANNEL_ERROR, TIMED_OUT, CLOSED }

    class Ch internal constructor(val name: String, val private: Boolean) {
        internal val changes = mutableListOf<Triple<String, String, String?>>() // table, event, filter
        internal val changeFns = mutableListOf<(JSONObject) -> Unit>()
        internal val casts = mutableMapOf<String, (JSONObject) -> Unit>()
        internal var onStatus: (St) -> Unit = {}
        internal var joinRef: String? = null
        internal var joined = false
        val topic get() = "realtime:$name"

        // .on("postgres_changes", { event, schema: "public", table, filter }, fn): fn gets the new row
        fun onInsert(table: String, filter: String?, fn: (JSONObject) -> Unit) = apply { changes.add(Triple(table, "INSERT", filter)); changeFns.add(fn) }
        // .on("broadcast", { event }, fn): fn gets the payload
        fun onBroadcast(event: String, fn: (JSONObject) -> Unit) = apply { casts[event] = fn }
        fun subscribe(fn: (St) -> Unit = {}) = apply { onStatus = fn; Rt.join(this) }
        fun send(event: String, payload: JSONObject) {
            if (!joined) return
            Rt.push(topic, "broadcast", JSONObject().put("type", "broadcast").put("event", event).put("payload", payload), joinRef)
        }
    }

    // the main thread runs every step of the connection; without one (tests off the phone) nothing is connected
    private val main: Handler? by lazy { (Looper.getMainLooper() ?: Looper.myLooper())?.let { Handler(it) } }
    private var ws: WebSocket? = null
    private var open = false
    private var ref = 0
    private val chans = mutableListOf<Ch>()
    private val pending = mutableMapOf<String, Ch>()
    private var backoff = 2000L
    private var beat: Runnable? = null
    private var retry: Runnable? = null

    fun channel(name: String, private: Boolean = false) = Ch(name, private)

    fun remove(ch: Ch?) {
        if (ch == null) return
        main?.post {
            if (chans.remove(ch) && ch.joined) push(ch.topic, "phx_leave", JSONObject(), ch.joinRef)
            ch.joined = false
            if (chans.isEmpty()) close()
        }
    }

    // every channel goes away and the socket closes (sign out, switching accounts)
    fun removeAll() = main?.post { chans.toList().forEach { it.joined = false }; chans.clear(); close() }

    // a renewed login is handed to every joined channel, so the server keeps sending to it
    fun token(t: String) = main?.post { chans.filter { it.joined }.forEach { push(it.topic, "access_token", JSONObject().put("access_token", t), it.joinRef) } }

    private fun join(ch: Ch) = main?.post {
        if (ch !in chans) chans.add(ch)
        if (!open) { connect(); return@post }
        sendJoin(ch)
    }

    private fun sendJoin(ch: Ch) {
        val tok = Sb.session?.access
        val pc = JSONArray()
        ch.changes.forEach { (t, e, f) -> pc.put(JSONObject().put("event", e).put("schema", "public").put("table", t).apply { if (f != null) put("filter", f) }) }
        val cfg = JSONObject()
            .put("broadcast", JSONObject().put("ack", false).put("self", false))
            .put("presence", JSONObject().put("key", "").put("enabled", false))
            .put("postgres_changes", pc).put("private", ch.private)
        val r = (++ref).toString()
        ch.joinRef = r
        pending[r] = ch
        push(ch.topic, "phx_join", JSONObject().put("config", cfg).apply { if (tok != null) put("access_token", tok) }, r, r)
        // a join nobody answers counts as timed out and is tried again with the next connection
        main?.postDelayed({ if (pending.remove(r) != null && !ch.joined) ch.onStatus(St.TIMED_OUT) }, 10_000)
    }

    internal fun push(topic: String, event: String, payload: JSONObject, joinRef: String?, r: String = (++ref).toString()) {
        val m = JSONObject().put("topic", topic).put("event", event).put("payload", payload).put("ref", r)
        if (joinRef != null) m.put("join_ref", joinRef)
        ws?.send(m.toString())
    }

    private fun connect() {
        if (ws != null) return
        val url = SB_URL.replace("https://", "wss://") + "/realtime/v1/websocket?apikey=$SB_KEY&vsn=1.0.0"
        ws = Sb.http.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) = main?.post {
                if (ws !== webSocket) return@post
                open = true; backoff = 2000
                chans.forEach { sendJoin(it) }
                heartbeat()
            }.let { }
            // the frame is parsed here, on OkHttp's thread; only what it holds is handed to the main thread
            override fun onMessage(webSocket: WebSocket, text: String) {
                val m = runCatching { JSONObject(text) }.getOrNull() ?: return
                main?.post { if (ws === webSocket) onMsg(m) }
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = main?.post { if (ws === webSocket) dropped(St.CHANNEL_ERROR) }.let { }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = main?.post { if (ws === webSocket) dropped(St.CLOSED) }.let { }
        })
    }

    private fun heartbeat() {
        beat?.let { main?.removeCallbacks(it) }
        val b = object : Runnable { override fun run() { if (!open) return; push("phoenix", "heartbeat", JSONObject(), null); main?.postDelayed(this, 25_000) } }
        beat = b
        main?.postDelayed(b, 25_000)
    }

    private fun dropped(st: St) {
        ws = null; open = false
        beat?.let { main?.removeCallbacks(it) }
        chans.forEach { if (it.joined) { it.joined = false; it.onStatus(st) } }
        pending.clear()
        if (chans.isEmpty()) return
        retry?.let { main?.removeCallbacks(it) }
        val r = Runnable { retry = null; if (chans.isNotEmpty()) connect() }
        retry = r
        main?.postDelayed(r, backoff)
        backoff = minOf(30_000, backoff * 2)
    }

    private fun close() {
        retry?.let { main?.removeCallbacks(it) }
        beat?.let { main?.removeCallbacks(it) }
        val w = ws
        ws = null; open = false; pending.clear()
        runCatching { w?.close(1000, null) }
    }

    private fun onMsg(m: JSONObject) {
        val topic = m.optString("topic"); val ev = m.optString("event"); val p = m.optJSONObject("payload") ?: JSONObject()
        if (ev == "phx_reply") {
            val ch = pending.remove(m.optString("ref")) ?: return
            if (p.optString("status") == "ok") { ch.joined = true; ch.onStatus(St.SUBSCRIBED) } else ch.onStatus(St.CHANNEL_ERROR)
            return
        }
        val ch = chans.firstOrNull { it.topic == topic } ?: return
        when (ev) {
            "postgres_changes" -> {
                val d = p.optJSONObject("data") ?: return
                val table = d.optString("table"); val type = d.optString("type")
                val rec = d.optJSONObject("record") ?: return
                ch.changes.forEachIndexed { i, (t, e, _) -> if (t == table && e == type) runCatching { ch.changeFns[i](rec) } }
            }
            "broadcast" -> { val e = p.optString("event"); val fn = ch.casts[e] ?: return; runCatching { fn(p.optJSONObject("payload") ?: JSONObject()) } }
            "phx_error" -> { ch.joined = false; ch.onStatus(St.CHANNEL_ERROR) }
            "phx_close" -> { ch.joined = false; ch.onStatus(St.CLOSED) }
            "system" -> if (p.optString("status") == "error") { ch.joined = false; ch.onStatus(St.CHANNEL_ERROR) }
        }
    }
}
