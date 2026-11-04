package io.github.nookwebapp.native_ui

import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.Future

/**
 * The same mp3 as [Mp3] makes, but the sound is cut in pieces of about 15 seconds and several threads encode them at once.
 * The pieces are joined without a seam: every piece is encoded from two frames before its first one to two frames after its last
 * one (the same sound, so the frames next to the cut are made from the real sound on both sides), those extra frames are thrown away,
 * and no frame leans on the one before it (no bit reservoir), so a frame is the same whichever thread made it.
 * Only for rates where one frame is 1152 samples (32, 44.1 and 48 kHz); [ok] says whether it can be used.
 */
class Mp3Par(private val out: OutputStream, private val rate: Int, private val channels: Int, private val workers: Int, private val kbps: Int = 192, private val q: Int = 9) : PcmSink {
    companion object {
        const val SPF = 1152
        private const val ROLL = 2 * SPF
        // frames in a piece: about 15 s at 44.1 kHz
        const val SLOTS = 600
        fun ok(rate: Int, channels: Int) = (rate == 32000 || rate == 44100 || rate == 48000) && (channels == 1 || channels == 2)

        private val BR1 = intArrayOf(0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0)
        private val SR1 = intArrayOf(44100, 48000, 32000, 0)

        // where each frame of an mp3 stream starts (the stream is only frames, no tag in front); stops at the first thing that is not a frame
        fun frames(b: ByteArray): IntArray {
            val at = ArrayList<Int>(b.size / 400)
            var p = 0
            while (p + 4 <= b.size) {
                val b1 = b[p + 1].toInt() and 255; val b2 = b[p + 2].toInt() and 255
                if ((b[p].toInt() and 255) != 255 || (b1 and 0xE0) != 0xE0) break
                // MPEG 1 (3), layer III (1)
                if (((b1 shr 3) and 3) != 3 || ((b1 shr 1) and 3) != 1) break
                val br = BR1[b2 shr 4]; val sr = SR1[(b2 shr 2) and 3]
                if (br == 0 || sr == 0) break
                val len = 144 * br * 1000 / sr + ((b2 shr 1) and 1)
                if (p + len > b.size) break
                at.add(p); p += len
            }
            at.add(p)
            return at.toIntArray()
        }
    }

    private val bf = 2 * channels
    private val pool = Executors.newFixedThreadPool(workers) { r -> Thread(r, "nook-mp3").apply { isDaemon = true } }
    private val pending = ArrayDeque<Future<ByteArray>>()
    private var acc = ByteArray((ROLL + SLOTS * SPF + ROLL) * bf * 2)
    private var n = 0
    // the samples in front of the next piece that belong to the one before (none for the first piece)
    private var pre = 0

    override fun write(pcm: ByteArray, len: Int) {
        if (n + len > acc.size) acc = acc.copyOf(maxOf(acc.size * 2, n + len))
        System.arraycopy(pcm, 0, acc, n, len); n += len
        while (n >= (pre + SLOTS * SPF + ROLL) * bf) {
            val need = (pre + SLOTS * SPF + ROLL) * bf
            submit(acc.copyOfRange(0, need), pre / SPF, SLOTS)
            // the next piece starts two frames before where this one's own part ends
            val from = (pre + SLOTS * SPF - ROLL) * bf
            System.arraycopy(acc, from, acc, 0, n - from); n -= from
            pre = ROLL
        }
        drain(false)
    }

    private fun submit(piece: ByteArray, first: Int, keep: Int) {
        pending.addLast(pool.submit(Callable {
            val o = ByteArrayOutputStream(piece.size / 6)
            val e = Mp3(o, rate, channels, kbps, q, noReservoir = true)
            var p = 0
            while (p < piece.size) { val k = minOf(1 shl 16, piece.size - p); e.write(if (p == 0 && k == piece.size) piece else piece.copyOfRange(p, p + k), k); p += k }
            e.finish()
            val b = o.toByteArray()
            val f = frames(b)
            // keep == 0: the last piece, everything from its first frame to the end
            val last = if (keep == 0) f.size - 1 else first + keep
            if (f.size - 1 < last) throw IllegalStateException("a piece came out short")
            if (last <= first) ByteArray(0) else b.copyOfRange(f[first], f[last])
        }))
        drain(false)
        // not more pieces waiting than there are threads: the sound is read no faster than it is encoded
        while (pending.size > workers) drain(true)
    }

    private fun drain(wait: Boolean) {
        while (pending.isNotEmpty() && (wait || pending.first().isDone)) {
            val bytes = try { pending.removeFirst().get() } catch (e: java.util.concurrent.ExecutionException) { throw e.cause ?: e }
            out.write(bytes)
            if (wait) return
        }
    }

    override fun finish() {
        // what is left: the part of the sound after the last piece's own part (always at least the two frames that piece looked ahead)
        if (n > pre * bf) submit(acc.copyOfRange(0, n), pre / SPF, 0)
        while (pending.isNotEmpty()) drain(true)
        pool.shutdown()
    }

    override fun close() { pool.shutdownNow() }
}
