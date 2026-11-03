package io.github.nookwebapp.native_ui

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import java.io.File

// The sound of a video file (any sound the phone can play) made into an mp3 file with a title, an artist and a cover picture
object AudioMp3 {
    // from: the downloaded file (the video, or the sound alone); to: the mp3; progress goes from 0 to 1
    fun make(from: File, to: File, title: String, artist: String, cover: ByteArray?, onProgress: (Float) -> Unit) {
        val ex = MediaExtractor()
        var codec: MediaCodec? = null
        try {
            ex.setDataSource(from.absolutePath)
            val ti = (0 until ex.trackCount).firstOrNull { ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME).orEmpty().startsWith("audio/") } ?: throw MediaGrab.Fail("That video has no sound")
            ex.selectTrack(ti)
            val fmt = ex.getTrackFormat(ti)
            val durUs = if (fmt.containsKey(MediaFormat.KEY_DURATION)) fmt.getLong(MediaFormat.KEY_DURATION).coerceAtLeast(0L) else 0L
            codec = MediaCodec.createDecoderByType(fmt.getString(MediaFormat.KEY_MIME)!!)
            codec.configure(fmt, null, null, 0)
            codec.start()
            to.outputStream().buffered(1 shl 16).use { out ->
                out.write(Mp3.tag(title, artist, cover))
                var enc: Mp3? = null
                var channels = 2
                val info = MediaCodec.BufferInfo()
                var inputDone = false; var outputDone = false
                var pcm = ByteArray(1 shl 16)
                var idle = 0
                while (!outputDone) {
                    if (!inputDone) {
                        val i = codec.dequeueInputBuffer(10_000)
                        if (i >= 0) {
                            val buf = codec.getInputBuffer(i)!!
                            val n = ex.readSampleData(buf, 0)
                            if (n < 0) { codec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true }
                            else { codec.queueInputBuffer(i, 0, n, ex.sampleTime, 0); if (durUs > 0) onProgress((ex.sampleTime.toFloat() / durUs).coerceIn(0f, 1f)); ex.advance() }
                        }
                    }
                    val o = codec.dequeueOutputBuffer(info, 10_000)
                    when {
                        o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                            idle = 0
                            // a second format would mix two sample rates in one file: the caller falls back to the plain sound
                            if (enc != null) throw MediaGrab.Fail("The sound changed its format")
                            val of = codec.outputFormat
                            val rate = of.getInteger(MediaFormat.KEY_SAMPLE_RATE); channels = of.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                            enc = Mp3(out, rate, if (channels == 1) 1 else 2)
                        }
                        o >= 0 -> {
                            idle = 0
                            val buf = codec.getOutputBuffer(o)!!
                            if (info.size > 0) {
                                if (enc == null) {
                                    val of = codec.outputFormat
                                    channels = of.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                                    enc = Mp3(out, of.getInteger(MediaFormat.KEY_SAMPLE_RATE), if (channels == 1) 1 else 2)
                                }
                                if (pcm.size < info.size) pcm = ByteArray(info.size)
                                buf.position(info.offset); buf.limit(info.offset + info.size); buf.get(pcm, 0, info.size)
                                if (channels > 2) {
                                    // more than two channels: the first two are used
                                    val frames = info.size / (2 * channels); val two = ByteArray(frames * 4)
                                    for (f in 0 until frames) { System.arraycopy(pcm, f * 2 * channels, two, f * 4, 4) }
                                    enc.write(two, two.size)
                                } else enc.write(pcm, info.size)
                            }
                            codec.releaseOutputBuffer(o, false)
                            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
                        }
                        o == MediaCodec.INFO_TRY_AGAIN_LATER -> { if (++idle > 300) throw MediaGrab.Fail("The sound could not be read") }
                    }
                }
                enc?.finish() ?: throw MediaGrab.Fail("The sound could not be read")
            }
        } finally {
            runCatching { codec?.stop() }; runCatching { codec?.release() }; runCatching { ex.release() }
        }
    }

    // the cover: the picture of the card (a data address or a link) as a jpeg of at most 600 pixels, null when there is none
    fun cover(thumb: String?, fetch: (String) -> ByteArray?): ByteArray? {
        thumb ?: return null
        val raw = if (thumb.startsWith("data:image")) runCatching { android.util.Base64.decode(thumb.substringAfter("base64,"), android.util.Base64.DEFAULT) }.getOrNull()
        else if (thumb.startsWith("https://")) runCatching { fetch(thumb) }.getOrNull() else null
        raw ?: return null
        return runCatching {
            val bm = android.graphics.BitmapFactory.decodeByteArray(raw, 0, raw.size) ?: return null
            val side = maxOf(bm.width, bm.height)
            val sc = if (side > 600) android.graphics.Bitmap.createScaledBitmap(bm, bm.width * 600 / side, bm.height * 600 / side, true) else bm
            val o = java.io.ByteArrayOutputStream(); sc.compress(android.graphics.Bitmap.CompressFormat.JPEG, 88, o); o.toByteArray()
        }.getOrNull()
    }
}
