package io.github.nookwebapp.native_ui

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

// "/media <link>" in a notes chat: the card of a video or gif of YouTube, Instagram or X, with a button that saves it on this
// phone. Everything runs on the phone itself (its own connection, nothing goes through the server); only the card (the link,
// the title and the picture) is kept in the note and synced, the video is downloaded where the button is pressed.
object MediaGrab {
    class Fail(msg: String) : Exception(msg)
    class Info(val site: String, val title: String, val author: String, val thumb: String?, val dur: Int, val kind: String)
    class Src(val url: String, val mime: String, val ext: String, val headers: Map<String, String> = emptyMap())

    private val X_POST = Regex("^https?://(?:www\\.|mobile\\.)?(?:x|twitter)\\.com/[^/?#]+/status(?:es)?/(\\d{1,20})", RegexOption.IGNORE_CASE)
    private val IG_POST = Regex("^https?://(?:www\\.)?instagram\\.com/(?:[\\w.]+/)?(p|reel|reels|tv)/([\\w-]+)", RegexOption.IGNORE_CASE)
    private val YT_ID = Regex("(?:youtube\\.com/(?:watch\\?(?:.*&)?v=|shorts/|embed/|live/)|youtu\\.be/)([\\w-]{6,})", RegexOption.IGNORE_CASE)
    private val CMD = Regex("^/media(?:\\s+(\\S+))?\\s*$", RegexOption.IGNORE_CASE)
    private const val DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

    private val http: OkHttpClient = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).followRedirects(true).build()

    // the link of a "/media" message: null when the text is not that command, "" when the link is missing
    fun command(text: String): String? = CMD.find(text.trim())?.let { it.groupValues[1] }

    // "x", "youtube" or "instagram"; null for any other link
    fun site(url: String): String? = when {
        X_POST.containsMatchIn(url) -> "x"
        YT_ID.containsMatchIn(url) -> "youtube"
        IG_POST.containsMatchIn(url) -> "instagram"
        else -> null
    }
    fun siteName(site: String) = when (site) { "x" -> "X"; "youtube" -> "YouTube"; else -> "Instagram" }

    // the card and the address of the file, worked out together (the address of a file runs out, so it is asked again at download)
    suspend fun resolve(url: String): Pair<Info, Src> = withContext(Dispatchers.IO) {
        when (site(url)) {
            "x" -> xResolve(X_POST.find(url)!!.groupValues[1])
            "youtube" -> ytResolve(YT_ID.find(url)!!.groupValues[1])
            "instagram" -> igResolve(IG_POST.find(url)!!.let { it.groupValues[1] to it.groupValues[2] })
            else -> throw Fail("Use a link of YouTube, Instagram or X")
        }
    }

    private fun get(url: String, headers: Map<String, String> = emptyMap()): String {
        val b = Request.Builder().url(url).header("User-Agent", DESKTOP)
        headers.forEach { (k, v) -> b.header(k, v) }
        http.newCall(b.build()).execute().use { r ->
            if (!r.isSuccessful) throw Fail("The site answered " + r.code)
            return r.body?.string() ?: ""
        }
    }

    // ---- X: the public embed data of the post lists the files of its video or gif ----
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

    private fun xResolve(id: String): Pair<Info, Src> {
        val txt = get("https://cdn.syndication.twimg.com/tweet-result?id=$id&token=" + xToken(id))
        return xParse(JSONObject(txt))
    }

    // ---- YouTube: the player of the phone apps hands out whole files (picture and sound together) ----
    private class Client(val name: String, val id: Int, val version: String, val ua: String, val extra: JSONObject)
    private val clients = listOf(
        Client("ANDROID_VR", 28, "1.60.19", "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
            JSONObject().put("deviceMake", "Oculus").put("deviceModel", "Quest 3").put("androidSdkVersion", 32).put("osName", "Android").put("osVersion", "12L")),
        Client("ANDROID", 3, "19.44.38", "com.google.android.youtube/19.44.38 (Linux; U; Android 11) gzip",
            JSONObject().put("androidSdkVersion", 30).put("osName", "Android").put("osVersion", "11")),
        Client("IOS", 5, "19.45.4", "com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)",
            JSONObject().put("deviceMake", "Apple").put("deviceModel", "iPhone16,2").put("osName", "iPhone").put("osVersion", "18.1.0.22B83")),
    )

    private fun ytResolve(id: String): Pair<Info, Src> {
        var title = ""; var author = ""; var dur = 0
        var src: Src? = null
        var why = ""
        for (c in clients) {
            val ctx = JSONObject().put("client", JSONObject().put("clientName", c.name).put("clientVersion", c.version).put("hl", "en").put("gl", "US").apply { c.extra.keys().forEach { put(it, c.extra.get(it)) } })
            val body = JSONObject().put("context", ctx).put("videoId", id).put("contentCheckOk", true).put("racyCheckOk", true)
            val req = Request.Builder().url("https://www.youtube.com/youtubei/v1/player?prettyPrint=false").header("User-Agent", c.ua)
                .header("X-YouTube-Client-Name", c.id.toString()).header("X-YouTube-Client-Version", c.version).header("Origin", "https://www.youtube.com")
                .post(body.toString().toRequestBody("application/json".toMediaType())).build()
            val j = try { http.newCall(req).execute().use { r -> JSONObject(r.body?.string() ?: "") } } catch (e: Exception) { why = "network"; continue }
            val ps = j.optJSONObject("playabilityStatus")
            if (ps?.optString("status") != "OK") { why = ps?.optString("reason").orEmpty().ifEmpty { "not playable" }; continue }
            val det = j.optJSONObject("videoDetails")
            if (det?.optBoolean("isLive") == true || det?.optBoolean("isLiveContent") == true && det.optString("lengthSeconds") == "0") throw Fail("Live streams cannot be saved")
            title = det?.optString("title").orEmpty(); author = det?.optString("author").orEmpty(); dur = det?.optString("lengthSeconds")?.toIntOrNull() ?: 0
            // formats hold picture and sound in one file; the tallest one with a plain address wins
            val fm = j.optJSONObject("streamingData")?.optJSONArray("formats")
            var best: JSONObject? = null
            if (fm != null) for (i in 0 until fm.length()) {
                val f = fm.optJSONObject(i) ?: continue
                if (!f.has("url") || !f.optString("mimeType").startsWith("video/mp4")) continue
                if (best == null || f.optInt("height") > best.optInt("height")) best = f
            }
            if (best != null) { src = Src(best.optString("url"), "video/mp4", "mp4", mapOf("User-Agent" to c.ua)); break }
            why = "no file for this video"
        }
        val s = src ?: throw Fail(if (why.isEmpty()) "Could not get this video" else "Could not get this video ($why)")
        // the title and the picture come from the public card of the video when the player did not give them
        if (title.isEmpty()) {
            runCatching { JSONObject(get("https://www.youtube.com/oembed?format=json&url=" + java.net.URLEncoder.encode("https://www.youtube.com/watch?v=$id", "UTF-8"))) }.getOrNull()?.let { title = it.optString("title"); author = it.optString("author_name") }
        }
        return Info("youtube", title.ifEmpty { "YouTube video" }, author, "https://i.ytimg.com/vi/$id/hqdefault.jpg", dur, "video") to s
    }

    // ---- Instagram: the embed page of a post carries the address of its video or picture ----
    private fun igUnescape(s: String): String = runCatching { JSONObject("{\"v\":\"" + s + "\"}").getString("v") }.getOrDefault(s.replace("\\/", "/").replace("\\u0026", "&"))

    internal fun igParse(html: String): Pair<Info, Src> {
        fun find(key: String) = Regex("\"$key\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"").find(html)?.groupValues?.get(1)?.let(::igUnescape)
        val video = find("video_url")?.takeIf { it.startsWith("https://") }
        val shot = find("display_url")?.takeIf { it.startsWith("https://") } ?: Regex("<img[^>]+class=\"EmbeddedMediaImage\"[^>]+src=\"([^\"]+)\"").find(html)?.groupValues?.get(1)?.replace("&amp;", "&")
        val who = find("username") ?: Regex("class=\"UsernameText\">([^<]+)<").find(html)?.groupValues?.get(1)
        val author = if (who != null) "@$who" else ""
        if (video == null && shot == null) throw Fail("Could not read this post (it may be private)")
        return if (video != null) Info("instagram", author.ifEmpty { "Instagram" }, author, shot, 0, "video") to Src(video, "video/mp4", "mp4")
        else Info("instagram", author.ifEmpty { "Instagram" }, author, shot, 0, "image") to Src(shot!!, "image/jpeg", "jpg")
    }

    private fun igResolve(p: Pair<String, String>): Pair<Info, Src> {
        val kind = if (p.first.equals("reels", true)) "reel" else p.first.lowercase()
        return igParse(get("https://www.instagram.com/$kind/${p.second}/embed/captioned/", mapOf("Accept-Language" to "en-US,en;q=0.9")))
    }

    // ---- the card kept in the note ----
    fun card(url: String, i: Info) = JSONObject().put("u", url).put("s", i.site).put("t", i.title.take(200)).put("a", i.author.take(80)).put("k", i.kind).put("d", i.dur)
        .apply { i.thumb?.let { put("i", it) } }

    // a card that came from another phone or the server is checked before it is shown: a known site, an https picture, short texts
    fun cleanCard(o: JSONObject?): JSONObject? {
        o ?: return null
        val u = o.optString("u"); val s = o.optString("s")
        if (!u.startsWith("https://") || u.length > 600 || s !in setOf("x", "youtube", "instagram") || site(u) != s) return null
        val out = JSONObject().put("u", u).put("s", s).put("t", o.optString("t").take(200)).put("a", o.optString("a").take(80))
            .put("k", o.optString("k").takeIf { it in setOf("video", "gif", "image") } ?: "video").put("d", o.optInt("d").coerceIn(0, 86_400))
        o.optString("i").takeIf { it.startsWith("https://") && it.length < 600 }?.let { out.put("i", it) }
        return out
    }

    // ---- saving the file ----
    private fun safeName(title: String, ext: String): String {
        val base = title.replace(Regex("[^\\p{L}\\p{N} _.-]+"), " ").replace(Regex("\\s+"), " ").trim().take(60).ifEmpty { "nook" }
        return "$base ${System.currentTimeMillis() % 100000}.$ext"
    }

    // the file goes to Movies/Nook (Pictures/Nook for a picture), where the gallery finds it; progress is a number from 0 to 1
    suspend fun save(ctx: Context, url: String, onProgress: (Float) -> Unit): Uri = withContext(Dispatchers.IO) {
        val (info, src) = resolve(url)
        val image = src.mime.startsWith("image/")
        val name = safeName(info.title, src.ext)
        val req = Request.Builder().url(src.url).header("User-Agent", DESKTOP).apply { src.headers.forEach { (k, v) -> header(k, v) } }.build()
        http.newCall(req).execute().use { r ->
            if (!r.isSuccessful) throw Fail("The download was refused (" + r.code + ")")
            val body = r.body ?: throw Fail("Nothing came back")
            val total = body.contentLength()
            val resolver = ctx.contentResolver
            var uri: Uri? = null
            var file: File? = null
            val out: java.io.OutputStream
            if (Build.VERSION.SDK_INT >= 29) {
                val cv = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, name); put(MediaStore.MediaColumns.MIME_TYPE, src.mime)
                    put(MediaStore.MediaColumns.RELATIVE_PATH, (if (image) Environment.DIRECTORY_PICTURES else Environment.DIRECTORY_MOVIES) + "/Nook")
                    put(MediaStore.MediaColumns.IS_PENDING, 1)
                }
                uri = resolver.insert(if (image) MediaStore.Images.Media.EXTERNAL_CONTENT_URI else MediaStore.Video.Media.EXTERNAL_CONTENT_URI, cv) ?: throw Fail("Could not create the file")
                out = resolver.openOutputStream(uri) ?: throw Fail("Could not create the file")
            } else {
                val dir = ctx.getExternalFilesDir(if (image) Environment.DIRECTORY_PICTURES else Environment.DIRECTORY_MOVIES) ?: throw Fail("No place to save")
                file = File(dir, name); out = file.outputStream()
            }
            try {
                out.use { o ->
                    val buf = ByteArray(64 * 1024); var done = 0L; var last = 0L
                    body.byteStream().use { i ->
                        while (true) {
                            val n = i.read(buf); if (n < 0) break
                            o.write(buf, 0, n); done += n
                            val now = System.currentTimeMillis()
                            if (total > 0 && now - last > 120) { last = now; onProgress((done.toFloat() / total).coerceIn(0f, 1f)) }
                        }
                    }
                }
            } catch (e: Exception) { uri?.let { runCatching { resolver.delete(it, null, null) } }; file?.delete(); throw e }
            if (uri != null) { resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null); onProgress(1f); return@withContext uri }
            onProgress(1f)
            androidx.core.content.FileProvider.getUriForFile(ctx, ctx.packageName + ".files", file!!)
        }
    }

}
