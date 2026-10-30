package io.github.nookwebapp.native_ui

import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request
import org.schabi.newpipe.extractor.downloader.Response
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException
import org.schabi.newpipe.extractor.stream.StreamInfo
import java.util.concurrent.TimeUnit

// YouTube through the extractor of NewPipe: it reads the page and the player of the site the way the site's own player does,
// so the address of a file comes out right (signature, throttling) without a key of ours
object YtExtract {
    private class Dl : Downloader() {
        private val http = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).build()
        override fun execute(req: Request): Response {
            val body = req.dataToSend()?.toRequestBody()
            val b = okhttp3.Request.Builder().url(req.url()).method(req.httpMethod(), body ?: if (req.httpMethod() == "POST") ByteArray(0).toRequestBody() else null)
            b.header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0")
            req.headers().forEach { (k, vs) -> b.removeHeader(k); vs.forEach { v -> b.addHeader(k, v) } }
            http.newCall(b.build()).execute().use { r ->
                if (r.code == 429) throw ReCaptchaException("YouTube asks for a check", req.url())
                val hs = HashMap<String, List<String>>()
                r.headers.names().forEach { n -> hs[n] = r.headers.values(n) }
                return Response(r.code, r.message, hs, r.body?.string(), r.request.url.toString())
            }
        }
    }

    @Volatile private var ready = false
    private fun init() { if (!ready) synchronized(this) { if (!ready) { NewPipe.init(Dl()); ready = true } } }

    class Part(val url: String, val size: Long, val webm: Boolean)
    // plain: one file with picture and sound together (up to 720p); video and audio: the best picture and sound as two files
    class Got(val title: String, val author: String, val dur: Int, val thumb: String?, val plain: Part, val video: Part?, val audio: Part?)

    private fun sizeOf(item: org.schabi.newpipe.extractor.services.youtube.ItagItem?): Long = item?.contentLength?.takeIf { it > 0 } ?: 0L

    // the tallest picture the size asked for allows (4K only with 30 pictures a second; a 4K video that has only 60 goes down to the
    // next size) and, at that size, the one with the most data; the codec AV1 is left out, the phone's file joiner does not take it everywhere
    fun get(id: String, maxH: Int, maxFps: Int): Got {
        init()
        val info = StreamInfo.getInfo(ServiceList.YouTube, "https://www.youtube.com/watch?v=$id")
        val whole = info.videoStreams.filter { !it.isVideoOnly && it.isUrl && it.format?.mimeType == "video/mp4" }.maxByOrNull { it.height }
            ?: throw MediaGrab.Fail("YouTube gave no file with sound for this video")
        val plain = Part(whole.content, sizeOf(whole.itagItem), false)
        val dash = info.videoOnlyStreams.filter { s ->
            s.isUrl && s.isVideoOnly && s.height in 1..maxH && s.codec?.startsWith("av01", true) != true &&
                (s.format?.mimeType == "video/mp4" || s.format?.mimeType == "video/webm") && (s.height <= 1080 || s.fps <= maxFps) && (maxFps >= 60 || s.fps <= maxFps)
        }.maxWithOrNull(compareBy({ it.height }, { it.fps }, { it.bitrate }))
        var video: Part? = null; var audio: Part? = null
        if (dash != null && dash.height >= whole.height) {
            val webm = dash.format?.mimeType == "video/webm"
            // sound of the same kind of file: m4a goes with mp4, opus with webm
            val a = info.audioStreams.filter { it.isUrl && it.format?.mimeType == (if (webm) "audio/webm" else "audio/mp4") }.maxByOrNull { it.averageBitrate }
            if (a != null) { video = Part(dash.content, sizeOf(dash.itagItem), webm); audio = Part(a.content, sizeOf(a.itagItem), webm) }
        }
        val thumb = info.thumbnails.maxByOrNull { it.height }?.url?.takeIf { it.startsWith("https://") }
        return Got(info.name, info.uploaderName.orEmpty(), info.duration.toInt().coerceAtLeast(0), thumb, plain, video, audio)
    }
}
