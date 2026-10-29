package io.github.nookwebapp.native_ui

import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.io.File

// Finds out why the app sometimes stops answering: a helper thread asks the main thread for a sign of life every second, and
// when none comes for 3 seconds while the app is open, it writes down where the main thread is stuck (its call stack). The
// notes are kept on the phone and sent to the account's own private storage on the next start, where the developer can read them.
object Stall {
    @Volatile private var beat = System.currentTimeMillis()
    private var dir: File? = null
    private var started = false

    fun start(d: File) {
        if (started) return
        started = true
        dir = File(d, "stalls").apply { mkdirs() }
        val main = Handler(Looper.getMainLooper())
        val tick = Runnable { beat = System.currentTimeMillis() }
        Thread {
            var noted = false
            while (true) {
                try { Thread.sleep(1000) } catch (e: InterruptedException) { return@Thread }
                main.post(tick)
                val late = System.currentTimeMillis() - beat
                if (late > 3000 && AppState.current?.foreground == true) {
                    if (!noted) { noted = true; note(late) }
                } else if (late < 1500) noted = false
            }
        }.apply { isDaemon = true; name = "nook-stall" }.start()
    }

    private fun note(late: Long) {
        val d = dir ?: return
        runCatching {
            val sb = StringBuilder("the main thread did not answer for ").append(late).append(" ms\nversion ").append(APP_VERSION).append("\n\nmain:\n")
            Looper.getMainLooper().thread.stackTrace.forEach { sb.append("  at ").append(it).append('\n') }
            // what the other threads of the app were doing meanwhile (names only with the first lines)
            Thread.getAllStackTraces().forEach { (t, st) ->
                if (t.name != "main" && st.isNotEmpty() && (t.name.startsWith("OkHttp") || t.name.startsWith("DefaultDispatcher") || t.name.startsWith("pool") || t.name.startsWith("Thread")))
                    sb.append("\n").append(t.name).append(":\n").also { st.take(8).forEach { f -> sb.append("  at ").append(f).append('\n') } }
            }
            File(d, "stall-" + System.currentTimeMillis() + ".txt").writeText(sb.toString().take(12000))
            d.listFiles()?.sortedBy { it.lastModified() }?.dropLast(5)?.forEach { it.delete() }
        }
    }

    // the notes of earlier stalls go to this account's private Zenith storage (only the owner can read it), then are removed
    suspend fun send(on: Online) {
        val d = dir ?: return
        val me = on.uid ?: return
        val files = d.listFiles()?.filter { it.name.endsWith(".txt") } ?: return
        for (f in files) {
            val r = Sb.upsert("zenith_docs", JSONObject().put("owner_id", me).put("kind", "debug").put("doc_id", f.nameWithoutExtension).put("data", JSONObject().put("text", f.readText())).put("updated_at", isoNow()), "owner_id,kind,doc_id")
            if (r.ok) f.delete()
        }
    }
}
