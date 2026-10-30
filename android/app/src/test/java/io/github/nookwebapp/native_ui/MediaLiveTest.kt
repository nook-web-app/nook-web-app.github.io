package io.github.nookwebapp.native_ui

import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Assume.assumeTrue
import org.junit.Assert.*
import org.junit.Test

// a real post of X with a video: the card is made and the address of the file answers (needs a connection; run with NOOK_LIVE=1)
class MediaLiveTest {
    @Test fun xVideoResolvesAndAnswers() {
        assumeTrue(System.getenv("NOOK_LIVE") == "1")
        val url = "https://x.com/NASAUniverse/status/1505976485538111504"
        val (info, src) = runBlocking { MediaGrab.resolve(url) }
        println("MEDIA ${info.title} | ${info.kind} | ${info.dur}s | ${src.url.take(90)}")
        assertEquals("video", info.kind)
        val r = OkHttpClient().newCall(Request.Builder().url(src.url).header("Range", "bytes=0-1023").build()).execute()
        r.use { assertTrue("file answered " + it.code, it.code == 200 || it.code == 206); assertTrue(it.body!!.bytes().isNotEmpty()) }
    }

    @Test fun youtubeResolves() {
        assumeTrue(System.getenv("NOOK_LIVE") == "1")
        val r = runCatching { runBlocking { MediaGrab.resolve("https://www.youtube.com/watch?v=jNQXAC9IVRw") } }
        println("YT " + r.fold({ "OK " + it.first.title + " | " + it.first.dur + "s | " + it.second.url.take(80) }, { "FAIL " + it.message }))
        val src = r.getOrThrow().second
        java.io.File("/tmp/yt-url.txt").writeText(src.url)
        val got = OkHttpClient().newCall(Request.Builder().url(src.url).header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36").header("Range", "bytes=0-65535").build()).execute()
        got.use { println("YTD " + it.code + " " + (it.body?.bytes()?.size ?: 0)); assertTrue(it.code == 200 || it.code == 206) }
    }
}
