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
    class Got(val title: String, val author: String, val dur: Int, val thumb: String?, val url: String)

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

    // the best file with picture and sound together (mp4); null with the reason when YouTube gives none
    fun get(id: String): Got {
        init()
        val info = StreamInfo.getInfo(ServiceList.YouTube, "https://www.youtube.com/watch?v=$id")
        val best = info.videoStreams.filter { !it.isVideoOnly && it.isUrl && it.format?.mimeType == "video/mp4" }.maxByOrNull { it.height }
            ?: throw MediaGrab.Fail("YouTube gave no file with sound for this video")
        val thumb = info.thumbnails.maxByOrNull { it.height }?.url?.takeIf { it.startsWith("https://") }
        return Got(info.name, info.uploaderName.orEmpty(), info.duration.toInt().coerceAtLeast(0), thumb, best.content)
    }
}
