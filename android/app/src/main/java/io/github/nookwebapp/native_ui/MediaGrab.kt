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
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.TimeUnit

// "/media <link>" in a notes chat: the card of a video or gif of YouTube, Instagram or X, with a button that saves it on this
// phone. Everything runs on the phone itself (its own connection, nothing goes through the server); only the card (the link,
// the title, the picture and the size) is kept in the note and synced, the video is downloaded where the button is pressed.
object MediaGrab {
    class Fail(msg: String) : Exception(msg)
    class Info(val site: String, val title: String, val author: String, val thumb: String?, val dur: Int, val kind: String, val size: Long = 0)
    // one file (picture and sound together), or a picture file with a sound file that are joined on the phone ("audio");
    // "plain" is the one-piece file of a lower quality to fall back to when the pieces cannot be joined
    class Src(val url: String, val mime: String, val ext: String, val headers: Map<String, String> = emptyMap(), val audio: String? = null, val webm: Boolean = false, val plain: Src? = null)

    private val X_POST = Regex("^https?://(?:www\\.|mobile\\.)?(?:x|twitter)\\.com/([^/?#]+)/status(?:es)?/(\\d{1,20})", RegexOption.IGNORE_CASE)
    private val IG_POST = Regex("^https?://(?:www\\.)?instagram\\.com/(?:[\\w.]+/)?(p|reel|reels|tv)/([\\w-]+)", RegexOption.IGNORE_CASE)
    private val YT_ID = Regex("(?:youtube\\.com/(?:watch\\?(?:.*&)?v=|shorts/|embed/|live/)|youtu\\.be/)([\\w-]{6,})", RegexOption.IGNORE_CASE)
    private val CMD = Regex("^/media(?:\\s+/(4k|2k|1080p|720p))?(?:\\s+(\\S+))?\\s*$", RegexOption.IGNORE_CASE)
    private const val DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    private const val BOT = "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)"

    private val http: OkHttpClient = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).followRedirects(true).build()
    private val still: OkHttpClient = http.newBuilder().followRedirects(false).build()

    // the link of a "/media" message: null when the text is not that command, "" when the link is missing
    fun command(text: String): String? = CMD.find(text.trim())?.let { it.groupValues[2] }
    // the size asked for in "/media /2k link": "4k", "2k", "1080p" or "720p"; "" when none was typed
    fun quality(text: String): String = CMD.find(text.trim())?.groupValues?.get(1)?.lowercase().orEmpty()
    // the tallest picture each size allows
    fun maxHeight(q: String) = when (q) { "4k" -> 2160; "2k" -> 1440; "720p" -> 720; else -> 1080 }
    // the name of the site as the link would show it
    fun domain(site: String) = when (site) { "x" -> "x.com"; "youtube" -> "youtube.com"; else -> "instagram.com" }

    // "x", "youtube" or "instagram"; null for any other link
    fun site(url: String): String? = when {
        X_POST.containsMatchIn(url) -> "x"
        YT_ID.containsMatchIn(url) -> "youtube"
        IG_POST.containsMatchIn(url) -> "instagram"
        else -> null
    }
    fun siteName(site: String) = when (site) { "x" -> "X"; "youtube" -> "YouTube"; else -> "Instagram" }

    // the card and the address of the file, worked out together (the address of a file runs out, so it is asked again at download)
    suspend fun resolve(url: String, q: String = ""): Pair<Info, Src> = withContext(Dispatchers.IO) {
        val (info, src) = when (site(url)) {
            "x" -> X_POST.find(url)!!.let { xResolve(it.groupValues[1], it.groupValues[2], q) }
            "youtube" -> ytResolve(YT_ID.find(url)!!.groupValues[1], q)
            "instagram" -> igResolve(IG_POST.find(url)!!.let { it.groupValues[1] to it.groupValues[2] })
            else -> throw Fail("Use a link of YouTube, Instagram or X")
        }
        // the size of the file (or of both pieces) for the card
        val size = if (info.size > 0) info.size else sizeOf(src.url, src.headers) + (src.audio?.let { sizeOf(it, src.headers) } ?: 0)
        // an X post has no picture of its own that fits: the first frame of the video is the picture of the card
        val thumb = if (info.site == "x") firstFrame(src.url) ?: info.thumb else info.thumb
        Info(info.site, info.title, info.author, thumb, info.dur, info.kind, size) to src
    }

    // the first frame of a video file as a small picture (a data address, so it goes with the note), null when it cannot be read
    private fun firstFrame(url: String): String? = runCatching {
        val r = android.media.MediaMetadataRetriever()
        try {
            r.setDataSource(url, hashMapOf("User-Agent" to DESKTOP))
            val bm = r.getFrameAtTime(0, android.media.MediaMetadataRetriever.OPTION_CLOSEST_SYNC) ?: return@runCatching null
            val w = minOf(480, bm.width); val h = (bm.height * (w.toFloat() / bm.width)).toInt().coerceAtLeast(1)
            val sc = if (w == bm.width) bm else android.graphics.Bitmap.createScaledBitmap(bm, w, h, true)
            val out = java.io.ByteArrayOutputStream()
            sc.compress(android.graphics.Bitmap.CompressFormat.JPEG, 80, out)
            "data:image/jpeg;base64," + android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP)
        } finally { r.release() }
    }.getOrNull()

    private fun get(url: String, headers: Map<String, String> = emptyMap(), ua: String = DESKTOP): String {
        val b = Request.Builder().url(url).header("User-Agent", ua)
        headers.forEach { (k, v) -> b.header(k, v) }
        http.newCall(b.build()).execute().use { r ->
            if (!r.isSuccessful) throw Fail("The site answered " + r.code)
            return r.body?.string() ?: ""
        }
    }

    // the length of a file without downloading it: the answer to a request of its first byte says how long it is
    private fun sizeOf(url: String, headers: Map<String, String> = emptyMap()): Long = runCatching {
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

    // the answer of the open data service: tweet.media.videos[] { url, thumbnail_url, duration, type, width, height }
    internal fun xFromFx(j: JSONObject): Pair<Info, Src> {
        val t = j.optJSONObject("tweet") ?: throw Fail("That post could not be read")
        val au = t.optJSONObject("author")
        val handle = au?.optString("screen_name").orEmpty(); val name = au?.optString("name").orEmpty()
        val vids = t.optJSONObject("media")?.optJSONArray("videos")
        var best: JSONObject? = null
        if (vids != null) for (i in 0 until vids.length()) {
            val v = vids.optJSONObject(i) ?: continue
            if (!v.optString("url").startsWith("https://")) continue
            if (best == null || v.optInt("height") * v.optInt("width") > best.optInt("height") * best.optInt("width")) best = v
        }
        val v = best ?: throw Fail("That post has no video or gif")
        val gif = v.optString("type") == "gif"
        val info = Info("x", if (name.isNotEmpty()) "$name (@$handle)" else "@$handle", "@$handle", v.optString("thumbnail_url").takeIf { it.startsWith("https://") }, v.optDouble("duration", 0.0).toInt(), if (gif) "gif" else "video")
        return info to Src(v.optString("url"), "video/mp4", "mp4")
    }

    internal fun xParse(j: JSONObject): Pair<Info, Src> {
        val user = j.optJSONObject("user")
        val handle = user?.optString("screen_name").orEmpty()
        val name = user?.optString("name").orEmpty()
        val items = ArrayList<JSONObject>()
        j.optJSONArray("mediaDetails")?.let { a -> for (i in 0 until a.length()) a.optJSONObject(i)?.let(items::add) }
        val vid = items.firstOrNull { it.optString("type") == "video" || it.optString("type") == "animated_gif" }
        val variants = vid?.optJSONObject("video_info")?.optJSONArray("variants") ?: j.optJSONObject("video")?.optJSONArray("variants")
        if (variants == null) throw Fail("That post has no video or gif")
        var best: JSONObject? = null
        for (i in 0 until variants.length()) {
            val v = variants.optJSONObject(i) ?: continue
            if (!v.optString("content_type", v.optString("type")).contains("mp4")) continue
            if (best == null || v.optInt("bitrate") > best.optInt("bitrate")) best = v
        }
        val file = best?.optString("url").orEmpty().takeIf { it.startsWith("https://") } ?: throw Fail("No file found in that post")
        val gif = vid?.optString("type") == "animated_gif"
        val thumb = (vid?.optString("media_url_https") ?: j.optJSONObject("video")?.optString("poster")).orEmpty().takeIf { it.startsWith("https://") }
        val ms = vid?.optJSONObject("video_info")?.optLong("duration_millis") ?: 0L
        val info = Info("x", (if (name.isNotEmpty()) "$name (@$handle)" else "@$handle"), "@$handle", thumb, (ms / 1000).toInt(), if (gif) "gif" else "video")
        return info to Src(file, "video/mp4", "mp4")
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

    private fun xResolve(user: String, id: String, q: String): Pair<Info, Src> {
        var why: Fail? = null
        val maxH = maxHeight(q)
        // 1. the open data service (its files go up to the full size of the video)
        val a = runCatching { xFromFx(JSONObject(get("https://api.fxtwitter.com/$user/status/$id"))) }
        a.exceptionOrNull()?.let { if (it is Fail) why = it }
        // 2. the embed data of the post: it lists every size, so a smaller one can be chosen
        val bj = runCatching { JSONObject(get("https://cdn.syndication.twimg.com/tweet-result?id=$id&token=" + xToken(id))) }
        val b = bj.mapCatching { xParse(it) }
        val files = bj.getOrNull()?.let { xFiles(it) }.orEmpty()
        val picked = xPick(files, maxH)
        val base = a.getOrNull() ?: b.getOrNull()
        if (base != null) {
            val fxHeight = files.firstOrNull { it.first == base.second.url }?.second ?: 0
            // the full size file is kept when it fits what was asked for, otherwise the size that fits is taken
            val use = if (picked != null && (q.isNotEmpty() || fxHeight > maxH || fxHeight == 0 && files.isNotEmpty())) picked else base.second.url
            return base.first to Src(use, "video/mp4", "mp4")
        }
        // a post that really has no video says so; a service that did not answer says that
        val f = b.exceptionOrNull()
        val first = why
        if (first != null && f is Fail && f.message?.contains("no video") == true) throw first
        throw (f as? Fail) ?: first ?: Fail("Could not read that post (" + (f?.message ?: "no answer").take(60) + ")")
    }

    // ---- YouTube: the extractor of NewPipe; the best picture up to 4K (30 pictures a second above full HD) joined with the best sound ----
    private fun ytResolve(id: String, q: String): Pair<Info, Src> {
        val first = runCatching { YtExtract.get(id, maxHeight(q), if (q == "4k") 30 else 60) }
        first.getOrNull()?.let { g ->
            val plain = Src(g.plain.url, "video/mp4", "mp4")
            val v = g.video; val a = g.audio
            val src = if (v != null && a != null) Src(v.url, if (v.webm) "video/webm" else "video/mp4", if (v.webm) "webm" else "mp4", audio = a.url, webm = v.webm, plain = plain) else plain
            val size = if (v != null && a != null) (if (v.size > 0 && a.size > 0) v.size + a.size else 0L) else g.plain.size
            return Info("youtube", g.title.ifEmpty { "YouTube video" }, g.author, g.thumb ?: "https://i.ytimg.com/vi/$id/hqdefault.jpg", g.dur, "video", size) to src
        }
        val e = first.exceptionOrNull()
        throw Fail("Could not get this video (" + ((if (e is Fail) e.message else e?.message ?: e?.javaClass?.simpleName).orEmpty().lineSequence().firstOrNull().orEmpty().take(120).ifEmpty { "not playable" }) + ")")
    }

    // ---- Instagram: the open mirrors of Instagram embeds (they read the post with their own sign in and hand out the files) ----
    private val mirrors = listOf("kkinstagram.com", "ddinstagram.com")

    internal fun metaOf(html: String, key: String): String? =
        Regex("<meta[^>]+(?:property|name)=\"$key\"[^>]+content=\"([^\"]*)\"", RegexOption.IGNORE_CASE).find(html)?.groupValues?.get(1)
            ?: Regex("<meta[^>]+content=\"([^\"]*)\"[^>]+(?:property|name)=\"$key\"", RegexOption.IGNORE_CASE).find(html)?.groupValues?.get(1)

    private fun unent(s: String) = s.replace("&amp;", "&").replace("&quot;", "\"").replace("&#x27;", "'").replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">")

    // what a mirror says about a post in its page (the og tags)
    internal fun igFromHtml(html: String): Pair<Info, Src> {
        val video = metaOf(html, "og:video:secure_url") ?: metaOf(html, "og:video:url") ?: metaOf(html, "og:video")
        val pic = metaOf(html, "og:image")
        val who = Regex("\\(@([\\w.]+)\\)").find(metaOf(html, "og:title").orEmpty())?.groupValues?.get(1)
        val author = if (who != null) "@$who" else ""
        val v = video?.let(::unent)?.takeIf { it.startsWith("https://") }
        val p = pic?.let(::unent)?.takeIf { it.startsWith("https://") }
        if (v == null && p == null) throw Fail("Could not read this post (it may be private)")
        return if (v != null) Info("instagram", author.ifEmpty { "Instagram" }, author, p, 0, "video") to Src(v, "video/mp4", "mp4")
        else Info("instagram", author.ifEmpty { "Instagram" }, author, p, 0, "image") to Src(p!!, "image/jpeg", "jpg")
    }

    private fun igResolve(p: Pair<String, String>): Pair<Info, Src> {
        val kind = if (p.first.equals("reels", true)) "reel" else p.first.lowercase()
        val code = p.second
        var why = "no answer"
        for (m in mirrors) {
            try {
                // a mirror answers a link bot with the page of the post, or sends the file itself (a picture)
                val req = Request.Builder().url("https://$m/$kind/$code/").header("User-Agent", BOT).header("Accept-Language", "en-US,en;q=0.9").build()
                val (info, src) = still.newCall(req).execute().use { r ->
                    val loc = r.header("Location")
                    when {
                        r.code in 300..399 && loc != null && loc.startsWith("https://") -> {
                            val vid = Regex("\\.mp4(\\?|$)").containsMatchIn(loc) || loc.contains("/video")
                            if (vid) Info("instagram", "Instagram", "", null, 0, "video") to Src(loc, "video/mp4", "mp4")
                            else Info("instagram", "Instagram", "", loc, 0, "image") to Src(loc, "image/jpeg", "jpg")
                        }
                        r.isSuccessful -> igFromHtml(r.body?.string().orEmpty())
                        else -> throw Fail("answer " + r.code)
                    }
                }
                // the page of the post says who wrote it and shows the picture of a video
                val meta = if (info.author.isEmpty() || info.kind == "video" && info.thumb == null) runCatching { igFromHtml(get("https://$m/p/$code/", ua = BOT)).first }.getOrNull() else null
                val i2 = if (meta != null) Info(info.site, meta.title, meta.author.ifEmpty { info.author }, meta.thumb ?: info.thumb, info.dur, info.kind) else info
                // an address of the mirror itself is followed to the file behind it
                val real = if (src.url.contains("//$m/")) runCatching { still.newCall(Request.Builder().url(src.url).header("User-Agent", BOT).build()).execute().use { it.header("Location") } }.getOrNull()?.takeIf { it.startsWith("https://") } ?: src.url else src.url
                return i2 to Src(real, src.mime, src.ext)
            } catch (e: Exception) { why = (e as? Fail)?.message ?: e.javaClass.simpleName }
        }
        throw Fail("Could not read this post (it may be private; $why)")
    }

    // ---- the card kept in the note ----
    fun card(url: String, i: Info) = JSONObject().put("u", url).put("s", i.site).put("t", i.title.take(200)).put("a", i.author.take(80)).put("k", i.kind).put("d", i.dur).put("z", i.size)
        .apply { i.thumb?.let { put("i", it) } }
    fun card(url: String, i: Info, q: String) = card(url, i).apply { if (q.isNotEmpty()) put("q", q) }

    // a card that came from another phone or the server is checked before it is shown: a known site, an https picture, short texts
    fun cleanCard(o: JSONObject?): JSONObject? {
        o ?: return null
        val u = o.optString("u"); val s = o.optString("s")
        if (!u.startsWith("https://") || u.length > 600 || s !in setOf("x", "youtube", "instagram") || site(u) != s) return null
        val out = JSONObject().put("u", u).put("s", s).put("t", o.optString("t").take(200)).put("a", o.optString("a").take(80))
            .put("k", o.optString("k").takeIf { it in setOf("video", "gif", "image") } ?: "video").put("d", o.optInt("d").coerceIn(0, 86_400))
            .put("z", o.optLong("z").coerceIn(0L, 100_000_000_000L))
        // the picture is a link, or a small picture kept inside the note (the first frame of a video)
        o.optString("i").takeIf { (it.startsWith("https://") && it.length < 600) || (it.startsWith("data:image/jpeg;base64,") && it.length < 90_000) }?.let { out.put("i", it) }
        o.optString("q").takeIf { it in setOf("4k", "2k", "1080p", "720p") }?.let { out.put("q", it) }
        return out
    }

    // ---- saving the file ----
    private fun safeName(title: String, ext: String): String {
        val base = title.replace(Regex("[^\\p{L}\\p{N} _.-]+"), " ").replace(Regex("\\s+"), " ").trim().take(60).ifEmpty { "nook" }
        return "$base ${System.currentTimeMillis() % 100000}.$ext"
    }

    private fun download(src: String, headers: Map<String, String>, to: File, onBytes: (Long) -> Unit) {
        val req = Request.Builder().url(src).header("User-Agent", DESKTOP).apply { headers.forEach { (k, v) -> header(k, v) } }.build()
        http.newCall(req).execute().use { r ->
            if (!r.isSuccessful) throw Fail("The download was refused (" + r.code + ")")
            val body = r.body ?: throw Fail("Nothing came back")
            to.outputStream().use { o ->
                val buf = ByteArray(64 * 1024)
                body.byteStream().use { i -> while (true) { val n = i.read(buf); if (n < 0) break; o.write(buf, 0, n); onBytes(n.toLong()) } }
            }
        }
    }

    // a short looping clip as a real gif file: frames are read from the clip and written with the app's own gif encoder
    internal fun toGif(clip: File): ByteArray? {
        val r = android.media.MediaMetadataRetriever()
        try {
            r.setDataSource(clip.path)
            val durMs = r.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: return null
            val fps = 12
            val n = minOf(120, maxOf(2, (durMs * fps / 1000).toInt()))
            val frames = ArrayList<IntArray>(); var w = 0; var h = 0
            for (i in 0 until n) {
                val bm = r.getFrameAtTime(i * 1_000_000L / fps, android.media.MediaMetadataRetriever.OPTION_CLOSEST) ?: continue
                if (w == 0) { w = minOf(480, bm.width); h = (bm.height * (w.toFloat() / bm.width)).toInt().coerceAtLeast(1) }
                val sc = if (bm.width == w) bm else android.graphics.Bitmap.createScaledBitmap(bm, w, h, true)
                val px = IntArray(w * h); sc.getPixels(px, 0, w, 0, 0, w, h); frames.add(px)
            }
            return if (frames.size < 2) null else Gif.encode(frames, w, h, fps)
        } finally { r.release() }
    }

    // joins a picture file and a sound file into one, without changing either (no re-encoding)
    internal fun mux(video: File, audio: File, out: File, webm: Boolean) {
        val vx = MediaExtractor().apply { setDataSource(video.path) }
        val ax = MediaExtractor().apply { setDataSource(audio.path) }
        try {
            fun track(x: MediaExtractor, kind: String) = (0 until x.trackCount).first { x.getTrackFormat(it).getString(MediaFormat.KEY_MIME).orEmpty().startsWith(kind) }
            val vi = track(vx, "video/"); val ai = track(ax, "audio/")
            vx.selectTrack(vi); ax.selectTrack(ai)
            val m = MediaMuxer(out.path, if (webm) MediaMuxer.OutputFormat.MUXER_OUTPUT_WEBM else MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            val vt = m.addTrack(vx.getTrackFormat(vi)); val at = m.addTrack(ax.getTrackFormat(ai))
            m.start()
            val buf = ByteBuffer.allocate(8 shl 20); val info = MediaCodec.BufferInfo()
            fun copy(x: MediaExtractor, t: Int) {
                while (true) {
                    val n = x.readSampleData(buf, 0); if (n < 0) break
                    info.set(0, n, x.sampleTime, if (x.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
                    m.writeSampleData(t, buf, info); x.advance()
                }
            }
            copy(vx, vt); copy(ax, at)
            m.stop(); m.release()
        } finally { vx.release(); ax.release() }
    }

    // the file goes to Movies/Nook (Pictures/Nook for a picture), where the gallery finds it; progress is a number from 0 to 1
    suspend fun save(ctx: Context, url: String, q: String, onProgress: (Float) -> Unit): Uri = withContext(Dispatchers.IO) {
        val (info, first) = resolve(url, q)
        val tmp = File(ctx.cacheDir, "media").apply { mkdirs() }
        tmp.listFiles()?.forEach { runCatching { it.delete() } }
        val made = File(tmp, "out." + (if (first.audio != null && first.webm) "webm" else "mp4"))
        var src = first
        val total = (info.size.takeIf { it > 0 } ?: 1L).toFloat()
        var got = 0L
        var final: File? = null
        try {
            // the best quality is two files joined together; if that does not work, the one-piece file of a lower quality is used
            val audio = first.audio
            if (audio != null) {
                try {
                    val v = File(tmp, "v.part"); val a = File(tmp, "a.part")
                    val tick = { n: Long -> got += n; onProgress((got / total * 0.92f).coerceIn(0f, 0.92f)) }
                    download(first.url, first.headers, v, tick); download(audio, first.headers, a, tick)
                    mux(v, a, made, first.webm)
                    final = made
                } catch (e: Exception) {
                    val plain = first.plain ?: throw e
                    runCatching { made.delete() }; src = plain; got = 0
                }
            }
            if (final == null) {
                val one = File(tmp, "one." + src.ext)
                val share = if (src === first) total else 1f
                download(src.url, src.headers, one) { n -> got += n; if (src === first) onProgress((got / share * 0.92f).coerceIn(0f, 0.92f)) }
                final = one
            }
            var cur: File = final!!
            // the file says what it is: a gif stays a gif, and a looping clip that X calls a gif is made a real gif file
            val head = ByteArray(12).also { b -> cur.inputStream().use { it.read(b) } }
            val isGifFile = head[0] == 'G'.code.toByte() && head[1] == 'I'.code.toByte() && head[2] == 'F'.code.toByte()
            if (!isGifFile && info.kind == "gif") {
                val g = runCatching { toGif(cur) }.getOrNull()
                if (g != null) { val gf = File(tmp, "clip.gif"); gf.writeBytes(g); cur = gf }
            }
            val file: File = cur
            val ext = if (isGifFile || file.extension == "gif") "gif" else file.extension
            val mime = if (ext == "gif") "image/gif" else if (ext == "webm") "video/webm" else if (src.mime.startsWith("image/")) src.mime else "video/mp4"
            val image = mime.startsWith("image/")
            val name = safeName(info.title, ext)
            val resolver = ctx.contentResolver
            val result: Uri
            if (Build.VERSION.SDK_INT >= 29) {
                val cv = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, name); put(MediaStore.MediaColumns.MIME_TYPE, mime)
                    put(MediaStore.MediaColumns.RELATIVE_PATH, (if (image) Environment.DIRECTORY_PICTURES else Environment.DIRECTORY_MOVIES) + "/Nook")
                    put(MediaStore.MediaColumns.IS_PENDING, 1)
                }
                val uri = resolver.insert(if (image) MediaStore.Images.Media.EXTERNAL_CONTENT_URI else MediaStore.Video.Media.EXTERNAL_CONTENT_URI, cv) ?: throw Fail("Could not create the file")
                try { (resolver.openOutputStream(uri) ?: throw Fail("Could not create the file")).use { o -> file.inputStream().use { it.copyTo(o) } } }
                catch (e: Exception) { runCatching { resolver.delete(uri, null, null) }; throw e }
                resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
                result = uri
            } else {
                val dir = ctx.getExternalFilesDir(if (image) Environment.DIRECTORY_PICTURES else Environment.DIRECTORY_MOVIES) ?: throw Fail("No place to save")
                val f = File(dir, name); file.copyTo(f, true)
                result = androidx.core.content.FileProvider.getUriForFile(ctx, ctx.packageName + ".files", f)
            }
            onProgress(1f)
            result
        } finally { tmp.listFiles()?.forEach { runCatching { it.delete() } } }
    }
}
