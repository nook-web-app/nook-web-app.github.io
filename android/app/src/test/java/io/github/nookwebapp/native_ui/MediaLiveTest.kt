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

    // the same file, once in one piece and once in pieces over several connections, must be byte for byte the same
    @Test fun piecesEqualWhole() {
        assumeTrue(System.getenv("NOOK_LIVE") == "1")
        val url = "https://video.twimg.com/amplify_video/1505976308765016071/vid/1280x720/erlhaEHsNZsmXF4T.mp4"
        val size = MediaGrab.sizeOf(url)
        println("PIECES size=$size")
        assertTrue(size > 0)
        val a = java.io.File.createTempFile("whole", ".mp4"); val b = java.io.File.createTempFile("pieces", ".mp4")
        val t0 = System.currentTimeMillis()
        MediaGrab.download(url, emptyMap(), a) { }
        val t1 = System.currentTimeMillis()
        var got = 0L
        MediaGrab.fastDownload(url, emptyMap(), b, size) { got += it }
        val t2 = System.currentTimeMillis()
        println("PIECES whole=${t1 - t0}ms pieces=${t2 - t1}ms bytes=$got")
        assertEquals(a.length(), b.length()); assertEquals(size, b.length())
        assertArrayEquals(java.security.MessageDigest.getInstance("SHA-256").digest(a.readBytes()), java.security.MessageDigest.getInstance("SHA-256").digest(b.readBytes()))
        a.delete(); b.delete()
    }
}
