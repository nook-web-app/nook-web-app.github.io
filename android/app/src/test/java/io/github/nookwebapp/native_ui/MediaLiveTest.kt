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
        // the address of a YouTube file is tied to the address of the asker, so only the phone itself can fetch it
        assertTrue(r.isSuccess)
    }
}
