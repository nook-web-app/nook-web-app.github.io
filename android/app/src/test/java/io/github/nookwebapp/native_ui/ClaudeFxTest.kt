package io.github.nookwebapp.native_ui

import org.junit.Assert.*
import org.junit.Test

class ClaudeFxTest {
    @Test fun everythingIsOverWithinFortySeconds() {
        for (seed in 1L..200L) {
            val p = ClaudeFx.plan(seed)
            assertTrue(p.size > 30)
            assertTrue("seed $seed ends at " + p.maxOf { it.at + it.dur }, p.maxOf { it.at + it.dur } <= ClaudeFx.TOTAL_MS)
            // it keeps going the whole time: something jumps in the last seconds too
            assertTrue(p.maxOf { it.at } > 30_000)
        }
    }

    @Test fun everyDrawingHasItsSizeAndFrames() {
        assertEquals(15, ClaudeFx.SPRITES.size)
        ClaudeFx.SPRITES.forEach { s ->
            assertEquals(s.def.frames.size, s.def.ms.size)
            s.def.frames.forEach { rows -> assertEquals(s.def.rows, rows.size); rows.forEach { assertEquals(s.def.cols, it.length) } }
            s.frames.forEach { assertTrue(it.isNotEmpty()) }
        }
        // some of them move
        assertTrue(ClaudeFx.SPRITES.count { it.frames.size > 1 } >= 5)
    }

    @Test fun itStartsWithABurst() {
        val p = ClaudeFx.plan(7)
        assertTrue(p.count { it.at < 400 } >= 4)
        // not too many: about one every 3/4 of a second
        assertTrue(p.size in 50..100)
        // spread out: from the left, the right and all over the bottom
        assertTrue(p.count { it.sx < 0f } >= 8 && p.count { it.sx > 1f } >= 8)
        assertTrue(p.filter { it.sx in 0f..1f }.map { (it.sx * 3).toInt() }.toSet().size == 3)
    }
}
