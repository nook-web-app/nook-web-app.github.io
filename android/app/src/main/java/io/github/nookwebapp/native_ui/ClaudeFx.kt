package io.github.nookwebapp.native_ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.ime
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.platform.LocalDensity
import kotlin.random.Random

/**
 * "/claude": the little mascots jump in from the bottom and from both sides of the screen, in arcs, for 40 seconds in all
 * (not 40 seconds for each one). The bottom is the top of the keyboard while it is open. A second "/claude" is not accepted
 * until the first one is over. Nothing is sent: it is a command, like "/media".
 */
object ClaudeFx {
    const val TOTAL_MS = 40_000L
    private val ONE = Regex("^/claude$", RegexOption.IGNORE_CASE)
    private val TWICE = Regex("/claude.*/claude", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))

    // the same drawings as the web app: 13 x 8 cells, o body, k eyes, h hearts, s stars, t a tear, b a blush
    val MOODS: List<List<String>> = listOf(
        listOf("..ooooooooo..", "..ooooooooo..", "ooookoookoooo", "ooookoookoooo", "..ooooooooo..", "..ooooooooo..", "..o.o...o.o..", "..o.o...o.o.."),
        listOf("..ooooooooo..", "..ooooooooo..", "ooookoookoooo", "oookokokokooo", "..ooooooooo..", "..ooooooooo..", "..o.o...o.o..", "..o.o...o.o.."),
        listOf("..ooooooooo..", "..ooooooooo..", "ooookoooooooo", "ooookookkkooo", "..ooooooooo..", "..ooooooooo..", "..o.o...o.o..", "..o.o...o.o.."),
        listOf("..ooooooooo..", "..ooooooooo..", "ooohohohohooo", "ooohhhohhhooo", "..oohooohoo..", "..ooooooooo..", "..o.o...o.o..", "..o.o...o.o.."),
        listOf("..ooooooooo..", "..oosooosoo..", "ooosssosssooo", "oooosooosoooo", "..ooooooooo..", "..ooooooooo..", "..o.o...o.o..", "..o.o...o.o.."),
        listOf("..ooooooooo..", "..ooooooooo..", "ooookoookoooo", "ooookoookoooo", "..bbooooobb..", "..ooooooooo..", "..o.o...o.o..", "..o.o...o.o.."),
        listOf("..ooooooooo..", "..ooooooooo..", "ooookoookoooo", "ooookokokoooo", "..ooookoooo..", "..ooooooooo..", "..o.o...o.o..", "..o.o...o.o.."),
        listOf("..ooooooooo..", "..okoooooko..", "ooookoookoooo", "ooookokokoooo", "..oookokooo..", "..ooooooooo..", "..o.o...o.o..", "..o.o...o.o.."),
        listOf("..ooooooooo..", "..ooooooooo..", "ooookoookoooo", "ooookokokoooo", "..ootkokooo..", "..ooooooooo..", "..o.o...o.o..", "..o.o...o.o.."),
        listOf("..ooooooooo..", "..ooooooooo..", "oooookoookooo", "oooookoookooo", "..ooooooooo..", "..ooooooooo..", "..o.o...o.o..", "..o.o...o.o..")
    )
    private val PAL = mapOf('o' to Color(0xFFD97757), 'k' to Color(0xFF1D1B1A), 'h' to Color(0xFFEE5A7A), 's' to Color(0xFFFFD54A), 't' to Color(0xFF7CC4FF), 'b' to Color(0xFFF29A9A))

    // each drawing as horizontal runs of one colour: fewer rectangles to draw in every frame
    class Run(val x: Int, val y: Int, val len: Int, val color: Color)
    val RUNS: List<List<Run>> = MOODS.map { rows ->
        buildList {
            rows.forEachIndexed { y, row ->
                var x = 0
                while (x < row.length) {
                    val ch = row[x]
                    if (ch == '.') { x++; continue }
                    var e = x; while (e + 1 < row.length && row[e + 1] == ch) e++
                    add(Run(x, y, e - x + 1, PAL.getValue(ch))); x = e + 1
                }
            }
        }
    }

    class Flyer(val at: Long, val dur: Long, val mood: Int, val sizeDp: Float, val sx: Float, val ex: Float, val sy: Float, val ey: Float, val apex: Float, val tilt: Float)

    /** 0: not the command, 1: started (the box is emptied), 2: refused (the text stays). */
    fun handle(app: AppState, text: String): Int {
        val t = text.trim()
        if (TWICE.containsMatchIn(t)) { app.say("Write /claude only once"); return 2 }
        if (!ONE.matches(t)) return 0
        if (app.fxAt != 0L && System.currentTimeMillis() - app.fxAt < TOTAL_MS + 1500) { app.say("Claude is already here, wait until he is gone"); return 2 }
        app.fxAt = System.currentTimeMillis()
        return 1
    }

    // who jumps when: one about every 3/4 of a second from the start to second 36, each in the air 3 to 4.5 seconds, so everything is over at 40
    fun plan(seed: Long): List<Flyer> {
        val r = Random(seed)
        val out = ArrayList<Flyer>()
        var t = 0L
        while (t < 35_500L) {
            val side = r.nextInt(5)   // 0 and 1: bottom, 2 and 3: from a side, 4: bottom again, sometimes two at once
            val n = if (r.nextInt(5) == 0) 2 else 1
            repeat(n) {
                val s = if (n == 2) (it + side) % 5 else side
                val dur = 3000L + r.nextInt(1500)
                val size = 44f + r.nextFloat() * 44f
                val mood = r.nextInt(MOODS.size)
                val tilt = (12 + r.nextInt(28)) * (if (r.nextBoolean()) 1f else -1f)
                out.add(when (s) {
                    2 -> Flyer(t, dur, mood, size, -0.12f, 0.35f + r.nextFloat() * 0.8f, 0.45f + r.nextFloat() * 0.5f, 1.2f, 0.2f + r.nextFloat() * 0.35f, tilt)
                    3 -> Flyer(t, dur, mood, size, 1.12f, 0.65f - r.nextFloat() * 0.8f, 0.45f + r.nextFloat() * 0.5f, 1.2f, 0.2f + r.nextFloat() * 0.35f, tilt)
                    else -> {
                        val x0 = 0.05f + r.nextFloat() * 0.9f
                        Flyer(t, dur, mood, size, x0, (x0 + (r.nextFloat() - 0.5f) * 0.9f).coerceIn(-0.1f, 1.1f), 1.12f, 1.12f, 0.35f + r.nextFloat() * 0.5f, tilt)
                    }
                })
            }
            t += 450L + r.nextInt(600)
        }
        return out
    }
}

/** Drawn over the whole window and lets every touch through; the floor is the top of the keyboard when it is up. */
@Composable
fun ClaudeFxLayer(app: AppState) {
    val at = app.fxAt
    if (at == 0L) return
    val flyers = remember(at) { ClaudeFx.plan(at) }
    var now by remember(at) { mutableLongStateOf(0L) }
    LaunchedEffect(at) {
        val t0 = withFrameNanos { it }
        while (true) {
            val ms = (withFrameNanos { it } - t0) / 1_000_000
            now = ms
            if (ms >= ClaudeFx.TOTAL_MS) break
        }
        app.fxAt = 0L
    }
    val density = LocalDensity.current.density
    val ime = WindowInsets.ime.getBottom(LocalDensity.current)
    Canvas(Modifier.fillMaxSize()) {
        val floor = size.height - ime
        val t = now
        for (f in flyers) {
            val e = t - f.at
            if (e < 0 || e > f.dur) continue
            val p = e.toFloat() / f.dur
            val cx = (f.sx + (f.ex - f.sx) * p) * size.width
            val cy = (f.sy + (f.ey - f.sy) * p - 4f * f.apex * p * (1f - p)) * floor
            val px = f.sizeDp * density
            val cell = px / 13f
            val left = cx - px / 2f; val top = cy - cell * 4f
            withTransform({ rotate(f.tilt * (2f * p - 1f), Offset(cx, cy)) }) {
                for (r in ClaudeFx.RUNS[f.mood]) drawRect(r.color, Offset(left + r.x * cell, top + r.y * cell), Size(r.len * cell + 0.6f, cell + 0.6f))
            }
        }
    }
}
