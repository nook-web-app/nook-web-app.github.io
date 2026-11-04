package io.github.nookwebapp.native_ui

import de.sciss.jump3r.mp3.*
import de.sciss.jump3r.mpg.Common
import de.sciss.jump3r.mpg.Interface
import de.sciss.jump3r.mpg.MPGLib
import java.io.ByteArrayOutputStream
import java.io.OutputStream

/** Where the sound goes: 16 bit samples, interleaved when stereo. */
interface PcmSink { fun write(pcm: ByteArray, len: Int); fun finish(); fun close() {} }

// Raw sound (16 bit, little endian, interleaved) written as an MP3 file with a tag: title, artist and a cover picture. The encoder is the
// plain Java port of LAME (nothing from the phone's own codecs), so the file is the same on every phone.
class Mp3(private val out: OutputStream, private val rate: Int, private val channels: Int, kbps: Int = 192, Q: Int = 7, noReservoir: Boolean = false) : PcmSink {
    private val lame = Lame()
    private val gf: LameGlobalFlags
    private val id3 = ID3Tag()
    private val buf = ByteArray(1 shl 16)
    private var wrote = 0L

    init {
        // the parts of the encoder are joined the way the library's own tools do it
        val ga = GainAnalysis(); val bs = BitStream(); val pr = Presets(); val qp = QuantizePVT(); val qu = Quantize(); val vbr = VBRTag()
        val ver = Version(); val rv = Reservoir(); val tak = Takehiro(); val parse = Parse(); val mpg = MPGLib(); val intf = Interface(); val common = Common()
        val gaud = GetAudio()
        lame.setModules(ga, bs, pr, qp, qu, vbr, ver, id3, mpg)
        bs.setModules(ga, mpg, ver, vbr)
        id3.setModules(bs, ver)
        pr.setModules(lame)
        qu.setModules(bs, rv, qp, tak)
        qp.setModules(tak, rv, lame.enc.psy)
        rv.setModules(bs)
        tak.setModules(qp)
        vbr.setModules(lame, bs, ver)
        gaud.setModules(parse, mpg)
        parse.setModules(ver, id3, pr)
        mpg.setModules(intf, common)
        intf.setModules(vbr, common)
        gf = lame.lame_init()
        id3.id3tag_init(gf)
        gf.in_samplerate = rate
        gf.num_channels = channels
        gf.brate = kbps
        gf.quality = Q
        // every frame carries all its own data (needed when pieces encoded apart are joined, see Mp3Par)
        gf.disable_reservoir = noReservoir
        gf.mode = if (channels == 1) MPEGMode.MONO else MPEGMode.JOINT_STEREO
        gf.write_id3tag_automatic = false
        gf.findReplayGain = false
        gf.bWriteVbrTag = false
        lame.lame_init_params(gf)
    }

    // pcm: 16 bit samples, interleaved when stereo
    override fun write(pcm: ByteArray, len: Int) {
        val frames = len / (2 * channels)
        if (frames == 0) return
        val l = IntArray(frames); val r = IntArray(frames)
        for (i in 0 until frames) {
            val o = i * 2 * channels
            val a = (pcm[o].toInt() and 255) or (pcm[o + 1].toInt() shl 8)
            l[i] = a
            r[i] = if (channels > 1) (pcm[o + 2].toInt() and 255) or (pcm[o + 3].toInt() shl 8) else a
        }
        var done = 0
        while (done < frames) {
            val n = minOf(frames - done, 8192)
            val a = if (done == 0 && n == frames) l else l.copyOfRange(done, done + n)
            val b = if (done == 0 && n == frames) r else r.copyOfRange(done, done + n)
            // the encoder takes 32 bit samples: the 16 bit ones are moved up
            for (i in a.indices) { a[i] = a[i] shl 16; b[i] = b[i] shl 16 }
            val got = lame.lame_encode_buffer_int(gf, a, b, n, buf, 0, buf.size)
            if (got < 0) throw MediaGrab.Fail("The sound could not be turned into an mp3 (" + got + ")")
            if (got > 0) { out.write(buf, 0, got); wrote += got }
            done += n
        }
    }

    override fun finish() {
        val got = lame.lame_encode_flush(gf, buf, 0, buf.size)
        if (got > 0) out.write(buf, 0, got)
    }

    companion object {
        // the tag at the start of the file (ID3v2.3, text in UTF-16 so every language is right): title, artist and the cover picture (a jpeg)
        fun tag(title: String, artist: String, cover: ByteArray?): ByteArray {
            fun text(id: String, v: String): ByteArray {
                val body = byteArrayOf(1, 0xFF.toByte(), 0xFE.toByte()) + v.toByteArray(Charsets.UTF_16LE) + byteArrayOf(0, 0)
                return frame(id, body)
            }
            val b = ByteArrayOutputStream()
            if (title.isNotEmpty()) b.write(text("TIT2", title))
            if (artist.isNotEmpty()) { b.write(text("TPE1", artist)); b.write(text("TPE2", artist)) }
            b.write(text("TALB", "Nook"))
            if (cover != null && cover.size > 100) {
                val head = byteArrayOf(0) + "image/jpeg".toByteArray(Charsets.ISO_8859_1) + byteArrayOf(0, 3, 0)
                b.write(frame("APIC", head + cover))
            }
            val body = b.toByteArray()
            val n = body.size
            val size = byteArrayOf(((n shr 21) and 127).toByte(), ((n shr 14) and 127).toByte(), ((n shr 7) and 127).toByte(), (n and 127).toByte())
            return byteArrayOf('I'.code.toByte(), 'D'.code.toByte(), '3'.code.toByte(), 3, 0, 0) + size + body
        }
        private fun frame(id: String, body: ByteArray): ByteArray {
            val n = body.size
            val h = id.toByteArray(Charsets.ISO_8859_1) + byteArrayOf((n shr 24).toByte(), (n shr 16).toByte(), (n shr 8).toByte(), n.toByte(), 0, 0)
            return h + body
        }
    }
}
