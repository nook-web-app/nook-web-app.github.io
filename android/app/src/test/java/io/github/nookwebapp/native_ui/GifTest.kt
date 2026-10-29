package io.github.nookwebapp.native_ui

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

// The GIF encoder makes a GIF89a file of the right size, and (written to build/gif-out.bin) the same bytes
// as the web app's gifEncode() for the same frames (android/tools/gifcheck.js compares them).
class GifTest {
    private fun frames(): List<IntArray> = (0 until 3).map { f -> IntArray(40 * 30) { p -> val x = p % 40; val y = p / 40; (0xFF shl 24) or (((x * 6 + f * 40) and 255) shl 16) or (((y * 8) and 255) shl 8) or ((x * y + f * 17) and 255) } }

    @Test fun readsBack() {
        val b = Gif.encode(frames(), 40, 30, 12)
        File("build").mkdirs(); File("build/gif-out.bin").writeBytes(b)
        assertEquals("GIF89a", String(b, 0, 6))
        assertEquals(40, (b[6].toInt() and 255) or ((b[7].toInt() and 255) shl 8))
        assertEquals(59, b.last().toInt())
    }
}
