package io.github.nookwebapp.native_ui

import org.jcodec.api.FrameGrab
import org.jcodec.common.io.NIOUtils
import org.jcodec.common.model.ColorSpace
import org.jcodec.common.model.Picture
import org.jcodec.scale.ColorUtil
import java.io.File

// The pictures of a short H.264 clip (what X calls a gif), read in plain Java: frames are small ARGB arrays at most maxW wide,
// with the number of pictures a second the clip really has. No phone decoder is used, so it works the same everywhere.
object ClipFrames {
    class Out(val frames: List<IntArray>, val w: Int, val h: Int, val fps: Int)

    fun read(file: File, maxW: Int = 4096, maxFrames: Int = 600): Out {
        val ch = NIOUtils.readableChannel(file)
        try {
            val grab = FrameGrab.createFrameGrab(ch)
            val frames = ArrayList<IntArray>()
            var w = 0; var h = 0
            // the original size and every picture; only a clip too big for the memory of the phone (about 30 million pixels in all) is made smaller
            val total = grab.videoTrack.meta.totalFrames.coerceAtLeast(1)
            val budget = 30_000_000.0
            while (frames.size < maxFrames) {
                val pic = grab.nativeFrame ?: break
                val rgb = Picture.create(pic.width, pic.height, ColorSpace.RGB)
                ColorUtil.getTransform(pic.color, ColorSpace.RGB).transform(pic, rgb)
                val sw = pic.width; val sh = pic.height
                val fit = if (w == 0) minOf(1.0, Math.sqrt(budget / (total.toDouble() * pic.croppedWidth * pic.croppedHeight))) else 1.0
                val dw = if (w == 0) minOf(maxW, (pic.croppedWidth * fit).toInt().coerceAtLeast(16)) else w; val dh = (pic.croppedHeight * (dw.toFloat() / pic.croppedWidth)).toInt().coerceAtLeast(1)
                if (w == 0) { w = dw; h = dh }
                val d = rgb.getPlaneData(0)
                // the picture may have a cropped edge: only its visible part is used
                val cw = pic.croppedWidth; val ch2 = pic.croppedHeight
                val px = IntArray(w * h)
                for (y in 0 until h) {
                    val sy = minOf(ch2 - 1, (y * ch2.toFloat() / h).toInt())
                    for (x in 0 until w) {
                        val sx = minOf(cw - 1, (x * cw.toFloat() / w).toInt())
                        val o = (sy * sw + sx) * 3
                        px[y * w + x] = (0xFF shl 24) or (((d[o].toInt() + 128) and 255) shl 16) or (((d[o + 1].toInt() + 128) and 255) shl 8) or ((d[o + 2].toInt() + 128) and 255)
                    }
                }
                frames.add(px)
            }
            if (frames.size < 2) throw MediaGrab.Fail("the clip has " + frames.size + " picture")
            val tr = grab.videoTrack.meta
            val fps = if (tr.totalDuration > 0) Math.round(tr.totalFrames / tr.totalDuration).toInt().coerceIn(5, 30) else 12
            return Out(frames, w, h, fps)
        } finally { runCatching { ch.close() } }
    }
}
