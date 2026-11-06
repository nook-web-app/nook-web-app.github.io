package io.github.nookwebapp.native_ui

import android.content.ContentValues
import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.TimeUnit

// "/media <link>" in a notes chat: the card of a video, gif or picture of YouTube, Instagram, TikTok or X, with a button that saves it on this
// phone. Everything runs on the phone itself (its own connection, nothing goes through the server); only the card (the link,
// the title, the picture and the size) is kept in the note and synced, the video is downloaded where the button is pressed.
object MediaGrab {
    class Fail(msg: String) : Exception(msg)
    class Info(val site: String, val title: String, val author: String, val thumb: String?, val dur: Int, val kind: String, val size: Long = 0)
    // one file (picture and sound together), or a picture file with a sound file that are joined on the phone ("audio");
    // "plain" is the one-piece file of a lower quality to fall back to when the pieces cannot be joined
    class Src(val url: String, val mime: String, val ext: String, val headers: Map<String, String> = emptyMap(), val audio: String? = null, val webm: Boolean = false, val plain: Src? = null, val size: Long = 0, val asize: Long = 0, val altAudio: List<YtExtract.Part> = emptyList())
    // one file of a post (a post can hold several: every one gets its own card)
    class Item(val info: Info, val src: Src)

    private val X_POST = Regex("^https?://(?:www\\.|mobile\\.)?(?:x|twitter)\\.com/([^/?#]+)/status(?:es)?/(\\d{1,20})", RegexOption.IGNORE_CASE)
    private val IG_POST = Regex("^https?://(?:www\\.)?instagram\\.com/(?:[\\w.]+/)?(p|reel|reels|tv)/([\\w-]+)", RegexOption.IGNORE_CASE)
    private val TT = Regex("^https?://(?:www\\.|m\\.|vm\\.|vt\\.)?tiktok\\.com/\\S+", RegexOption.IGNORE_CASE)
    private val YT_ID = Regex("(?:youtube\\.com/(?:watch\\?(?:.*&)?v=|shorts/|embed/|live/)|youtu\\.be/)([\\w-]{6,})", RegexOption.IGNORE_CASE)
    private val WEB = Regex("^https://[^/\\s]+\\.[^/\\s]+", RegexOption.IGNORE_CASE)
    private val CMD = Regex("^/media(?:\\s+/(4k|2k|1080p|720p))?((?:\\s+\\S+)*)\\s*$", RegexOption.IGNORE_CASE)
    private const val DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    private const val BOT = "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)"

    // the default of 5 connections to one host would hold back the pieces of a download: 16 may run together
    private val http: OkHttpClient = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).followRedirects(true)
        .addNetworkInterceptor { chain ->
            // every hop (the first request and each redirect) is checked at the address it really connects to
            val route = chain.connection()?.route()
            val ip = route?.takeIf { it.proxy.type() == java.net.Proxy.Type.DIRECT }?.socketAddress?.address
            if (ip != null && isPrivate(ip)) throw java.io.IOException("That address is not allowed")
            chain.proceed(chain.request())
        }
        .dispatcher(okhttp3.Dispatcher().apply { maxRequests = 64; maxRequestsPerHost = 16 }).build()
    // loopback, link-local, site-local, unique-local, shared and any-local addresses are never fetched
    private fun isPrivate(a: java.net.InetAddress): Boolean {
        if (a.isAnyLocalAddress || a.isLoopbackAddress || a.isLinkLocalAddress || a.isSiteLocalAddress || a.isMulticastAddress) return true
        val b = a.address
        return when (b.size) {
            16 -> (b[0].toInt() and 0xFE) == 0xFC
            4 -> (b[0].toInt() and 0xFF) == 100 && (b[1].toInt() and 0xC0) == 64
            else -> false
        }
    }
    // a hard limit for any download
    private const val MAX_FILE = 2_000_000_000L
    private val still: OkHttpClient = http.newBuilder().followRedirects(false).build()

    // the link of a "/media" message: null when the text is not that command, "" when the link is missing
    fun command(text: String): String? = CMD.find(text.trim())?.let { it.groupValues[2].trim().split(Regex("\\s+"))[0] }
    // every link of a "/media" message (several links may be pasted at once); empty when none; null when the text is not that command
    fun commandLinks(text: String): List<String>? {
        val rest = CMD.find(text.trim())?.groupValues?.get(2) ?: AUD.find(text.trim())?.groupValues?.get(1) ?: return null
        return rest.trim().split(Regex("\\s+")).filter { it.isNotEmpty() && !FOLDER.matches(it) }.distinct().take(10)
    }
    // "/folder/download": where the file goes (download, music, movies, pictures or dcim); "" when none was typed, so the usual folder of its kind is used
    private val FOLDER = Regex("^/folder/(\\w+)$", RegexOption.IGNORE_CASE)
    fun folder(text: String): String = text.trim().split(Regex("\\s+")).firstNotNullOfOrNull { FOLDER.find(it)?.groupValues?.get(1)?.lowercase() }?.let { ALIAS[it] ?: it }?.takeIf { it in FOLDERS || it == "default" } ?: ""
    private val ALIAS = mapOf("downloads" to "download", "video" to "movies", "videos" to "movies", "picture" to "pictures", "photos" to "pictures", "audio" to "music")
    // "/media/folder/download" (no space) is the same as "/media /folder/download"
    // links pasted with no space between them (or right after the command) are told apart too: a space goes in front of every "http://" or
    // "https://" that follows something other than a space or a link's own "=", "?", "&", ":" or "%" (as in "?u=https://...")
    private val GLUED = Regex("(?<=[^\\s=?&:%])(?=https?://)", RegexOption.IGNORE_CASE)
    fun normalize(text: String): String {
        val t = text.trim().replace(Regex("^/(media|audio)(?=/)", RegexOption.IGNORE_CASE)) { "/" + it.groupValues[1] + " " }
        // only a command is touched, never an ordinary message
        return if (Regex("^/(media|audio)(?![\\w])", RegexOption.IGNORE_CASE).containsMatchIn(t) || Regex("^/(media|audio)(?=https?://)", RegexOption.IGNORE_CASE).containsMatchIn(t)) t.replace(GLUED, " ") else t
    }
    // the folder kept for later: typed once as "/media /folder/download" (no link), used by every download after it ("/folder/default" clears it)
    fun defaultFolder(ctx: Context, audio: Boolean): String = ctx.getSharedPreferences("mdl", 0).getString(if (audio) "folder_audio" else "folder_media", "").orEmpty()
    fun setDefaultFolder(ctx: Context, audio: Boolean, folder: String) { ctx.getSharedPreferences("mdl", 0).edit().putString(if (audio) "folder_audio" else "folder_media", if (folder == "default") "" else folder).apply() }
    val FOLDERS = setOf("download", "music", "movies", "pictures", "dcim")
    // the place in the phone's shared storage: the usual folder of the kind of file (Movies, Pictures, Music, with no folder of our own),
    // or the one that was asked for when that kind of file may go there (else the usual one); "download" takes any kind
    private fun target(kind: String, folder: String): Triple<Uri, String, String> {
        val d = when (kind) { "audio" -> Environment.DIRECTORY_MUSIC; "image" -> Environment.DIRECTORY_PICTURES; else -> Environment.DIRECTORY_MOVIES }
        val col = when (kind) { "audio" -> MediaStore.Audio.Media.EXTERNAL_CONTENT_URI; "image" -> MediaStore.Images.Media.EXTERNAL_CONTENT_URI; else -> MediaStore.Video.Media.EXTERNAL_CONTENT_URI }
        if (Build.VERSION.SDK_INT >= 29 && folder == "download") return Triple(MediaStore.Downloads.EXTERNAL_CONTENT_URI, Environment.DIRECTORY_DOWNLOADS, "Download")
        val want = when (folder) { "music" -> Environment.DIRECTORY_MUSIC; "movies" -> Environment.DIRECTORY_MOVIES; "pictures" -> Environment.DIRECTORY_PICTURES; "dcim" -> Environment.DIRECTORY_DCIM; else -> d }
        val ok = when (kind) { "audio" -> want == Environment.DIRECTORY_MUSIC; "image" -> want == Environment.DIRECTORY_PICTURES || want == Environment.DIRECTORY_DCIM; else -> want == Environment.DIRECTORY_MOVIES || want == Environment.DIRECTORY_DCIM || want == Environment.DIRECTORY_PICTURES }
        val dir = if (ok) want else d
        return Triple(col, dir, dir)
    }
    // "/audio link": only the sound of the video is saved
    private val AUD = Regex("^/audio((?:\\s+\\S+)*)\\s*$", RegexOption.IGNORE_CASE)
    fun isAudio(text: String) = AUD.containsMatchIn(text.trim())
    // the size asked for in "/media /2k link": "4k", "2k", "1080p" or "720p"; "" when none was typed
    fun quality(text: String): String = CMD.find(text.trim())?.groupValues?.get(1)?.lowercase().orEmpty()
    // the tallest picture each size allows (only YouTube has sizes; without one it is 2K at 60 pictures a second, the top is 4K at 30)
    fun maxHeight(q: String) = when (q) { "4k" -> 2160; "1080p" -> 1080; "720p" -> 720; else -> 1440 }
    // the name of the site as the link would show it
    fun domain(site: String, url: String = "") = when (site) { "x" -> "x.com"; "youtube" -> "youtube.com"; "tiktok" -> "tiktok.com"; "web" -> host(url).ifEmpty { "link" }; else -> "instagram.com" }

    // "x", "youtube", "instagram" or "tiktok"; null for any other link
    fun site(url: String): String? = when {
        X_POST.containsMatchIn(url) -> "x"
        YT_ID.containsMatchIn(url) -> "youtube"
        IG_POST.containsMatchIn(url) -> "instagram"
        TT.containsMatchIn(url) -> "tiktok"
        // any other web link: the page (or the file itself) is read for what it holds
        url.length < 600 && WEB.containsMatchIn(url) -> "web"
        else -> null
    }
    fun host(url: String) = runCatching { java.net.URI(url).host.orEmpty().removePrefix("www.") }.getOrDefault("")
    fun siteName(site: String, url: String = "") = when (site) { "x" -> "X"; "youtube" -> "YouTube"; "tiktok" -> "TikTok"; "web" -> host(url).ifEmpty { "Web" }; else -> "Instagram" }

    // the cards and the addresses of the files of a post, worked out together (the address of a file runs out, so it is asked again at
    // download); a post with several pictures or videos gives one item for each, and every item gets its card at once
    // light: only the addresses of the files (a download needs no picture and no size of the card, which cost seconds)
    suspend fun resolveAll(url: String, q: String = "", light: Boolean = false): List<Item> = withContext(Dispatchers.IO) {
        val raw = rawItems(url, q)
        if (light) return@withContext raw.map { (i, s) -> Item(i, s) }
        kotlinx.coroutines.coroutineScope { raw.map { (i, s) -> async { finish(i, s, q) } }.awaitAll() }
    }
    // what a link gave a moment ago (the card and the download of the same link share it, so a tap on Download starts at once)
    private val resolved = java.util.concurrent.ConcurrentHashMap<String, Pair<Long, List<Pair<Info, Src>>>>()
    private fun rawItems(url: String, q: String): List<Pair<Info, Src>> {
        val key = "$url|$q"
        resolved[key]?.let { (t, v) -> if (System.currentTimeMillis() - t < 4 * 60_000L) return v }
        if (resolved.size > 30) resolved.clear()
        return rawItemsFresh(url, q).also { resolved[key] = System.currentTimeMillis() to it }
    }
    private fun rawItemsFresh(url: String, q: String): List<Pair<Info, Src>> {
        return when (site(url)) {
            "x" -> X_POST.find(url)!!.let { xResolve(it.groupValues[1], it.groupValues[2]) }
            "youtube" -> listOf(ytResolve(YT_ID.find(url)!!.groupValues[1], q))
            "instagram" -> igResolve(IG_POST.find(url)!!.let { it.groupValues[1] to it.groupValues[2] })
            "tiktok" -> ttResolve(url)
            "web" -> webResolve(url)
            else -> throw Fail(if (url.startsWith("https://")) "That link is too long" else "Use a link that starts with https://")
        }
    }
    suspend fun resolve(url: String, q: String = ""): Pair<Info, Src> = resolveAll(url, q).first().let { it.info to it.src }

    // the size of the file (or of both pieces) and the picture of the card: the first frame of a video (a picture is shrunk), so no
    // link is left without a preview, even when the site gives none or its picture cannot be loaded later
    private suspend fun finish(info: Info, src: Src, q: String = ""): Item = kotlinx.coroutines.coroutineScope {
        val size = async { sizeFor(info, src) }
        val own = info.thumb?.takeIf { info.site == "youtube" }
        // the picture a mirror gives for an Instagram video has a play button drawn in it: it is not used
        val dur = IntArray(1)
        val thumb = async { own ?: preview(src, info.kind, dur) ?: info.thumb?.takeIf { !(info.site == "instagram" && info.kind == "video") } }
        val pic = thumb.await()
        val secs = if (info.dur > 0) info.dur else dur[0]
        // /audio: the size shown is the one of the mp3 that will be made (192 kbit a second is 24000 bytes), not the one of the video
        val shown = if (q == "audio" && info.kind != "image" && secs > 0) secs * 24_000L + 70_000L else size.await()
        Item(Info(info.site, info.title, info.author, pic, secs, info.kind, shown), src)
    }

    // the size of the file (or of both pieces): the one the site gave, else asked for (both pieces together)
    private suspend fun sizeFor(info: Info, src: Src): Long = kotlinx.coroutines.coroutineScope {
        if (info.size > 0) return@coroutineScope info.size
        if (src.size > 0) return@coroutineScope src.size + src.asize
        val v = async { sizeOf(src.url, src.headers) }
        val a = async { src.audio?.let { sizeOf(it, src.headers) } ?: 0L }
        v.await() + a.await()
    }

    // a small picture (a data address, so it goes with the note) from the file of an item, null when it cannot be read
    private fun preview(src: Src, kind: String, durOut: IntArray? = null): String? = runCatching {
        var bm: android.graphics.Bitmap? = null
        if (kind == "image") {
            val b = Request.Builder().url(src.url).header("User-Agent", DESKTOP).apply { src.headers.forEach { (k, v) -> header(k, v) } }.build()
            val data = http.newCall(b).execute().use { r -> if (!r.isSuccessful) null else r.body?.source()?.let { s -> s.request(12_000_001); if (s.buffer.size > 12_000_000) null else s.buffer.readByteArray() } }
            bm = data?.let { android.graphics.BitmapFactory.decodeByteArray(it, 0, it.size) }
        } else {
            val r = android.media.MediaMetadataRetriever()
            var tmpFile: File? = null
            try {
                if (kind == "gif") {
                    // a gif is a few hundred kilobytes: it is read from a file, which every phone can do
                    val f = File.createTempFile("frame", ".mp4"); tmpFile = f
                    download(src.url, src.headers, f, 8_000_000L) { }
                    r.setDataSource(f.path)
                    bm = r.getFrameAtTime(0, android.media.MediaMetadataRetriever.OPTION_CLOSEST_SYNC) ?: r.getFrameAtTime(0)
                } else {
                    bm = runCatching {
                        // the phone's own reader does not pass the client above: the address is checked first
                        if (java.net.InetAddress.getAllByName(java.net.URI(src.url).host).any { isPrivate(it) }) throw Fail("That address is not allowed")
                        r.setDataSource(src.url, HashMap(src.headers + ("User-Agent" to DESKTOP)))
                        durOut?.set(0, ((r.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L) / 1000).toInt())
                        r.getFrameAtTime(0, android.media.MediaMetadataRetriever.OPTION_CLOSEST_SYNC) ?: r.getFrameAtTime(0)
                    }.getOrNull()
                    // read from the web it failed: the file is fetched (when it is not huge) and read from the phone instead
                    if (bm == null && (src.size <= 0 || src.size < 40_000_000)) {
                        val f = File.createTempFile("frame", ".mp4"); tmpFile = f
                        download(src.url, src.headers, f, 40_000_000L) { }
                        val r2 = android.media.MediaMetadataRetriever()
                        try { r2.setDataSource(f.path); durOut?.set(0, ((r2.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L) / 1000).toInt()); bm = r2.getFrameAtTime(0, android.media.MediaMetadataRetriever.OPTION_CLOSEST_SYNC) ?: r2.getFrameAtTime(0) } finally { runCatching { r2.release() } }
                    }
                }
            } finally { runCatching { r.release() }; tmpFile?.delete() }
        }
        val b = bm ?: return@runCatching null
        val w = minOf(400, b.width); val h = (b.height * (w.toFloat() / b.width)).toInt().coerceAtLeast(1)
        val sc = if (w == b.width) b else android.graphics.Bitmap.createScaledBitmap(b, w, h, true)
        val out = java.io.ByteArrayOutputStream()
        sc.compress(android.graphics.Bitmap.CompressFormat.JPEG, 70, out)
        if (out.size() > 60_000) null else "data:image/jpeg;base64," + android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP)
    }.getOrNull()

    // what kind of file an address holds: its type as the server says it
    private fun typeOf(url: String): String = runCatching {
        http.newCall(Request.Builder().url(url).header("User-Agent", BOT).header("Range", "bytes=0-0").build()).execute().use { it.header("Content-Type").orEmpty() }
    }.getOrDefault("")

    private fun get(url: String, headers: Map<String, String> = emptyMap(), ua: String = DESKTOP): String {
        val b = Request.Builder().url(url).header("User-Agent", ua)
        headers.forEach { (k, v) -> b.header(k, v) }
        http.newCall(b.build()).execute().use { r ->
            if (!r.isSuccessful) throw Fail("The site answered " + r.code)
            return r.body?.source()?.let { s -> s.request(20_000_000); s.buffer.readUtf8() } ?: ""
        }
    }

    // the length of a file without downloading it: the answer to a request of its first byte says how long it is
    internal fun sizeOf(url: String, headers: Map<String, String> = emptyMap()): Long = runCatching {
        val b = Request.Builder().url(url).header("User-Agent", DESKTOP).header("Range", "bytes=0-0")
        headers.forEach { (k, v) -> b.header(k, v) }
        http.newCall(b.build()).execute().use { r ->
            val range = r.header("Content-Range")?.substringAfter('/')?.toLongOrNull()
            range ?: r.header("Content-Length")?.toLongOrNull()?.takeIf { r.code == 200 } ?: 0L
        }
    }.getOrDefault(0L)

    fun sizeText(bytes: Long): String = when {
        bytes <= 0 -> ""
        bytes >= 1_000_000_000L -> "%.1f GB".format(bytes / 1e9)
        bytes >= 10_000_000L -> "%d MB".format(bytes / 1_000_000)
        bytes >= 1_000_000L -> "%.1f MB".format(bytes / 1e6)
        else -> "%d KB".format(maxOf(1, bytes / 1000))
    }

    // ---- X: the open data service that preview sites use hands out the files of a post; the embed data of the post is the second try ----
    internal fun xToken(id: String): String = radix36((id.toDouble() / 1e15) * Math.PI).replace(Regex("(0+|\\.)"), "")

    // (n).toString(36) of a browser, digit for digit (the shortest digits that give the same number back)
    internal fun radix36(v: Double): String {
        val chars = "0123456789abcdefghijklmnopqrstuvwxyz"
        var integer = Math.floor(v); var fraction = v - integer
        var delta = Math.max(java.lang.Double.MIN_VALUE, 0.5 * (Math.nextUp(v) - v))
        val frac = ArrayList<Int>()
        if (fraction >= delta) {
            do {
                fraction *= 36; delta *= 36
                val d = fraction.toInt(); frac.add(d); fraction -= d
                if (fraction > 0.5 || (fraction == 0.5 && (d and 1) == 1)) {
                    if (fraction + delta > 1) {
                        // round up: the digits written so far take the carry
                        while (true) {
                            if (frac.isEmpty()) { integer += 1; break }
                            val last = frac.removeAt(frac.size - 1)
                            if (last + 1 < 36) { frac.add(last + 1); break }
                        }
                        break
                    }
                }
            } while (fraction >= delta)
        }
        val ip = StringBuilder()
        var n = integer
        while (n >= 1) { ip.append(chars[(n % 36).toInt()]); n = Math.floor(n / 36) }
        if (ip.isEmpty()) ip.append('0')
        return ip.reverse().toString() + (if (frac.isEmpty()) "" else "." + frac.joinToString("") { chars[it].toString() })
    }

    // the answer of the open data service: tweet.media.all[] { type, url, thumbnail_url, duration, width, height }, every file of the post
    internal fun xFromFx(j: JSONObject): List<Pair<Info, Src>> {
        val t = j.optJSONObject("tweet") ?: throw Fail("That post could not be read")
        val au = t.optJSONObject("author")
        val handle = au?.optString("screen_name").orEmpty(); val name = au?.optString("name").orEmpty()
        val title = if (name.isNotEmpty()) "$name (@$handle)" else "@$handle"
        val media = t.optJSONObject("media")
        val all = media?.optJSONArray("all")
        val list = ArrayList<JSONObject>()
        if (all != null) for (i in 0 until all.length()) all.optJSONObject(i)?.let(list::add)
        else {
            media?.optJSONArray("videos")?.let { a -> for (i in 0 until a.length()) a.optJSONObject(i)?.let(list::add) }
            media?.optJSONArray("photos")?.let { a -> for (i in 0 until a.length()) a.optJSONObject(i)?.let { o -> list.add(JSONObject(o.toString()).put("type", "photo")) } }
        }
        val out = ArrayList<Pair<Info, Src>>()
        for (v in list) {
            val u = v.optString("url"); if (!u.startsWith("https://")) continue
            val type = v.optString("type")
            if (type == "photo") {
                val full = if (u.contains("pbs.twimg.com/media/") && !u.contains("name=")) u + (if (u.contains('?')) "&" else "?") + "name=orig" else u
                out.add(Info("x", title, "@$handle", u, 0, "image") to Src(full, "image/jpeg", "jpg"))
            } else {
                val gif = type == "gif" || u.contains("/tweet_video/")
                out.add(Info("x", title, "@$handle", v.optString("thumbnail_url").takeIf { it.startsWith("https://") }, v.optDouble("duration", 0.0).toInt(), if (gif) "gif" else "video") to Src(u, "video/mp4", "mp4"))
            }
        }
        if (out.isEmpty()) throw Fail("That post has no video, gif or picture")
        return out
    }

    internal fun xParse(j: JSONObject): List<Pair<Info, Src>> {
        if (j.optString("__typename") == "TweetTombstone") throw Fail("X does not show this post to the app (it may be 18+, private or deleted)")
        val user = j.optJSONObject("user")
        val handle = user?.optString("screen_name").orEmpty()
        val name = user?.optString("name").orEmpty()
        val title = if (name.isNotEmpty()) "$name (@$handle)" else "@$handle"
        val items = ArrayList<JSONObject>()
        j.optJSONArray("mediaDetails")?.let { a -> for (i in 0 until a.length()) a.optJSONObject(i)?.let(items::add) }
        val out = ArrayList<Pair<Info, Src>>()
        for (it in items) {
            val type = it.optString("type")
            val pic = it.optString("media_url_https").takeIf { u -> u.startsWith("https://") }
            if (type == "photo") { if (pic != null) out.add(Info("x", title, "@$handle", pic, 0, "image") to Src(pic + "?name=orig", "image/jpeg", "jpg")); continue }
            val variants = it.optJSONObject("video_info")?.optJSONArray("variants") ?: continue
            var best: JSONObject? = null
            for (i in 0 until variants.length()) {
                val v = variants.optJSONObject(i) ?: continue
                if (!v.optString("content_type", v.optString("type")).contains("mp4")) continue
                if (best == null || v.optInt("bitrate") > best.optInt("bitrate")) best = v
            }
            val file = best?.optString("url").orEmpty().takeIf { u -> u.startsWith("https://") } ?: continue
            val gif = type == "animated_gif" || file.contains("/tweet_video/")
            val ms = it.optJSONObject("video_info")?.optLong("duration_millis") ?: 0L
            out.add(Info("x", title, "@$handle", pic, (ms / 1000).toInt(), if (gif) "gif" else "video") to Src(file, "video/mp4", "mp4"))
        }
        if (out.isEmpty()) throw Fail("That post has no video, gif or picture")
        return out
    }

    // the file of an X video for the size asked for: the tallest one that fits, with the most data in it (X names the size in the address)
    internal fun xPick(files: List<Triple<String, Int, Int>>, maxH: Int): String? =
        files.filter { it.second in 1..maxH }.maxWithOrNull(compareBy({ it.second }, { it.third }))?.first ?: files.minByOrNull { it.second }?.first

    internal fun xFiles(j: JSONObject): List<Triple<String, Int, Int>> {
        val out = ArrayList<Triple<String, Int, Int>>()
        val items = j.optJSONArray("mediaDetails") ?: return out
        for (i in 0 until items.length()) {
            val vs = items.optJSONObject(i)?.optJSONObject("video_info")?.optJSONArray("variants") ?: continue
            for (k in 0 until vs.length()) {
                val v = vs.optJSONObject(k) ?: continue
                val u = v.optString("url")
                if (!v.optString("content_type").contains("mp4") || !u.startsWith("https://")) continue
                val h = Regex("/(\\d+)x(\\d+)/").find(u)?.groupValues?.get(2)?.toIntOrNull() ?: 0
                out.add(Triple(u, h, v.optInt("bitrate")))
            }
        }
        return out
    }

    // X has no sizes: the file with the most data is taken (the full size of the video, 4K at 30 where the post has it)
    private fun xResolve(user: String, id: String): List<Pair<Info, Src>> {
        var why: Fail? = null
        // 1. the open data service (its files go up to the full size of the video)
        val a = runCatching { xFromFx(JSONObject(get("https://api.fxtwitter.com/$user/status/$id"))) }
        a.getOrNull()?.let { return it }
        a.exceptionOrNull()?.let { if (it is Fail) why = it }
        // 2. the embed data of the post
        val b = runCatching { xParse(JSONObject(get("https://cdn.syndication.twimg.com/tweet-result?id=$id&token=" + xToken(id)))) }
        b.getOrNull()?.let { return it }
        // a post that really has nothing to save says so; a service that did not answer says that
        val f = b.exceptionOrNull()
        val first = why
        if (f is Fail && f.message?.contains("X does not show") == true) throw f
        if (first != null && f is Fail && f.message?.contains("no video") == true) throw first
        throw (f as? Fail) ?: first ?: Fail("Could not read that post (" + (f?.message ?: "no answer").take(60) + ")")
    }

    // ---- YouTube: the extractor of NewPipe; 2K at 60 pictures a second unless a size is typed (the top is 4K at 30), joined with the best sound ----
    private fun ytResolve(id: String, q: String): Pair<Info, Src> {
        val first = runCatching { YtExtract.get(id, maxHeight(q), if (q == "4k") 30 else 60) }
        first.getOrNull()?.let { g ->
            val plain = Src(g.plain.url, "video/mp4", "mp4")
            val v = g.video; val a = g.audio
            val src = if (v != null && a != null) Src(v.url, if (v.webm) "video/webm" else "video/mp4", if (v.webm) "webm" else "mp4", audio = a.url, webm = v.webm, plain = plain, size = v.size, asize = a.size, altAudio = g.audioAlts) else Src(plain.url, plain.mime, plain.ext, altAudio = g.audioAlts)
            val size = if (v != null && a != null) (if (v.size > 0 && a.size > 0) v.size + a.size else 0L) else g.plain.size
            return Info("youtube", g.title.ifEmpty { "YouTube video" }, g.author, g.thumb ?: "https://i.ytimg.com/vi/$id/hqdefault.jpg", g.dur, "video", size) to src
        }
        val e = first.exceptionOrNull()
        throw Fail("Could not get this video (" + ((if (e is Fail) e.message else e?.message ?: e?.javaClass?.simpleName).orEmpty().lineSequence().firstOrNull().orEmpty().take(120).ifEmpty { "not playable" }) + ")")
    }

    // ---- Instagram: the open mirrors of Instagram embeds (they read the post with their own sign in and hand out the files) ----
    private val mirrors = listOf("vxinstagram.com", "kkinstagram.com", "eeinstagram.com", "ddinstagram.com")
    // a mirror that is slow or busy (a 5xx or no answer) is asked again once before the next one is tried
    private fun <T> twice(f: () -> T): T = try { f() } catch (e: Exception) { if (e is Fail && (e.message.orEmpty().contains("404") || e.message.orEmpty().contains("403"))) throw e; Thread.sleep(600); f() }

    internal fun metaOf(html: String, key: String): String? =
        Regex("<meta[^>]+(?:property|name)=\"$key\"[^>]+content=\"([^\"]*)\"", RegexOption.IGNORE_CASE).find(html)?.groupValues?.get(1)
            ?: Regex("<meta[^>]+content=\"([^\"]*)\"[^>]+(?:property|name)=\"$key\"", RegexOption.IGNORE_CASE).find(html)?.groupValues?.get(1)

    private fun unent(s: String) = s.replace("&quot;", "\"").replace("&#x27;", "'").replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")

    // what a mirror says about a post in its page (the og tags)
    internal fun igFromHtml(html: String, base: String = ""): Pair<Info, Src> {
        val video = metaOf(html, "og:video:secure_url") ?: metaOf(html, "og:video:url") ?: metaOf(html, "og:video")
        val pic = metaOf(html, "og:image")
        val who = Regex("\\(@([\\w.]+)\\)").find(metaOf(html, "og:title").orEmpty())?.groupValues?.get(1)
        val author = if (who != null) "@$who" else ""
        // an address that starts with "/" belongs to the mirror itself
        fun full(u: String) = if (u.startsWith("/") && !u.startsWith("//") && base.isNotEmpty()) "https://$base$u" else u
        val v = video?.let(::unent)?.let(::full)?.takeIf { it.startsWith("https://") }
        val p = pic?.let(::unent)?.let(::full)?.takeIf { it.startsWith("https://") }
        if (v == null && p == null) throw Fail("Could not read this post (it may be private)")
        return if (v != null) Info("instagram", author.ifEmpty { "Instagram" }, author, p, 0, "video") to Src(v, "video/mp4", "mp4")
        else Info("instagram", author.ifEmpty { "Instagram" }, author, p, 0, "image") to Src(p!!, "image/jpeg", "jpg")
    }

    // one file of a post from one mirror; index 0 is the post itself, 1 and up are the pictures and videos of a post with several
    private fun igOne(m: String, kind: String, code: String, index: Int): Pair<Info, Src> {
        // a mirror answers a link bot with the page of the post, or sends the file itself
        val tail = if (index > 0) "$index" else ""
        val req = Request.Builder().url("https://$m/$kind/$code/$tail").header("User-Agent", BOT).header("Accept-Language", "en-US,en;q=0.9").build()
        val (info, src) = still.newCall(req).execute().use { r ->
            val loc = r.header("Location")?.let { r.request.url.resolve(it)?.toString() }
            when {
                r.code in 300..399 && loc != null && loc.startsWith("https://") -> {
                    // a reel is a video unless the file says it is a picture; a post is told by its address or the type of the file
                    val t = typeOf(loc)
                    val vid = t.startsWith("video") || Regex("\\.mp4(\\?|$)").containsMatchIn(loc) || loc.contains("/video") ||
                        (kind != "p" && !t.startsWith("image") && !Regex("\\.(jpe?g|png|webp)(\\?|$)", RegexOption.IGNORE_CASE).containsMatchIn(loc))
                    if (vid) Info("instagram", "Instagram", "", null, 0, "video") to Src(loc, "video/mp4", "mp4")
                    else Info("instagram", "Instagram", "", loc, 0, "image") to Src(loc, "image/jpeg", "jpg")
                }
                r.isSuccessful -> igFromHtml(r.body?.string().orEmpty(), m)
                else -> throw Fail("answer " + r.code)
            }
        }
        // an address of the mirror itself is followed to the file behind it
        val real = if (src.url.contains("//$m/")) runCatching { still.newCall(Request.Builder().url(src.url).header("User-Agent", BOT).build()).execute().use { it.header("Location") } }.getOrNull()?.takeIf { it.startsWith("https://") } ?: src.url else src.url
        return info to Src(real, src.mime, src.ext)
    }

    private fun igResolve(p: Pair<String, String>): List<Pair<Info, Src>> {
        val kind = if (p.first.equals("reels", true)) "reel" else p.first.lowercase()
        val code = p.second
        var why = "no answer"
        for (m in mirrors) {
            try {
                val (info, src) = twice { igOne(m, kind, code, 0) }
                // a reel or a video that came out as a picture is not what was asked for: the next mirror is tried
                if (kind != "p" && info.kind == "image") { why = "no video"; continue }
                // the page of the post says who wrote it and shows the picture of a video
                val meta = if (info.author.isEmpty() || info.kind == "video" && info.thumb == null) runCatching { igFromHtml(get("https://$m/p/$code/", ua = BOT), m).first }.getOrNull() else null
                fun named(i: Info) = if (meta != null) Info(i.site, meta.title, meta.author.ifEmpty { i.author }, i.thumb ?: meta.thumb.takeIf { i.kind == "video" }, i.dur, i.kind) else i
                val out = arrayListOf(named(info) to src)
                // a post with several pictures or videos: the mirror gives each by its number (the first one is also number 1)
                if (kind == "p") {
                    val pool = java.util.concurrent.Executors.newFixedThreadPool(5)
                    try {
                        val jobs = (2..10).map { n -> pool.submit<Pair<Info, Src>?> { runCatching { twice { igOne(m, kind, code, n) } }.getOrNull() } }
                        // a file that could not be read is skipped (never the end of the post); a file seen already is not added twice
                        for (j in jobs) {
                            val one = runCatching { j.get(40, TimeUnit.SECONDS) }.getOrNull() ?: continue
                            if (out.any { it.second.url == one.second.url }) continue
                            out.add(named(one.first) to one.second)
                        }
                    } finally { pool.shutdownNow() }
                }
                return out
            } catch (e: Exception) { why = (e as? Fail)?.message ?: e.javaClass.simpleName }
        }
        // only a "not found" or "forbidden" answer says the post may be private; a busy mirror is just a failed try
        throw Fail(if (Regex("40[34]").containsMatchIn(why)) "Could not read this post (it may be private)" else "Instagram did not answer, try again in a moment ($why)")
    }

    // ---- TikTok: the open service tikwm hands out the file (no mark) of a video, or the pictures of a slideshow ----
    private fun ttResolve(url: String): List<Pair<Info, Src>> {
        var why = "no answer"
        for (attempt in 0 until 3) {
            try {
                val j = JSONObject(get("https://www.tikwm.com/api/?hd=1&url=" + java.net.URLEncoder.encode(url, "UTF-8"), ua = DESKTOP))
                if (j.optInt("code") != 0) { why = j.optString("msg").take(60).ifEmpty { "no answer" }; if (why.contains("limit", true)) { Thread.sleep(1300); continue } else break }
                val d = j.optJSONObject("data") ?: break
                fun abs(u: String) = if (u.startsWith("//")) "https:$u" else if (u.startsWith("/")) "https://www.tikwm.com$u" else u
                val who = d.optJSONObject("author")?.let { a -> a.optString("unique_id").takeIf { it.isNotEmpty() } ?: a.optString("nickname") }.orEmpty()
                val author = if (who.isNotEmpty()) "@$who" else ""
                val title = d.optString("title").ifEmpty { author.ifEmpty { "TikTok" } }
                val cover = abs(d.optString("cover").ifEmpty { d.optString("origin_cover") }).takeIf { it.startsWith("https://") }
                val imgs = d.optJSONArray("images")
                if (imgs != null && imgs.length() > 0) {
                    val out = ArrayList<Pair<Info, Src>>()
                    for (i in 0 until imgs.length()) { val u = abs(imgs.optString(i)); if (u.startsWith("https://")) out.add(Info("tiktok", title, author, u, 0, "image") to Src(u, "image/jpeg", "jpg")) }
                    if (out.isNotEmpty()) return out
                }
                val file = abs(d.optString("hdplay").ifEmpty { d.optString("play") }).takeIf { it.startsWith("https://") } ?: throw Fail("That TikTok has no video")
                val size = d.optLong("hd_size").takeIf { it > 0 && d.optString("hdplay").isNotEmpty() } ?: d.optLong("size")
                return listOf(Info("tiktok", title, author, cover, d.optInt("duration"), "video") to Src(file, "video/mp4", "mp4", size = size))
            } catch (e: Fail) { throw e } catch (e: Exception) { why = e.javaClass.simpleName }
        }
        throw Fail("Could not read this TikTok ($why)")
    }

    // ---- any other link: a file itself is taken as it is; a page is read for its video and picture addresses ----
    private fun webResolve(url: String): List<Pair<Info, Src>> {
        val b = Request.Builder().url(url).header("User-Agent", DESKTOP).header("Accept-Language", "en-US,en;q=0.9").build()
        var page = url; var html = ""; var direct: String? = null
        http.newCall(b).execute().use { r ->
            if (!r.isSuccessful) throw Fail("The site answered " + r.code)
            page = r.request.url.toString()
            val t = r.header("Content-Type").orEmpty().lowercase()
            if (t.startsWith("video/") || t.startsWith("image/") || t.startsWith("audio/")) direct = t
            else html = r.body?.source()?.let { src -> src.request(2_000_000); src.buffer.readUtf8() }.orEmpty()
        }
        val host = host(page)
        val ref = mapOf("Referer" to page)
        direct?.let { t ->
            val kind = if (t.startsWith("image/")) "image" else "video"
            val ext = when { t.contains("gif") -> "gif"; t.contains("png") -> "png"; t.contains("webp") -> "webp"; t.startsWith("image/") -> "jpg"; t.contains("webm") -> "webm"; else -> "mp4" }
            val name = java.net.URLDecoder.decode(page.substringBefore('?').substringAfterLast('/'), "UTF-8").substringBeforeLast('.').ifEmpty { host }
            return listOf(Info("web", name, host, null, 0, kind) to Src(page, t, ext, ref))
        }
        fun abs(u: String): String? = runCatching {
            val c = unent(u.trim().replace("\\/", "/"))
            val r = java.net.URI(page).resolve(c).toString()
            r.takeIf { it.startsWith("https://") || it.startsWith("http://") }?.replace("http://", "https://")
        }.getOrNull()
        val title = unent(metaOf(html, "og:title") ?: metaOf(html, "twitter:title") ?: Regex("<title[^>]*>([^<]*)</title>", RegexOption.IGNORE_CASE).find(html)?.groupValues?.get(1)?.trim().orEmpty()).ifEmpty { host }
        val author = unent(metaOf(html, "og:site_name").orEmpty()).ifEmpty { host }
        val poster = (metaOf(html, "og:image") ?: metaOf(html, "twitter:image"))?.let(::abs)
        val videos = LinkedHashSet<String>()
        listOf("og:video:secure_url", "og:video:url", "og:video", "twitter:player:stream").forEach { k -> metaOf(html, k)?.let(::abs)?.let(videos::add) }
        Regex("<video[^>]*?\\ssrc=\"([^\"]+)\"", RegexOption.IGNORE_CASE).findAll(html).forEach { m -> abs(m.groupValues[1])?.let(videos::add) }
        Regex("<source[^>]*?\\ssrc=\"([^\"]+)\"[^>]*>", RegexOption.IGNORE_CASE).findAll(html).forEach { m ->
            if (!m.value.contains("type=\"image", true) && !m.value.contains("type=\"audio", true)) abs(m.groupValues[1])?.let(videos::add)
        }
        Regex("\"contentUrl\"\\s*:\\s*\"([^\"]+)\"").findAll(html).forEach { m -> abs(m.groupValues[1])?.takeIf { Regex("\\.(mp4|webm|mov|m4v|gif|jpe?g|png|webp)(\\?|$)", RegexOption.IGNORE_CASE).containsMatchIn(it) }?.let(videos::add) }
        // a stream list (m3u8, mpd) cannot be saved as one file
        val files = videos.filter { !Regex("\\.(m3u8|mpd)(\\?|$)", RegexOption.IGNORE_CASE).containsMatchIn(it) }.take(10)
        val out = ArrayList<Pair<Info, Src>>()
        for (f in files) {
            val img = Regex("\\.(gif|jpe?g|png|webp)(\\?|$)", RegexOption.IGNORE_CASE).containsMatchIn(f)
            val ext = Regex("\\.(mp4|webm|mov|m4v|gif|jpe?g|png|webp)(\\?|$)", RegexOption.IGNORE_CASE).find(f)?.groupValues?.get(1)?.lowercase()?.replace("jpeg", "jpg")?.replace("mov", "mp4")?.replace("m4v", "mp4") ?: "mp4"
            out.add(Info("web", title, author, if (img) f else poster, 0, if (img) "image" else "video") to Src(f, if (img) "image/" + ext else if (ext == "webm") "video/webm" else "video/mp4", ext, ref))
        }
        // no video: the pictures of the page
        if (out.isEmpty()) {
            val pics = LinkedHashSet<String>()
            listOf("og:image:secure_url", "og:image", "twitter:image").forEach { k -> metaOf(html, k)?.let(::abs)?.let(pics::add) }
            Regex("\"image\"\\s*:\\s*\"([^\"]+)\"").findAll(html).forEach { m -> abs(m.groupValues[1])?.let(pics::add) }
            for (f in pics.take(10)) {
                val ext = Regex("\\.(gif|jpe?g|png|webp)(\\?|$)", RegexOption.IGNORE_CASE).find(f)?.groupValues?.get(1)?.lowercase()?.replace("jpeg", "jpg") ?: "jpg"
                out.add(Info("web", title, author, f, 0, "image") to Src(f, "image/$ext", ext, ref))
            }
        }
        if (out.isEmpty()) throw Fail("Could not find any media on that page")
        return out
    }

    // ---- the card kept in the note ----
    fun card(url: String, i: Info) = JSONObject().put("u", url).put("s", i.site).put("t", i.title.take(200)).put("a", i.author.take(80)).put("k", i.kind).put("d", i.dur).put("z", i.size)
        .apply { i.thumb?.let { put("i", it) } }
    // the size is kept only for YouTube (the other sites have one size); n is the place of the file in a post with several (0 = the first
    // one, which also shows the command), c how many files the post has
    fun card(url: String, i: Info, q: String, n: Int = 0, c: Int = 1) = card(url, i).apply { if (q.isNotEmpty() && (i.site == "youtube" || q == "audio")) put("q", q); if (n > 0) put("n", n); if (c > 1) put("c", c) }

    // a card that came from another phone or the server is checked before it is shown: a known site, an https picture, short texts
    fun cleanCard(o: JSONObject?): JSONObject? {
        o ?: return null
        val u = o.optString("u"); val s = o.optString("s")
        if (!u.startsWith("https://") || u.length > 600 || s !in setOf("x", "youtube", "instagram", "tiktok", "web") || site(u) != s) return null
        val out = JSONObject().put("u", u).put("s", s).put("t", o.optString("t").take(200)).put("a", o.optString("a").take(80))
            .put("k", o.optString("k").takeIf { it in setOf("video", "gif", "image") } ?: "video").put("d", o.optInt("d").coerceIn(0, 86_400))
            .put("z", o.optLong("z").coerceIn(0L, 100_000_000_000L))
        // the links of a command with several of them (only the first card carries them, to name every site in the command bubble)
        o.optJSONArray("l")?.let { a -> val l = org.json.JSONArray(); for (i in 0 until minOf(a.length(), 10)) a.optString(i).takeIf { it.startsWith("https://") && it.length < 600 }?.let { l.put(it) }; if (l.length() > 1) out.put("l", l) }
        // the picture is a link, or a small picture kept inside the note (the first frame of a video)
        o.optString("i").takeIf { (it.startsWith("https://") && it.length < 600) || (it.startsWith("data:image/jpeg;base64,") && it.length < 90_000) }?.let { out.put("i", it) }
        o.optString("q").takeIf { it in setOf("4k", "2k", "1080p", "720p", "audio") }?.let { out.put("q", it) }
        o.optInt("n").takeIf { it in 1..20 }?.let { out.put("n", it) }
        o.optInt("c").takeIf { it in 2..20 }?.let { out.put("c", it) }
        // a card of a later link of the same command: the command bubble is not drawn again
        if (o.optInt("x") == 1) out.put("x", 1)
        o.optString("f").takeIf { it in FOLDERS }?.let { out.put("f", it) }
        return out
    }

    // ---- saving the file ----
    private fun safeName(title: String, ext: String): String {
        val base = title.replace(Regex("[^\\p{L}\\p{N} _.-]+"), " ").replace(Regex("\\s+"), " ").trim().take(60).ifEmpty { "nook" }
        return "$base ${System.currentTimeMillis() % 100000}.$ext"
    }

    // a file in pieces of 2 to 4 MB with eight connections at once: one connection to YouTube is slowed down by the site, pieces are not;
    // the pieces are written to their place in the file, and a piece that fails is tried three times
    internal fun fastDownload(src: String, headers: Map<String, String>, to: File, total: Long, onBytes: (Long) -> Unit) {
        if (total > MAX_FILE) throw Fail("That file is too large")
        if (total <= 0 || total < 512L shl 10) { download(src, headers, to, onBytes = onBytes); return }
        // the pieces are smaller for a smaller file, so all the connections have work (one connection alone to YouTube is slowed down,
        // also for a short sound: a song of 4 MB took a minute that way)
        val chunk = if (total < 32L shl 20) maxOf(256L shl 10, (total + 11) / 12) else 4L shl 20
        val count = ((total + chunk - 1) / chunk).toInt()
        val next = java.util.concurrent.atomic.AtomicInteger(0)
        val failure = java.util.concurrent.atomic.AtomicReference<Throwable?>(null)
        val yt = src.contains("googlevideo.com")
        java.io.RandomAccessFile(to, "rw").use { raf ->
            raf.setLength(total)
            val pool = java.util.concurrent.Executors.newFixedThreadPool(12)
            try {
                val jobs = (0 until minOf(12, count)).map {
                    pool.submit {
                        while (failure.get() == null) {
                            val i = next.getAndIncrement(); if (i >= count) break
                            val a = i * chunk; val b = minOf(total - 1, a + chunk - 1)
                            var ok = false; var last: Throwable? = null
                            for (t in 0 until 3) {
                                try {
                                    // the pieces of YouTube are asked for with the range in the address (that way they are not slowed down)
                                    val u = if (yt) src + (if (src.contains('?')) "&" else "?") + "range=$a-$b" else src
                                    val rq = Request.Builder().url(u).header("User-Agent", DESKTOP).apply { headers.forEach { (k, v) -> header(k, v) }; if (!yt) header("Range", "bytes=$a-$b") }.build()
                                    http.newCall(rq).execute().use { r ->
                                        if (!r.isSuccessful) throw Fail("The download was refused (" + r.code + ")")
                                        val data = r.body?.bytes() ?: throw Fail("Nothing came back")
                                        if (data.size.toLong() != b - a + 1) throw Fail("A piece came back short")
                                        synchronized(raf) { raf.seek(a); raf.write(data) }
                                        onBytes(data.size.toLong())
                                    }
                                    ok = true; break
                                } catch (e: Throwable) { last = e; if (e is kotlinx.coroutines.CancellationException) break }
                            }
                            if (!ok) { failure.compareAndSet(null, last ?: Fail("The download failed")); break }
                        }
                    }
                }
                jobs.forEach { it.get() }
            } finally { pool.shutdownNow() }
        }
        failure.get()?.let { throw it }
    }

    internal fun download(src: String, headers: Map<String, String>, to: File, limit: Long = MAX_FILE, onBytes: (Long) -> Unit) {
        val req = Request.Builder().url(src).header("User-Agent", DESKTOP).apply { headers.forEach { (k, v) -> header(k, v) } }.build()
        http.newCall(req).execute().use { r ->
            if (!r.isSuccessful) throw Fail("The download was refused (" + r.code + ")")
            val body = r.body ?: throw Fail("Nothing came back")
            if (body.contentLength() > limit) throw Fail("That file is too large")
            to.outputStream().use { o ->
                val buf = ByteArray(64 * 1024); var got = 0L
                body.byteStream().use { i -> while (true) { val n = i.read(buf); if (n < 0) break; got += n; if (got > limit) throw Fail("That file is too large"); o.write(buf, 0, n); onBytes(n.toLong()) } }
            }
        }
    }

    // a short looping clip as a real gif file: frames are read from the clip and written with the app's own gif encoder
    internal fun toGif(clip: File): ByteArray? {
        // first the clip is read in plain Java (the same on every phone); the phone's own decoder is only the second way
        val plain = runCatching { ClipFrames.read(clip) }
        plain.getOrNull()?.let { o -> return Gif.encode(o.frames, o.w, o.h, o.fps, 0.4) }
        val first = plain.exceptionOrNull()
        try { return toGifPhone(clip) } catch (e: Exception) { throw Fail((first?.message ?: first?.javaClass?.simpleName ?: "") + " / " + (e.message ?: e.javaClass.simpleName)) }
    }

    private fun toGifPhone(clip: File): ByteArray? {
        val r = android.media.MediaMetadataRetriever()
        try {
            r.setDataSource(clip.path)
            val durMs = r.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
            val count = if (Build.VERSION.SDK_INT >= 28) r.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_FRAME_COUNT)?.toIntOrNull() ?: 0 else 0
            val fps = 10
            val frames = ArrayList<IntArray>(); var w = 0; var h = 0
            fun add(bm: android.graphics.Bitmap?) {
                bm ?: return
                if (w == 0) { w = minOf(360, bm.width); h = (bm.height * (w.toFloat() / bm.width)).toInt().coerceAtLeast(1) }
                val soft = if (bm.config == android.graphics.Bitmap.Config.HARDWARE) bm.copy(android.graphics.Bitmap.Config.ARGB_8888, false) else bm
                val sc = if (soft.width == w) soft else android.graphics.Bitmap.createScaledBitmap(soft, w, h, true)
                val px = IntArray(w * h); sc.getPixels(px, 0, w, 0, 0, w, h); frames.add(px)
            }
            // frame by frame in order when the phone can (fast, and every picture is a real one), else by time
            if (Build.VERSION.SDK_INT >= 28 && count > 1) {
                val step = maxOf(1, Math.round(count / (maxOf(durMs, 1L) / 1000f) / fps))
                var i = 0
                while (i < count && frames.size < 80) { runCatching { add(r.getFrameAtIndex(i)) }; i += step }
            }
            if (frames.size < 2) {
                frames.clear(); w = 0
                val n = minOf(80, maxOf(2, (maxOf(durMs, 300L) * fps / 1000).toInt()))
                for (i in 0 until n) runCatching { add(r.getFrameAtTime(i * 1_000_000L / fps, android.media.MediaMetadataRetriever.OPTION_CLOSEST)) }
            }
            if (frames.size < 2) throw Fail("no frames could be read")
            return Gif.encode(frames, w, h, fps)
        } finally { r.release() }
    }

    // joins a picture file and a sound file into one, without changing either (no re-encoding)
    internal fun mux(video: File, audio: File, out: File, webm: Boolean, onFraction: (Float) -> Unit = {}) {
        val vx = MediaExtractor().apply { setDataSource(video.path) }
        val ax = MediaExtractor().apply { setDataSource(audio.path) }
        try {
            fun track(x: MediaExtractor, kind: String) = (0 until x.trackCount).first { x.getTrackFormat(it).getString(MediaFormat.KEY_MIME).orEmpty().startsWith(kind) }
            val vi = track(vx, "video/"); val ai = track(ax, "audio/")
            vx.selectTrack(vi); ax.selectTrack(ai)
            val m = MediaMuxer(out.path, if (webm) MediaMuxer.OutputFormat.MUXER_OUTPUT_WEBM else MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            val vt = m.addTrack(vx.getTrackFormat(vi)); val at = m.addTrack(ax.getTrackFormat(ai))
            try {
            m.start()
            val buf = ByteBuffer.allocate(8 shl 20); val info = MediaCodec.BufferInfo()
            val allBytes = (video.length() + audio.length()).coerceAtLeast(1L).toFloat(); var moved = 0L; var lastTick = 0L
            fun copy(x: MediaExtractor, t: Int) {
                while (true) {
                    val n = x.readSampleData(buf, 0); if (n < 0) break
                    moved += n; if (moved - lastTick > (4 shl 20)) { lastTick = moved; onFraction((moved / allBytes).coerceIn(0f, 1f)) }
                    info.set(0, n, x.sampleTime, if (x.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
                    m.writeSampleData(t, buf, info); x.advance()
                }
            }
            copy(vx, vt); copy(ax, at)
            m.stop()
            } finally { runCatching { m.release() } }
        } finally { vx.release(); ax.release() }
    }

    // the file goes to Movies/Nook (Pictures/Nook for a picture), where the gallery finds it; progress is a number from 0 to 1
    // uri: where it was saved; note: what the save wants to tell the person besides "saved"
    class Saved(val uri: Uri, val note: String?)

    // what a file really is, told by its first bytes: (extension, type)
    internal fun sniff(head: ByteArray): Pair<String, String>? {
        fun at(i: Int, s: String) = head.size >= i + s.length && s.indices.all { head[i + it] == s[it].code.toByte() }
        return when {
            at(0, "GIF") -> "gif" to "image/gif"
            head.size > 3 && head[0] == 0xFF.toByte() && head[1] == 0xD8.toByte() -> "jpg" to "image/jpeg"
            head.size > 4 && head[0] == 0x89.toByte() && at(1, "PNG") -> "png" to "image/png"
            at(0, "RIFF") && at(8, "WEBP") -> "webp" to "image/webp"
            at(4, "ftyp") && (at(8, "avif") || at(8, "avis")) -> "avif" to "image/avif"
            at(4, "ftyp") && (at(8, "heic") || at(8, "heix") || at(8, "mif1") || at(8, "msf1")) -> "heic" to "image/heic"
            at(4, "ftyp") -> "mp4" to "video/mp4"
            head.size > 4 && head[0] == 0x1A.toByte() && head[1] == 0x45.toByte() && head[2] == 0xDF.toByte() && head[3] == 0xA3.toByte() -> "webm" to "video/webm"
            else -> null
        }
    }

    // the file written to its place with big pieces (the default piece of 8 KB makes a big video take seconds), the bar moving to 100
    private fun copyOut(from: File, o: java.io.OutputStream, onProgress: (Float) -> Unit) {
        val total = from.length().coerceAtLeast(1L).toFloat(); var done = 0L
        val buf = ByteArray(1 shl 20)
        from.inputStream().use { i -> while (true) { val n = i.read(buf); if (n < 0) break; o.write(buf, 0, n); done += n; onProgress(0.9f + 0.1f * (done / total)) } }
    }

    // the sound track of a video file copied on its own, without being changed
    private fun extractAudio(from: File, to: File, webm: Boolean) {
        val ex = android.media.MediaExtractor()
        try {
            ex.setDataSource(from.absolutePath)
            val ti = (0 until ex.trackCount).firstOrNull { ex.getTrackFormat(it).getString(android.media.MediaFormat.KEY_MIME).orEmpty().startsWith("audio/") } ?: throw Fail("That video has no sound")
            ex.selectTrack(ti)
            val mx = android.media.MediaMuxer(to.absolutePath, if (webm) android.media.MediaMuxer.OutputFormat.MUXER_OUTPUT_WEBM else android.media.MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            try {
                val out = mx.addTrack(ex.getTrackFormat(ti)); mx.start()
                val buf = java.nio.ByteBuffer.allocate(1 shl 20); val bi = android.media.MediaCodec.BufferInfo()
                while (true) {
                    buf.clear(); val n = ex.readSampleData(buf, 0); if (n < 0) break
                    bi.set(0, n, ex.sampleTime, if (ex.sampleFlags and android.media.MediaExtractor.SAMPLE_FLAG_SYNC != 0) android.media.MediaCodec.BUFFER_FLAG_KEY_FRAME else 0); mx.writeSampleData(out, buf, bi); ex.advance()
                }
                mx.stop()
            } finally { runCatching { mx.release() } }
        } finally { ex.release() }
    }

    // audio is always made into an mp3 (the sound as it came is kept only when the phone cannot make one)
    fun mp3On(@Suppress("UNUSED_PARAMETER") ctx: Context) = true

    // index: which file of a post with several (0 for the first)
    suspend fun save(ctx: Context, url: String, q: String, index: Int, cover: String? = null, folder: String = "", onProgress: (Float) -> Unit): Saved = withContext(Dispatchers.IO) {
        // only the file to save is worked out (no picture is made for the others)
        val folder = folder.ifEmpty { defaultFolder(ctx, q == "audio") }
        val all = rawItems(url, q)
        val pick = all.getOrNull(index.coerceIn(0, all.size - 1)) ?: throw Fail("Nothing to save in that post")
        val item = Item(Info(pick.first.site, pick.first.title, pick.first.author, pick.first.thumb, pick.first.dur, pick.first.kind, sizeFor(pick.first, pick.second)), pick.second)
        val info = item.info; val first = item.src
        val root = File(ctx.cacheDir, "media").apply { mkdirs() }
        // every download has its own folder, so two at once (or an old one) never touch each other's files
        root.listFiles()?.forEach { if (System.currentTimeMillis() - it.lastModified() > 6 * 3600_000L) runCatching { it.deleteRecursively() } }
        val tmp = File(root, "d" + System.nanoTime()).apply { mkdirs() }
        val made = File(tmp, "out." + (if (first.audio != null && first.webm) "webm" else "mp4"))
        if (q == "audio") {
            val got0 = java.util.concurrent.atomic.AtomicLong(0)
            try {
                if (info.kind == "image") throw Fail("A picture has no sound")
                val part = File(tmp, "a.part")
                // the sound file first, then every other sound file the site offers for it: an address that is refused (403) is not the end
                val alts = first.altAudio.map { Triple(it.url, it.size, it.webm) }
                val cands = if (first.audio != null) listOf(Triple(first.audio, first.asize, first.webm)) + alts else alts + listOf(Triple(first.url, first.size, false))
                var webmUsed = false; var lastErr: Exception? = null; var got = false
                for ((u, sz0, wb) in cands) {
                    try {
                        got0.set(0)
                        val sz = if (sz0 > 0) sz0 else sizeOf(u, first.headers)
                        val tick = { n: Long -> val g = got0.addAndGet(n); if (sz > 0) onProgress((g / sz.toFloat() * 0.5f).coerceIn(0f, 0.5f)) }
                        // in pieces over several connections; when the site refuses that way, the one plain connection is tried
                        try { fastDownload(u, first.headers, part, sz, tick) }
                        catch (e: Fail) { got0.set(0); download(u, first.headers, part, onBytes = tick) }
                        webmUsed = wb; got = true; break
                    } catch (e: Exception) { if (e is kotlinx.coroutines.CancellationException) throw e; lastErr = e }
                }
                if (!got) throw lastErr ?: Fail("The download failed")
                // an mp3 with the title, the artist and the picture of the video (if the phone cannot read the sound, it stays the sound as it came)
                val wantMp3 = mp3On(ctx)
                val coverImg = if (!wantMp3) null else AudioMp3.cover(cover?.takeIf { it.isNotEmpty() } ?: info.thumb) { u -> http.newCall(Request.Builder().url(u).header("User-Agent", DESKTOP).build()).execute().use { r -> if (r.isSuccessful) r.body?.bytes()?.takeIf { it.size < 4_000_000 } else null } }
                val mp3 = File(tmp, "sound.mp3")
                val made = if (!wantMp3) Result.failure<Unit>(IllegalStateException("m4a chosen")) else runCatching { AudioMp3.make(part, mp3, info.title, info.author.removePrefix("@"), coverImg) { p -> onProgress(0.5f + 0.4f * p) } }
                made.exceptionOrNull()?.let { if (it is kotlinx.coroutines.CancellationException) throw it }
                var out = mp3; var ext = "mp3"; var mime = "audio/mpeg"
                if (made.isFailure) {
                    if (wantMp3) android.util.Log.w("nook", "mp3", made.exceptionOrNull())
                    val webm = webmUsed
                    out = File(tmp, if (webm) "sound.webm" else "sound.m4a")
                    extractAudio(part, out, webm)
                    ext = if (webm) "webm" else "m4a"; mime = if (webm) "audio/webm" else "audio/mp4"
                }
                val name = safeName(info.title, ext)
                val resolver = ctx.contentResolver
                val result: Uri
                val place = target("audio", folder)
                if (Build.VERSION.SDK_INT >= 29) {
                    val cv = ContentValues().apply {
                        put(MediaStore.MediaColumns.DISPLAY_NAME, name); put(MediaStore.MediaColumns.MIME_TYPE, mime)
                        put(MediaStore.MediaColumns.RELATIVE_PATH, place.second); put(MediaStore.MediaColumns.IS_PENDING, 1)
                        put(MediaStore.Audio.Media.TITLE, info.title); if (info.author.isNotEmpty()) put(MediaStore.Audio.Media.ARTIST, info.author.removePrefix("@"))
                    }
                    val uri = resolver.insert(place.first, cv) ?: throw Fail("Could not create the file")
                    try { (resolver.openOutputStream(uri) ?: throw Fail("Could not create the file")).use { o -> copyOut(out, o, onProgress) } }
                    catch (e: Exception) { runCatching { resolver.delete(uri, null, null) }; throw e }
                    resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
                    result = uri
                } else {
                    val dir = ctx.getExternalFilesDir(Environment.DIRECTORY_MUSIC) ?: throw Fail("No place to save")
                    val f = File(dir, name); out.copyTo(f, true)
                    result = androidx.core.content.FileProvider.getUriForFile(ctx, ctx.packageName + ".files", f)
                }
                onProgress(1f)
                return@withContext Saved(result, if (made.isSuccess) "mp3 saved in " + place.third else if (!wantMp3) "Saved in " + place.third else "Saved as m4a in " + place.third + ", an mp3 could not be made")
            } finally { runCatching { tmp.deleteRecursively() } }
        }
        var src = first
        val total = (info.size.takeIf { it > 0 } ?: 1L).toFloat()
        val got = java.util.concurrent.atomic.AtomicLong(0)
        var final: File? = null
        var note: String? = null
        try {
            // the best quality is two files joined together; if that does not work, the one-piece file of a lower quality is used
            val audio = first.audio
            if (audio != null) {
                try {
                    val v = File(tmp, "v.part"); val a = File(tmp, "a.part")
                    val tick = { n: Long -> val g = got.addAndGet(n); if (info.size > 0) onProgress((g / total * 0.8f).coerceIn(0f, 0.8f)) }
                    // both pieces at once
                    val av = if (first.size > 0) first.size else sizeOf(first.url, first.headers); val aa = if (first.asize > 0) first.asize else sizeOf(audio, first.headers)
                    kotlinx.coroutines.coroutineScope {
                        val x = async { fastDownload(first.url, first.headers, v, av, tick) }
                        val y = async { fastDownload(audio, first.headers, a, aa, tick) }
                        x.await(); y.await()
                    }
                    onProgress(0.8f); mux(v, a, made, first.webm) { f -> onProgress(0.8f + 0.1f * f) }
                    final = made
                } catch (e: Exception) {
                    if (e is kotlinx.coroutines.CancellationException) throw e
                    val plain = first.plain ?: throw e
                    runCatching { made.delete() }; src = plain; got.set(0)
                }
            }
            if (final == null) {
                val one = File(tmp, "one." + src.ext)
                val share = if (src === first) total else 1f
                val size = if (src.size > 0) src.size else sizeOf(src.url, src.headers)
                fastDownload(src.url, src.headers, one, size) { n -> val g = got.addAndGet(n); if (src === first && info.size > 0) onProgress((g / share * 0.8f).coerceIn(0f, 0.8f)) }
                final = one
            }
            var cur: File = final!!
            // the file says what it is (not the address): a gif stays a gif, a picture stays a picture, and a looping clip that X calls
            // a gif is made a real gif file
            val head = ByteArray(16).also { b -> cur.inputStream().use { it.read(b) } }
            val real = sniff(head)
            if (real?.first != "gif" && info.kind == "gif") {
                val g = runCatching { toGif(cur) }.also { if (it.isFailure) android.util.Log.w("nook", "gif", it.exceptionOrNull()) }
                val bytes = g.getOrNull()
                if (bytes != null) { val gf = File(tmp, "clip.gif"); gf.writeBytes(bytes); cur = gf }
                else note = "Saved as a looping video, a gif could not be made" + (g.exceptionOrNull()?.let { " (" + (it.message ?: it.javaClass.simpleName).take(40) + ")" } ?: "")
            }
            val file: File = cur
            val sn = if (file === final) real else ("gif" to "image/gif")
            val ext = sn?.first ?: file.extension.ifEmpty { src.ext }
            val mime = sn?.second ?: if (ext == "gif") "image/gif" else if (ext == "webm") "video/webm" else if (src.mime.startsWith("image/")) src.mime else "video/mp4"
            val image = mime.startsWith("image/")
            val name = safeName(info.title, ext)
            val resolver = ctx.contentResolver
            val result: Uri
            val place = target(if (image) "image" else "video", folder)
            if (Build.VERSION.SDK_INT >= 29) {
                val cv = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, name); put(MediaStore.MediaColumns.MIME_TYPE, mime)
                    put(MediaStore.MediaColumns.RELATIVE_PATH, place.second)
                    put(MediaStore.MediaColumns.IS_PENDING, 1)
                }
                val uri = resolver.insert(place.first, cv) ?: throw Fail("Could not create the file")
                try { (resolver.openOutputStream(uri) ?: throw Fail("Could not create the file")).use { o -> copyOut(file, o, onProgress) } }
                catch (e: Exception) { runCatching { resolver.delete(uri, null, null) }; throw e }
                resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
                result = uri
            } else {
                val dir = ctx.getExternalFilesDir(if (image) Environment.DIRECTORY_PICTURES else Environment.DIRECTORY_MOVIES) ?: throw Fail("No place to save")
                val f = File(dir, name); file.copyTo(f, true)
                result = androidx.core.content.FileProvider.getUriForFile(ctx, ctx.packageName + ".files", f)
            }
            onProgress(1f)
            Saved(result, note ?: if (folder.isNotEmpty()) "Saved in " + place.third else null)
        } finally { runCatching { tmp.deleteRecursively() } }
    }
}
