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

    @Test fun everyDrawingIsThirteenByEightAndHasARun() {
        assertEquals(10, ClaudeFx.MOODS.size)
        ClaudeFx.MOODS.forEach { rows -> assertEquals(8, rows.size); rows.forEach { assertEquals(13, it.length) } }
        ClaudeFx.RUNS.forEach { assertTrue(it.isNotEmpty()) }
    }
}
