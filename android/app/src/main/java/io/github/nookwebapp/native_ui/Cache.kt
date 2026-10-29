package io.github.nookwebapp.native_ui

import org.json.JSONObject
import java.io.File

// cacheRead() / cacheWrite() of app.js: small copies of what the server said last (profiles, the inbox, the newest
// messages of a chat, counts), so a page shows at once and is then brought up to date. Who follows whom and who liked
// or reposted what is only ever kept in memory, never written to the phone; everything else goes to one file,
// a moment after the last change.
object Cache {
    class Hit(val v: Any?, val t: Long)
    // who follows whom and who liked or reposted what: kept in memory only
    private fun memOnly(k: String) = k.startsWith("follows:") || k.startsWith("fl:") || k.startsWith("ids:") || k.startsWith("rpt:")
    // the file is written on its own thread, one write at a time
    private val writer = java.util.concurrent.Executors.newSingleThreadExecutor { r -> Thread(r, "nook-cache").apply { isDaemon = true } }
    private val mem = HashMap<String, Hit>()
    private val disk = LinkedHashMap<String, Hit>()
    private var file: File? = null
    private var dirty = false
    private val lock = Any()

    fun open(f: File) = synchronized(lock) {
        file = f
        disk.clear()
        runCatching {
            if (!f.exists()) return@runCatching
            val j = JSONObject(String(f.readBytes()))
            j.keys().forEach { k -> j.optJSONObject(k)?.let { o -> disk[k] = Hit(o.opt("v"), o.optLong("t")) } }
        }
    }

    fun read(k: String): Hit? = synchronized(lock) { if (memOnly(k)) mem[k] else disk[k] }

    fun fresh(k: String, ttl: Long): Any? = read(k)?.takeIf { System.currentTimeMillis() - it.t < ttl }?.v

    fun write(k: String, v: Any?) = synchronized(lock) {
        val h = Hit(v, System.currentTimeMillis())
        if (memOnly(k)) { mem[k] = h; return@synchronized }
        disk.remove(k); disk[k] = h
        // the oldest profiles go first when there are a lot of entries
        if (disk.size > 3000) disk.keys.filter { it.startsWith("acct:") }.take(disk.size - 2500).forEach { disk.remove(it) }
        dirty = true
    }

    fun remove(k: String) = synchronized(lock) { mem.remove(k); if (disk.remove(k) != null) dirty = true }

    // what belongs to one account (or every cached copy) leaves the phone with it
    fun drop(pred: (String) -> Boolean) = synchronized(lock) {
        mem.keys.filter(pred).forEach { mem.remove(it) }
        disk.keys.filter(pred).forEach { disk.remove(it) }
        dirty = true
    }
    fun clearMem() = synchronized(lock) { mem.clear() }

    fun flush() { writer.execute { flushNow() } }

    private fun flushNow() {
        val f: File; val txt: String
        synchronized(lock) {
            if (!dirty) return
            f = file ?: return
            val j = JSONObject()
            disk.forEach { (k, h) -> j.put(k, JSONObject().put("v", h.v ?: JSONObject.NULL).put("t", h.t)) }
            txt = j.toString(); dirty = false
        }
        runCatching { val tmp = File(f.parentFile, f.name + ".tmp"); tmp.writeText(txt); tmp.renameTo(f) }
    }
}
