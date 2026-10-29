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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
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
            src.startsWith("http") -> {
                val f = diskFile(src)
                if (f != null && f.exists()) f.readBytes()
                else fetch(src)?.also { b -> f?.let { runCatching { it.parentFile?.mkdirs(); File(it.parentFile, it.name + ".part").apply { writeBytes(b) }.renameTo(it) } } }
            }
            else -> File(src).takeIf { it.exists() }?.readBytes()
        }
    } catch (e: Exception) { null }

    private fun diskFile(url: String): File? = cacheDir?.let { File(File(it, "img"), Crypto.sha1Hex(url).lowercase()) }
    // pictures of other people are only loaded from this app's own storage or inline data, never from an address they chose
    fun ownMedia(u: String?) = u != null && (u.startsWith("data:image/") || u.startsWith(SB_URL + "/storage/v1/object/public/media/") || u.startsWith("/"))
    private fun fetch(url: String): ByteArray? = try {
        Sb.http.newCall(okhttp3.Request.Builder().url(url).build()).execute().use { r -> if (r.isSuccessful) r.body?.bytes() else null }
    } catch (e: Exception) { null }
    // the cache of downloaded pictures is kept under 150 MB, the oldest go first
    fun trimCache() {
        val d = cacheDir?.let { File(it, "img") } ?: return
        val fs = d.listFiles()?.sortedBy { it.lastModified() } ?: return
        var total = fs.sumOf { it.length() }
        for (f in fs) { if (total < 150L shl 20) break; total -= f.length(); f.delete() }
    }
    fun intake(ctx: Context, dir: File, uri: Uri): String? = intakeOrNull(ctx, dir, uri)
    private fun intakeOrNull(ctx: Context, dir: File, uri: Uri): String? = try {
        val cr = ctx.contentResolver
        val type = cr.getType(uri) ?: ""
        if (type.startsWith("video/")) throw IllegalArgumentException("video")
        val bytes = cr.openInputStream(uri)!!.use { it.readBytes() }
        if (type == "image/gif" || (bytes.size > 3 && bytes[0] == 'G'.code.toByte() && bytes[1] == 'I'.code.toByte() && bytes[2] == 'F'.code.toByte())) {
            File(dir, uid() + ".gif").apply { writeBytes(bytes) }.absolutePath
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
        if (path.startsWith("http")) { val f = diskFile(path); if (f == null || !f.exists()) return null; return bounds(f.path)?.also { dims.put(path, it) } }
        if (path.startsWith("data:")) return null
        bounds(path)?.also { dims.put(path, it) }
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

// one saved photo, cropped to fill its box (object-fit: cover) unless told otherwise; the box shows --bg2 while it loads
@Composable
fun Pic(path: String?, modifier: Modifier = Modifier, want: Int = 1280, scale: ContentScale = ContentScale.Crop, smooth: Boolean = false, onLoad: ((Int, Int) -> Unit)? = null) {
    val c = LocalNook.current
    // previews and the screenshot tests draw one frame only, so there the photo is read at once
    val now = androidx.compose.ui.platform.LocalInspectionMode.current || Photos.sync
    var bm by remember(path, want) { mutableStateOf(path?.let { Photos.cached(it, want) ?: if (now) Photos.loadNow(it, want) else null }) }
    LaunchedEffect(path, want) { if (bm == null && path != null) bm = Photos.load(path, want); bm?.let { b -> path?.let { Photos.size(it) }?.let { onLoad?.invoke(it.first, it.second) } ?: onLoad?.invoke(b.width, b.height) } }
    val b = bm
    if (b != null) Image(b, null, modifier, contentScale = scale, filterQuality = if (smooth) androidx.compose.ui.graphics.FilterQuality.High else androidx.compose.ui.graphics.FilterQuality.Low)
    else Box(modifier.background(c.bg2))
}
