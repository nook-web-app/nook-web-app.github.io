package io.github.nookwebapp.native_ui

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

// the parts of "/media" that need no connection: the command, the link kinds, the token of the X embed, how the answers of X and
// Instagram are read, and the check of a card that came from outside
class MediaGrabTest {
    @Test fun command() {
        assertEquals("https://x.com/a/status/1", MediaGrab.command("/media https://x.com/a/status/1"))
        assertEquals("", MediaGrab.command("/media"))
        assertEquals("https://youtu.be/abcdefghijk", MediaGrab.command("  /MEDIA   https://youtu.be/abcdefghijk  "))
        assertNull(MediaGrab.command("hello /media https://x.com"))
        assertNull(MediaGrab.command("/media a b"))
    }

    @Test fun qualities() {
        assertEquals("2k", MediaGrab.quality("/media /2k https://youtu.be/abcdefghijk"))
        assertEquals("https://youtu.be/abcdefghijk", MediaGrab.command("/media /2K https://youtu.be/abcdefghijk"))
        assertEquals("4k", MediaGrab.quality("/media /4k https://x.com/a/status/1"))
        assertEquals("", MediaGrab.quality("/media https://x.com/a/status/1"))
        assertEquals("720p", MediaGrab.quality("/media /720p https://x.com/a/status/1"))
        assertNull(MediaGrab.command("/media /8k https://x.com/a/status/1"))
        assertEquals(2160, MediaGrab.maxHeight("4k")); assertEquals(1440, MediaGrab.maxHeight("2k")); assertEquals(1080, MediaGrab.maxHeight("")); assertEquals(720, MediaGrab.maxHeight("720p"))
        assertEquals("youtube.com", MediaGrab.domain("youtube")); assertEquals("x.com", MediaGrab.domain("x")); assertEquals("instagram.com", MediaGrab.domain("instagram"))
    }

    @Test fun xSizes() {
        val j = JSONObject("""{"mediaDetails":[{"type":"video","video_info":{"variants":[
            {"content_type":"application/x-mpegURL","url":"https://video.twimg.com/a.m3u8"},
            {"bitrate":256000,"content_type":"video/mp4","url":"https://video.twimg.com/v/vid/480x270/a.mp4"},
            {"bitrate":832000,"content_type":"video/mp4","url":"https://video.twimg.com/v/vid/640x360/a.mp4"},
            {"bitrate":2176000,"content_type":"video/mp4","url":"https://video.twimg.com/v/vid/1280x720/a.mp4"},
            {"bitrate":10368000,"content_type":"video/mp4","url":"https://video.twimg.com/v/vid/1920x1080/a.mp4"}]}}]}""")
        val f = MediaGrab.xFiles(j)
        assertEquals(4, f.size)
        assertEquals("https://video.twimg.com/v/vid/1920x1080/a.mp4", MediaGrab.xPick(f, 1080))
        assertEquals("https://video.twimg.com/v/vid/1280x720/a.mp4", MediaGrab.xPick(f, 720))
        assertEquals("https://video.twimg.com/v/vid/1920x1080/a.mp4", MediaGrab.xPick(f, 2160))
        assertEquals("https://video.twimg.com/v/vid/480x270/a.mp4", MediaGrab.xPick(f, 100))
    }

    @Test fun sites() {
        assertEquals("x", MediaGrab.site("https://x.com/jack/status/20"))
        assertEquals("x", MediaGrab.site("https://twitter.com/jack/status/20?s=20"))
        assertEquals("youtube", MediaGrab.site("https://www.youtube.com/watch?v=jNQXAC9IVRw"))
        assertEquals("youtube", MediaGrab.site("https://youtu.be/jNQXAC9IVRw"))
        assertEquals("youtube", MediaGrab.site("https://www.youtube.com/shorts/jNQXAC9IVRw"))
        assertEquals("instagram", MediaGrab.site("https://www.instagram.com/reel/Cabc123_-x/"))
        assertEquals("instagram", MediaGrab.site("https://www.instagram.com/p/Cabc123/?igsh=1"))
        assertNull(MediaGrab.site("https://example.com/video"))
        assertNull(MediaGrab.site("https://x.com/jack"))
    }

    @Test fun xToken() {
        // the same digits as (id / 1e15 * Math.PI).toString(36) without zeros and dot in a browser
        assertEquals("6dq1a2xwd93", MediaGrab.xToken("20"))
        assertEquals("3tvpsgldru", MediaGrab.xToken("1580000000000000000"))
        assertEquals("4hgc178kz8u", MediaGrab.xToken("1850123456789012345"))
        assertEquals("4uj6o5owj98", MediaGrab.xToken("1999999999999999999"))
    }

    @Test fun xVideo() {
        val j = JSONObject("""{"user":{"name":"Jack","screen_name":"jack"},"mediaDetails":[{"type":"video","media_url_https":"https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/a.jpg","video_info":{"duration_millis":12500,"variants":[
            {"content_type":"application/x-mpegURL","url":"https://video.twimg.com/a.m3u8"},
            {"bitrate":832000,"content_type":"video/mp4","url":"https://video.twimg.com/low.mp4"},
            {"bitrate":2176000,"content_type":"video/mp4","url":"https://video.twimg.com/high.mp4"}]}}]}""")
        val (info, src) = MediaGrab.xParse(j)
        assertEquals("https://video.twimg.com/high.mp4", src.url)
        assertEquals("video", info.kind); assertEquals(12, info.dur); assertEquals("Jack (@jack)", info.title)
        assertEquals("x", info.site); assertNotNull(info.thumb)
    }

    @Test fun xGif() {
        val j = JSONObject("""{"user":{"name":"A","screen_name":"a"},"mediaDetails":[{"type":"animated_gif","media_url_https":"https://pbs.twimg.com/tweet_video_thumb/a.jpg","video_info":{"variants":[{"bitrate":0,"content_type":"video/mp4","url":"https://video.twimg.com/tweet_video/a.mp4"}]}}]}""")
        assertEquals("gif", MediaGrab.xParse(j).first.kind)
    }

    @Test fun xPhotosOnlyIsRefused() {
        val j = JSONObject("""{"user":{"name":"A","screen_name":"a"},"mediaDetails":[{"type":"photo","media_url_https":"https://pbs.twimg.com/media/a.jpg"}],"photos":[{"url":"https://pbs.twimg.com/media/a.jpg"}]}""")
        try { MediaGrab.xParse(j); fail("a post with only pictures must be refused") } catch (e: MediaGrab.Fail) { assertTrue(e.message!!.contains("no video")) }
        try { MediaGrab.xParse(JSONObject("""{"user":{"screen_name":"a"},"text":"words only"}""")); fail() } catch (e: MediaGrab.Fail) { }
    }

    @Test fun xFromTheOpenService() {
        val j = JSONObject("""{"code":200,"tweet":{"author":{"name":"Nasa","screen_name":"nasa"},"media":{"videos":[
            {"type":"video","width":1280,"height":720,"url":"https://video.twimg.com/a/720.mp4","thumbnail_url":"https://pbs.twimg.com/a.jpg","duration":12.5},
            {"type":"video","width":1920,"height":1080,"url":"https://video.twimg.com/a/1080.mp4","thumbnail_url":"https://pbs.twimg.com/a.jpg","duration":12.5}]}}}""")
        val (info, src) = MediaGrab.xFromFx(j)
        assertEquals("https://video.twimg.com/a/1080.mp4", src.url); assertEquals(12, info.dur); assertEquals("Nasa (@nasa)", info.title)
        try { MediaGrab.xFromFx(JSONObject("""{"tweet":{"author":{"screen_name":"a"},"media":{"photos":[{"url":"https://pbs.twimg.com/a.jpg"}]}}}""")); fail("a post with only pictures must be refused") } catch (e: MediaGrab.Fail) { assertTrue(e.message!!.contains("no video")) }
        try { MediaGrab.xFromFx(JSONObject("""{"code":404}""")); fail() } catch (e: MediaGrab.Fail) { }
    }

    @Test fun instagramPage() {
        val html = """<html><head><meta property="og:title" content="Instagram (@some.one)" /><meta property="og:video" content="https://scontent.cdninstagram.com/v/t50/a.mp4?x=1&amp;y=2" /><meta property="og:image" content="https://scontent.cdninstagram.com/v/a.jpg" /></head></html>"""
        val (info, src) = MediaGrab.igFromHtml(html)
        assertEquals("https://scontent.cdninstagram.com/v/t50/a.mp4?x=1&y=2", src.url)
        assertEquals("@some.one", info.author); assertEquals("video", info.kind)
        val pic = MediaGrab.igFromHtml("""<meta content="https://scontent.cdninstagram.com/v/a.jpg" property="og:image"/>""")
        assertEquals("image", pic.first.kind); assertEquals("jpg", pic.second.ext)
        try { MediaGrab.igFromHtml("<html>login</html>"); fail() } catch (e: MediaGrab.Fail) { }
    }

    @Test fun sizes() {
        assertEquals("", MediaGrab.sizeText(0))
        assertEquals("850 KB", MediaGrab.sizeText(850_000))
        assertEquals("1.5 MB", MediaGrab.sizeText(1_500_000))
        assertEquals("700 MB", MediaGrab.sizeText(700_000_000))
        assertEquals("1.2 GB", MediaGrab.sizeText(1_230_000_000))
    }

    @Test fun cleanCard() {
        val ok = JSONObject().put("u", "https://youtu.be/jNQXAC9IVRw").put("s", "youtube").put("t", "Me at the zoo").put("a", "jawed").put("k", "video").put("d", 19).put("z", 12345678L).put("i", "https://i.ytimg.com/vi/x/hq.jpg")
        assertNotNull(MediaGrab.cleanCard(ok))
        assertNull(MediaGrab.cleanCard(JSONObject(ok.toString()).put("u", "http://youtu.be/jNQXAC9IVRw")))
        assertNull(MediaGrab.cleanCard(JSONObject(ok.toString()).put("s", "x")))
        assertNull(MediaGrab.cleanCard(JSONObject(ok.toString()).put("u", "https://evil.example/watch?v=jNQXAC9IVRw")))
        assertNull(MediaGrab.cleanCard(null))
        assertEquals("", MediaGrab.cleanCard(JSONObject(ok.toString()).put("i", "javascript:alert(1)"))!!.optString("i"))
        // the first frame of a video travels inside the card
        assertTrue(MediaGrab.cleanCard(JSONObject(ok.toString()).put("i", "data:image/jpeg;base64,/9j/4AAQ").put("q", "2k"))!!.optString("i").startsWith("data:image/jpeg"))
        assertEquals("2k", MediaGrab.cleanCard(JSONObject(ok.toString()).put("q", "2k"))!!.optString("q"))
        assertEquals("", MediaGrab.cleanCard(JSONObject(ok.toString()).put("q", "8k"))!!.optString("q"))
    }
}
