package io.github.nookwebapp.native_ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.ui.draw.clip
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File

// Photos are kept as files in the app's own storage. A picked photo goes through the same steps as intake() in the web
// app: turned the right way up, made at most 1280 pixels on its longest side and saved as JPEG at quality 80 (lower
// steps while it is over 900 KB); one with see-through pixels stays a WebP. GIFs are kept as they are.
object Photos {
    // the screenshot tests set this, so photos are read before the one frame they take
    var sync = false
    // where the photos of other people (links to this app's storage) are kept once downloaded; set by the activity
    var cacheDir: File? = null

    // the bytes of any picture the app shows: a file on this phone, a data address (profile pictures on the server are
    // kept that way) or a link to this app's own storage (downloaded once and kept in the cache)
    fun bytesOf(src: String): ByteArray? = try {
        when {
            src.startsWith("data:") -> java.util.Base64.getDecoder().decode(src.substring(src.indexOf(',') + 1))
            src.startsWith("http") -> Img.diskFile(src)?.takeIf { it.exists() }?.readBytes() ?: fetch(src)
            else -> localFile(src)?.takeIf { it.exists() }?.readBytes()
        }
    } catch (e: Exception) { null }

    // a local picture is only read from the cache or a media folder of this app, so a crafted post cannot name another private file
    fun localFile(src: String): File? = runCatching {
        val f = File(src).canonicalFile
        val cache = cacheDir?.canonicalPath
        f.takeIf { (cache != null && it.path.startsWith(cache + File.separator)) || it.parentFile?.name == "media" }
    }.getOrNull()

    // pictures of other people are only loaded from this app's own storage or inline data, never from an address they chose
    // (a local file path is never accepted here: somebody else's profile row must not make this phone read its own files)
    fun ownMedia(u: String?) = u != null && ((u.startsWith("data:image/") && u.length <= MAX_INLINE) || u.startsWith(SB_URL + "/storage/v1/object/public/media/"))
    // the longest inline picture of a profile row that is drawn
    const val MAX_INLINE = 400_000
    private fun fetch(url: String): ByteArray? = try {
        Sb.http.newCall(okhttp3.Request.Builder().url(url).build()).execute().use { r -> if (r.isSuccessful) r.body?.let { b -> readCapped(b) } else null }
    } catch (e: Exception) { null }
    // a response over 30 MB is dropped, also when the server did not say its length
    private fun readCapped(b: okhttp3.ResponseBody): ByteArray? {
        val max = 30L shl 20
        if (b.contentLength() > max) return null
        val src = b.source()
        src.request(max + 1)
        return if (src.buffer.size > max) null else src.readByteArray()
    }
    // the old cache of downloaded pictures (before Coil kept them) is removed
    fun trimCache() { cacheDir?.let { File(it, "img") }?.takeIf { it.exists() }?.deleteRecursively() }
    fun intake(ctx: Context, dir: File, uri: Uri): String? = intakeOrNull(ctx, dir, uri)
    private fun intakeOrNull(ctx: Context, dir: File, uri: Uri): String? = try {
        val cr = ctx.contentResolver
        val type = cr.getType(uri) ?: ""
        if (type.startsWith("video/")) throw IllegalArgumentException("video")
        // a stream over 40 MB is refused while it is read, before it can fill the memory
        val bytes = cr.openInputStream(uri)!!.use { ins ->
            val buf = ByteArrayOutputStream(); val chunk = ByteArray(64 * 1024); var total = 0L
            while (true) {
                val n = ins.read(chunk)
                if (n < 0) break
                total += n
                if (total > (40L shl 20)) throw IllegalArgumentException("too big")
                buf.write(chunk, 0, n)
            }
            buf.toByteArray()
        }
        if (type == "image/gif" || Gif.isGif(bytes)) {
            // a big one is made again smaller; one over 12 MB that cannot be made smaller is refused
            val g = Gif.compress(bytes) ?: throw IllegalArgumentException("gif over 12 MB")
            File(dir, uid() + ".gif").apply { writeBytes(g) }.absolutePath
        } else decodeUpright(bytes, 1280)?.let { saveBitmap(dir, it, type) }
    } catch (e: Exception) { null }

    // decoded at the size it is needed (a power of two above it), then scaled down exactly and turned upright
    fun decodeUpright(bytes: ByteArray, max: Int): Bitmap? {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, o)
        if (o.outWidth <= 0) return null
        var sample = 1
        while (maxOf(o.outWidth, o.outHeight) / (sample * 2) >= max) sample *= 2
        var bm = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
        val s = minOf(1f, max.toFloat() / maxOf(bm.width, bm.height))
        val rot = try {
            when (android.media.ExifInterface(bytes.inputStream()).getAttributeInt(android.media.ExifInterface.TAG_ORIENTATION, 1)) { 6 -> 90f; 3 -> 180f; 8 -> 270f; else -> 0f }
        } catch (e: Exception) { 0f }
        if (s < 1f || rot != 0f) {
            val m = Matrix().apply { postScale(s, s); postRotate(rot) }
            bm = Bitmap.createBitmap(bm, 0, 0, bm.width, bm.height, m, true)
        }
        return bm
    }

    fun saveBitmap(dir: File, bm: Bitmap, type: String = "image/jpeg"): String {
        val alpha = (type == "image/png" || type == "image/webp") && bm.hasAlpha() && hasClear(bm)
        val out = ByteArrayOutputStream()
        if (alpha) {
            @Suppress("DEPRECATION")
            bm.compress(if (android.os.Build.VERSION.SDK_INT >= 30) Bitmap.CompressFormat.WEBP_LOSSY else Bitmap.CompressFormat.WEBP, 85, out)
            return File(dir, uid() + ".webp").apply { writeBytes(out.toByteArray()) }.absolutePath
        }
        // a photo is put on white first, like the web app's canvas, so nothing see-through turns black
        val flat = if (bm.hasAlpha()) Bitmap.createBitmap(bm.width, bm.height, Bitmap.Config.ARGB_8888).also { android.graphics.Canvas(it).apply { drawColor(android.graphics.Color.WHITE); drawBitmap(bm, 0f, 0f, null) } } else bm
        var q = 80
        do { out.reset(); flat.compress(Bitmap.CompressFormat.JPEG, q, out); q -= 10 } while (out.size() > 900 * 1024 && q >= 50)
        return File(dir, uid() + ".jpg").apply { writeBytes(out.toByteArray()) }.absolutePath
    }

    private fun hasClear(bm: Bitmap): Boolean {
        val step = maxOf(1, (bm.width * bm.height) / 40000)
        val px = IntArray(bm.width * bm.height).also { bm.getPixels(it, 0, bm.width, 0, 0, bm.width, bm.height) }
        var i = 0
        while (i < px.size) { if ((px[i] ushr 24) < 250) return true; i += step }
        return false
    }

    // width/height of a saved photo, read without decoding it
    private val dims = LruCache<String, Pair<Int, Int>>(1024)
    fun size(path: String): Pair<Int, Int>? = dims.get(path) ?: run {
        if (path.startsWith("http")) return shape(path)
        if (path.startsWith("data:")) return null
        bounds(path)?.also { dims.put(path, it) }
    }
    // the shape of a photo at a link, remembered on this phone once it was drawn, so its box has the right height
    // before it loads the next time (the web app keeps the shapes the same way)
    fun shape(url: String): Pair<Int, Int>? = (Cache.read("shape:$url")?.v as? String)?.split("x")?.let { (it.getOrNull(0)?.toIntOrNull() ?: 0) to (it.getOrNull(1)?.toIntOrNull() ?: 0) }?.takeIf { it.first > 0 && it.second > 0 }
    fun noteShape(src: String, w: Int, h: Int) {
        if (w <= 0 || h <= 0 || !src.startsWith("http")) return
        val old = shape(src)
        // only the ratio matters; it is written again only when it really changed
        if (old == null || Math.abs(old.first.toFloat() / old.second - w.toFloat() / h) > 0.01f) Cache.write("shape:$src", "${w}x$h")
    }
    private fun bounds(file: String): Pair<Int, Int>? {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file, o)
        return if (o.outWidth <= 0) null else o.outWidth to o.outHeight
    }
    fun noteSize(path: String, w: Int, h: Int) { if (w > 0 && h > 0) dims.put(path, w to h) }

    private val cache = object : LruCache<String, ImageBitmap>(48 * 1024 * 1024) {
        override fun sizeOf(key: String, value: ImageBitmap) = value.width * value.height * 4
    }
    fun cached(path: String, want: Int) = cache.get("$path@$want")
    suspend fun load(path: String, want: Int): ImageBitmap? = cached(path, want) ?: withContext(Dispatchers.IO) { loadNow(path, want) }
    fun loadNow(path: String, want: Int): ImageBitmap? = try {
        val b = bytesOf(path)
        if (b == null) null else {
            val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(b, 0, b.size, o)
            noteSize(path, o.outWidth, o.outHeight)
            decodeUpright(b, want)?.asImageBitmap()?.also { cache.put("$path@$want", it) }
        }
    } catch (e: Exception) { null }
}

// one photo, cropped to fill its box (object-fit: cover) unless told otherwise; the box shows --bg2 while it loads.
// Photos are drawn by Coil: decoded at the size of their box, kept in memory and on disk (so a photo is downloaded
// once, not each time its post scrolls back into view), and GIFs move. want caps the decoded size for the few places
// that want a small copy on purpose (the blurred banner). onLoad gets the photo's width and height once it is in.
@Composable
fun Pic(path: String?, modifier: Modifier = Modifier, want: Int = 1280, scale: ContentScale = ContentScale.Crop, smooth: Boolean = false, small: Boolean = false, bare: Boolean = false, onLoad: ((Int, Int) -> Unit)? = null) {
    val c = LocalNook.current
    // previews and the screenshot tests draw one frame only, so there the photo is read at once
    val now = androidx.compose.ui.platform.LocalInspectionMode.current || Photos.sync
    if (now || path == null) {
        val bm = remember(path, want) { path?.let { Photos.cached(it, want) ?: Photos.loadNow(it, want) } }
        LaunchedEffect(bm) { bm?.let { b -> onLoad?.invoke(b.width, b.height) } }
        if (bm != null) Image(bm, null, modifier, contentScale = scale, filterQuality = if (smooth) androidx.compose.ui.graphics.FilterQuality.High else androidx.compose.ui.graphics.FilterQuality.Low)
        else Box(if (bare) modifier else modifier.background(c.bg2))
        return
    }
    var ok by remember(path) { mutableStateOf(false) }
    // a photo that cannot be loaded stops shimmering and says so; a tap tries again (it used to shimmer for ever)
    var attempt by remember(path) { mutableIntStateOf(0) }
    var failed by remember(path, attempt) { mutableStateOf(false) }
    var auto by remember(path) { mutableIntStateOf(0) }
    LaunchedEffect(failed) { if (failed && auto < 3) { kotlinx.coroutines.delay(1500L * (auto + 1)); auto++; attempt++ } }
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val req = remember(path, want, small, attempt) {
        coil.request.ImageRequest.Builder(ctx).data(Img.model(path)).apply { if (small) size(want) }.build()
    }
    if (failed && auto < 3) { Box(if (bare) modifier else modifier.background(c.bg2).shimmer()); return }
    if (failed) {
        Box(modifier.background(c.bg2).tap { auto = 0; attempt++ }, contentAlignment = androidx.compose.ui.Alignment.Center) {
            T("Could not load this photo. Tap to try again", Fs.sm, color = c.muted, align = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.padding(androidx.compose.ui.unit.Dp(16f)))
        }
        return
    }
    coil.compose.AsyncImage(
        req, null, modifier = if (ok || bare) modifier else modifier.background(c.bg2).shimmer(), imageLoader = Img.loader(ctx), contentScale = scale,
        filterQuality = if (smooth) androidx.compose.ui.graphics.FilterQuality.High else androidx.compose.ui.graphics.FilterQuality.Low,
        onError = { failed = true },
        onSuccess = { st: coil.compose.AsyncImagePainter.State.Success ->
            ok = true
            val d = st.result.drawable
            Photos.noteShape(path, d.intrinsicWidth, d.intrinsicHeight)
            onLoad?.invoke(d.intrinsicWidth, d.intrinsicHeight)
        },
    )
}

// a round picture (a profile photo): the color behind it is only drawn while there is no photo, so no ring of that
// color shows through the photo's smoothed edge
@Composable
fun RoundPic(src: String?, size: androidx.compose.ui.unit.Dp, bg: androidx.compose.ui.graphics.Brush, modifier: Modifier = Modifier, letter: @Composable () -> Unit) {
    var ok by remember(src) { mutableStateOf(false) }
    Box(modifier.size(size).clip(androidx.compose.foundation.shape.CircleShape).then(if (ok) Modifier else Modifier.background(bg)), contentAlignment = androidx.compose.ui.Alignment.Center) {
        if (!ok) letter()
        if (src != null) PicBare(src, Modifier.matchParentSize()) { ok = true }
    }
}

// a photo with nothing drawn behind it, for boxes that draw their own background until it is in
@Composable
fun PicBare(src: String, modifier: Modifier = Modifier, scale: ContentScale = ContentScale.Crop, onIn: () -> Unit = {}) {
    val now = androidx.compose.ui.platform.LocalInspectionMode.current || Photos.sync
    if (now) {
        val bm = remember(src) { Photos.cached(src, 320) ?: Photos.loadNow(src, 320) }
        LaunchedEffect(bm) { if (bm != null) onIn() }
        if (bm != null) Image(bm, null, modifier, contentScale = scale)
        return
    }
    val ctx = androidx.compose.ui.platform.LocalContext.current
    // a profile picture that did not load is asked for again a few times (cold connection after a long break)
    var attempt by remember(src) { mutableIntStateOf(0) }
    val req = remember(src, attempt) { coil.request.ImageRequest.Builder(ctx).data(Img.model(src)).build() }
    var failed by remember(src, attempt) { mutableStateOf(false) }
    LaunchedEffect(failed) { if (failed && attempt < 3) { kotlinx.coroutines.delay(1500L * (attempt + 1)); attempt++ } }
    coil.compose.AsyncImage(req, null, modifier = modifier, imageLoader = Img.loader(ctx), contentScale = scale, onError = { failed = true }, onSuccess = { onIn() })
}

// The one image loader of the app: OkHttp of the app (same connections as the server calls), a memory cache of a
// quarter of the app's memory, 300 MB of photos on disk, GIFs that move, and the inline pictures (data: addresses)
// that profile rows keep.
object Img {
    @Volatile private var l: coil.ImageLoader? = null
    fun loader(ctx: android.content.Context): coil.ImageLoader = l ?: synchronized(this) {
        l ?: coil.ImageLoader.Builder(ctx.applicationContext)
            .okHttpClient(Sb.http)
            .components {
                add(DataSrc.Fetcher.Factory()); add(DataSrc.Key())
                if (android.os.Build.VERSION.SDK_INT >= 28) add(coil.decode.ImageDecoderDecoder.Factory()) else add(coil.decode.GifDecoder.Factory())
            }
            .memoryCache { coil.memory.MemoryCache.Builder(ctx).maxSizePercent(0.25).build() }
            .diskCache { coil.disk.DiskCache.Builder().directory(File(ctx.cacheDir, "pics")).maxSizeBytes(300L shl 20).build() }
            // the storage sends short cache times; a photo at a link never changes (a new photo gets a new name)
            .respectCacheHeaders(false)
            .build().also { l = it }
    }
    fun model(src: String): Any = when {
        src.startsWith("data:") -> DataSrc(src)
        src.startsWith("/") -> Photos.localFile(src) ?: ""
        else -> src
    }
    // the downloaded copy of a link, when Coil already has it on disk
    fun diskFile(url: String): File? = l?.diskCache?.openSnapshot(url)?.use { it.data.toFile() }
}

// a picture kept inline as a data: address, decoded straight from its text
class DataSrc(val s: String) {
    class Fetcher(private val d: DataSrc, private val o: coil.request.Options) : coil.fetch.Fetcher {
        override suspend fun fetch(): coil.fetch.FetchResult {
            if (d.s.length > Photos.MAX_INLINE) throw IllegalArgumentException("too big")
            val comma = d.s.indexOf(',')
            val bytes = java.util.Base64.getMimeDecoder().decode(d.s.substring(comma + 1))
            val type = d.s.substring(5, d.s.indexOf(';').takeIf { it in 0 until comma } ?: comma)
            return coil.fetch.SourceResult(coil.decode.ImageSource(okio.Buffer().write(bytes), o.context), type.ifEmpty { null }, coil.decode.DataSource.MEMORY)
        }
        class Factory : coil.fetch.Fetcher.Factory<DataSrc> {
            override fun create(data: DataSrc, options: coil.request.Options, imageLoader: coil.ImageLoader) = Fetcher(data, options)
        }
    }
    class Key : coil.key.Keyer<DataSrc> {
        override fun key(data: DataSrc, options: coil.request.Options) = "data:" + data.s.length + ":" + data.s.hashCode()
    }
}
