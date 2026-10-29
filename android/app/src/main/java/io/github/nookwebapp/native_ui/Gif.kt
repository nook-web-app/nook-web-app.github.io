package io.github.nookwebapp.native_ui

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Movie

// Moving pictures, the way the web app handles them: a big GIF is made again smaller (at most 480 pixels, 12 frames a
// second) and the smaller file is kept, and a GIF for the profile picture or banner is cropped frame by frame. The
// encoder is the web app's gifEncode() (a 255 color palette by median cut, ordered dithering, unchanged pixels left
// see-through, LZW), so both apps make the same files.
@Suppress("DEPRECATION")
object Gif {
    const val MAX = 12 shl 20

    fun isGif(b: ByteArray) = b.size > 3 && b[0] == 'G'.code.toByte() && b[1] == 'I'.code.toByte() && b[2] == 'F'.code.toByte()

    // the frames of a GIF at 12 a second, each drawn on white into w x h pixels from the part src (x, y, w, h) of the
    // picture; at most maxFrames of them
    private fun frames(mv: Movie, sx: Float, sy: Float, sw: Float, sh: Float, w: Int, h: Int, maxFrames: Int): List<IntArray> {
        val dur = maxOf(0, mv.duration())
        val bm = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val cv = Canvas(bm)
        val out = ArrayList<IntArray>()
        var t = 0.0
        val step = 1000.0 / 12
        do {
            cv.save()
            cv.drawColor(Color.WHITE)
            cv.scale(w / sw, h / sh)
            cv.translate(-sx, -sy)
            mv.setTime(t.toInt())
            mv.draw(cv, 0f, 0f)
            cv.restore()
            out.add(IntArray(w * h).also { bm.getPixels(it, 0, w, 0, 0, w, h) })
            t += step
        } while (t < dur && out.size < maxFrames)
        bm.recycle()
        return out
    }

    // compressGif(): a GIF over 1.5 MB is made again at a smaller size; whichever file is smaller is kept. null when it
    // is over 12 MB and could not be made smaller
    fun compress(b: ByteArray): ByteArray? {
        if (b.size <= 1_572_864) return b
        val made = runCatching {
            val mv = Movie.decodeByteArray(b, 0, b.size) ?: return@runCatching null
            if (mv.duration() <= 0) return@runCatching null
            val vw = mv.width(); val vh = mv.height()
            val k = minOf(1f, 480f / maxOf(vw, vh))
            val w = maxOf(2, Math.round(vw * k)); val h = maxOf(2, Math.round(vh * k))
            // the frames are all held in memory until the GIF is made again (about 96 MB at most)
            val maxFrames = maxOf(36, minOf(12 * 15, (96e6 / (w * h * 4)).toInt()))
            encode(frames(mv, 0f, 0f, vw.toFloat(), vh.toFloat(), w, h, maxFrames), w, h, 12)
        }.getOrNull()
        if (made != null && made.size < b.size) return made
        return if (b.size > MAX) null else b
    }

    // cropGif(): the part (x, y, w, h, in the GIF's own pixels) of every frame, at most 256 (round picture) or 360 pixels
    fun crop(b: ByteArray, x: Float, y: Float, w: Float, h: Float, outW: Int, outH: Int, round: Boolean): ByteArray? = runCatching {
        if (b.size > MAX) return null
        val mv = Movie.decodeByteArray(b, 0, b.size) ?: return null
        val k = minOf(1f, (if (round) 256f else 360f) / maxOf(outW, outH))
        val W = maxOf(2, Math.round(outW * k)); val H = maxOf(2, Math.round(outH * k))
        // a larger crop keeps fewer frames (about 48 MB at most)
        val maxFrames = if (mv.duration() <= 0) 1 else maxOf(24, minOf(12 * 8, (48e6 / (W * H * 4)).toInt()))
        encode(frames(mv, x, y, w, h, W, H, maxFrames), W, H, 12)
    }.getOrNull()

    // the size of a GIF's picture (its first frame)
    fun size(b: ByteArray): Pair<Int, Int>? = runCatching { Movie.decodeByteArray(b, 0, b.size)?.let { it.width() to it.height() } }.getOrNull()

    // ---- the encoder (gifEncode, medianCut and lzw of app.js) ----

    private val BAYER = intArrayOf(0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5)

    fun encode(fr: List<IntArray>, w: Int, h: Int, fps: Int): ByteArray {
        val P = w * h
        val tot = fr.size.toLong() * P
        val st = maxOf(1L, tot / 30000)
        val smp = java.io.ByteArrayOutputStream()
        var g = 0L
        while (g < tot) {
            val px = fr[(g / P).toInt()][(g % P).toInt()]
            smp.write((px shr 16) and 255); smp.write((px shr 8) and 255); smp.write(px and 255)
            g += st
        }
        val pal = medianCut(smp.toByteArray(), 255)
        val n = pal.size
        val cache = ShortArray(65536) { -1 }
        fun near(r: Int, gg: Int, b: Int): Int {
            var bi = 0; var bd = Int.MAX_VALUE
            for (k in 0 until n) {
                val c = pal[k]
                val d = (c[0] - r) * (c[0] - r) + (c[1] - gg) * (c[1] - gg) + (c[2] - b) * (c[2] - b)
                if (d < bd) { bd = d; bi = k }
            }
            return bi
        }
        val out = java.io.ByteArrayOutputStream()
        out.write(byteArrayOf(71, 73, 70, 56, 57, 97))
        out.write(w and 255); out.write(w shr 8); out.write(h and 255); out.write(h shr 8); out.write(247); out.write(0); out.write(0)
        for (k in 0 until 256) { val c = pal.getOrNull(k) ?: intArrayOf(0, 0, 0); out.write(c[0]); out.write(c[1]); out.write(c[2]) }
        out.write(byteArrayOf(33, -1, 11, 78, 69, 84, 83, 67, 65, 80, 69, 50, 46, 48, 3, 1, 0, 0, 0))
        val shown = IntArray(P)
        val idx = ByteArray(P)
        val dl = maxOf(2, Math.round(100.0 / fps).toInt())
        for (f in fr.indices) {
            val px = fr[f]
            for (p in 0 until P) {
                val y = p / w; val x = p % w
                val t = ((BAYER[((y and 3) shl 2) or (x and 3)] - 7.5) * 1.2)
                val v = px[p]
                val r = (((v shr 16) and 255) + t).coerceIn(0.0, 255.0).toInt()
                val gg = (((v shr 8) and 255) + t).coerceIn(0.0, 255.0).toInt()
                val b = ((v and 255) + t).coerceIn(0.0, 255.0).toInt()
                val key = ((r shr 3) shl 11) or ((gg shr 2) shl 5) or (b shr 3)
                var q = cache[key].toInt()
                if (q < 0) { q = near(r, gg, b); cache[key] = q.toShort() }
                val a = pal[q]; val z = pal[shown[p]]
                // a pixel that hardly changed is left see-through, so the frame keeps the one under it
                if (f > 0 && (a[0] - z[0]) * (a[0] - z[0]) + (a[1] - z[1]) * (a[1] - z[1]) + (a[2] - z[2]) * (a[2] - z[2]) < 90) idx[p] = 255.toByte()
                else { idx[p] = q.toByte(); shown[p] = q }
            }
            out.write(byteArrayOf(33, -7, 4, 5, (dl and 255).toByte(), (dl shr 8).toByte(), -1, 0, 44, 0, 0, 0, 0, (w and 255).toByte(), (w shr 8).toByte(), (h and 255).toByte(), (h shr 8).toByte(), 0))
            out.write(lzw(idx))
        }
        out.write(59)
        return out.toByteArray()
    }

    private fun medianCut(s: ByteArray, n: Int): List<IntArray> {
        class Bx(val ix: IntArray, val ch: Int, val sp: Double)
        fun ch(i: Int, c: Int) = s[i * 3 + c].toInt() and 255
        fun mk(ix: IntArray): Bx {
            val lo = intArrayOf(255, 255, 255); val hi = intArrayOf(0, 0, 0)
            for (i in ix) for (c in 0..2) { val v = ch(i, c); if (v < lo[c]) lo[c] = v; if (v > hi[c]) hi[c] = v }
            var best = 0
            for (c in 1..2) if (hi[c] - lo[c] > hi[best] - lo[best]) best = c
            return Bx(ix, best, if (ix.size > 1) (hi[best] - lo[best]) * Math.sqrt(ix.size.toDouble()) else -1.0)
        }
        val bx = arrayListOf(mk(IntArray(s.size / 3) { it }))
        while (bx.size < n) {
            var bi = 0
            for (k in 1 until bx.size) if (bx[k].sp > bx[bi].sp) bi = k
            val b = bx[bi]
            if (b.sp <= 0) break
            val sorted = b.ix.sortedBy { ch(it, b.ch) }.toIntArray()
            val m = sorted.size shr 1
            bx.removeAt(bi)
            bx.add(bi, mk(sorted.copyOfRange(m, sorted.size)))
            bx.add(bi, mk(sorted.copyOfRange(0, m)))
        }
        return bx.map { b -> val t = LongArray(3); for (i in b.ix) for (c in 0..2) t[c] += ch(i, c).toLong(); IntArray(3) { c -> Math.round(t[c].toDouble() / b.ix.size).toInt() } }
    }

    private fun lzw(ix: ByteArray): ByteArray {
        val table = IntArray(1 shl 20)
        val raw = java.io.ByteArrayOutputStream()
        var acc = 0; var nb = 0; var size = 9; var mx = 511; var nx = 258
        fun emit(c: Int, reset: Boolean = false) {
            acc = acc or (c shl nb)
            nb += size
            while (nb >= 8) { raw.write(acc and 255); acc = acc ushr 8; nb -= 8 }
            if (reset) { size = 9; mx = 511 }
            else if (nx > mx && size < 12) { size++; mx = (1 shl size) - 1 }
        }
        emit(256)
        var pre = ix[0].toInt() and 255
        for (i in 1 until ix.size) {
            val k = ix[i].toInt() and 255
            val e = table[pre * 256 + k]
            if (e != 0) pre = e
            else {
                emit(pre)
                if (nx < 4096) table[pre * 256 + k] = nx++
                else { java.util.Arrays.fill(table, 0); nx = 258; emit(256, true) }
                pre = k
            }
        }
        emit(pre)
        emit(257)
        if (nb > 0) raw.write(acc and 255)
        val r = raw.toByteArray()
        val out = java.io.ByteArrayOutputStream()
        out.write(8)
        var i = 0
        while (i < r.size) { val m = minOf(255, r.size - i); out.write(m); out.write(r, i, m); i += m }
        out.write(0)
        return out.toByteArray()
    }
}
