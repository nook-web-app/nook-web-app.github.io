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
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.platform.LocalDensity
import kotlin.random.Random

/**
 * "/claude": the little mascots jump in from the bottom and from both sides of the screen, fast and in every direction, in arcs, for
 * 40 seconds in all (not 40 seconds for each one). Some of them move (hop, wave of hearts, sparkles, typing). The bottom is the top
 * of the keyboard while it is open. One "/claude" every 30 seconds; in a chat with a person the message is sent too, and their phone
 * plays it when it arrives.
 */
object ClaudeFx {
    const val TOTAL_MS = 40_000L
    const val EVERY_MS = 30_000L
    private val ONE = Regex("^/claude$", RegexOption.IGNORE_CASE)
    private val TWICE = Regex("/claude.*/claude", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))

    // cols x rows of cells, (ax, ay) the middle of the body, the frames (o body, k eyes, h hearts, s stars, g and c and d the laptop,
    // t a tear, b a blush) and how long each frame stays; the same drawings as the web app
    class Def(val cols: Int, val rows: Int, val ax: Float, val ay: Float, val frames: List<List<String>>, val ms: IntArray)
    private val STATIC = listOf(
        Def(13, 8, 6.5f, 4f, listOf(listOf("..ooooooooo..", "..ooooooooo..", "ooookoookoooo", "ooookoookoooo", "..ooooooooo..", "..ooooooooo..", "..o.o...o.o..", "..o.o...o.o..")), intArrayOf(1000)),
        Def(13, 8, 6.5f, 4f, listOf(listOf("..ooooooooo..", "..ooooooooo..", "ooookoookoooo", "oookokokokooo", "..ooooooooo..", "..ooooooooo..", "..o.o...o.o..", "..o.o...o.o..")), intArrayOf(1000)),
        Def(13, 8, 6.5f, 4f, listOf(listOf("..ooooooooo..", "..ooooooooo..", "ooookoooooooo", "ooookookkkooo", "..ooooooooo..", "..ooooooooo..", "..o.o...o.o..", "..o.o...o.o..")), intArrayOf(1000)),
        Def(13, 8, 6.5f, 4f, listOf(listOf("..ooooooooo..", "..ooooooooo..", "ooohohohohooo", "ooohhhohhhooo", "..oohooohoo..", "..ooooooooo..", "..o.o...o.o..", "..o.o...o.o..")), intArrayOf(1000)),
        Def(13, 8, 6.5f, 4f, listOf(listOf("..ooooooooo..", "..oosooosoo..", "ooosssosssooo", "oooosooosoooo", "..ooooooooo..", "..ooooooooo..", "..o.o...o.o..", "..o.o...o.o..")), intArrayOf(1000)),
        Def(13, 8, 6.5f, 4f, listOf(listOf("..ooooooooo..", "..ooooooooo..", "ooookoookoooo", "ooookoookoooo", "..bbooooobb..", "..ooooooooo..", "..o.o...o.o..", "..o.o...o.o..")), intArrayOf(1000)),
        Def(13, 8, 6.5f, 4f, listOf(listOf("..ooooooooo..", "..ooooooooo..", "ooookoookoooo", "ooookokokoooo", "..ooookoooo..", "..ooooooooo..", "..o.o...o.o..", "..o.o...o.o..")), intArrayOf(1000)),
        Def(13, 8, 6.5f, 4f, listOf(listOf("..ooooooooo..", "..okoooooko..", "ooookoookoooo", "ooookokokoooo", "..oookokooo..", "..ooooooooo..", "..o.o...o.o..", "..o.o...o.o..")), intArrayOf(1000)),
        Def(13, 8, 6.5f, 4f, listOf(listOf("..ooooooooo..", "..ooooooooo..", "ooookoookoooo", "ooookokokoooo", "..ootkokooo..", "..ooooooooo..", "..o.o...o.o..", "..o.o...o.o..")), intArrayOf(1000)),
        Def(13, 8, 6.5f, 4f, listOf(listOf("..ooooooooo..", "..ooooooooo..", "oooookoookooo", "oooookoookooo", "..ooooooooo..", "..ooooooooo..", "..o.o...o.o..", "..o.o...o.o..")), intArrayOf(1000))
    )
    private val MOVING = listOf(
        Def(22, 18, 9.5f, 11f, listOf(listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", ".....ooooooooo........", ".....ooooooooo........", "...ooookoookoooo......", "...ooookoookoooo......", ".....ooooooooo........", ".....ooooooooo........", ".....o.o...o.o........", ".....o.o...o.o........", "......................", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", ".....ooooooooo........", ".....ooooooooo........", "...ooookoookoooo......", "...ooookoookoooo......", ".....ooooooooo........", ".....ooooooooo........", ".....o.o...o.o........", ".....o.o...o.o........", "......................", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", "......................", ".....ooooooooo........", ".....ooooooooo........", "...ooookoookoooo......", "...ooookoookoooo......", ".....ooooooooo........", ".....ooooooooo........", ".....o.o...o.o........", ".....o.o...o.o........", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", "......................", ".....ooooooooo........", ".....ooooooooo........", "...ooookoookoooo......", "...ooookoookoooo......", ".....ooooooooo........", ".....ooooooooo........", ".....o.o...o.o........", ".....o.o...o.o........", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", ".....ooooooooo........", ".....ooooooooo........", "...oookoookooooo......", "...oookoookooooo......", ".....ooooooooo........", ".....ooooooooo........", ".....o.o...o.o........", ".....o.o...o.o........", "......................", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", ".....ooooooooo........", ".....ooooooooo........", "...oookoookooooo......", "...oookoookooooo......", ".....ooooooooo........", ".....ooooooooo........", ".....o.o...o.o........", ".....o.o...o.o........", "......................", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", ".....ooooooooo........", ".....ooooooooo........", "...ooookoookoooo......", "...ooookoookoooo......", ".....ooooooooo........", ".....ooooooooo........", ".....o.o...o.o........", ".....o.o...o.o........", "......................", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", "......................", ".....ooooooooo........", ".....ooooooooo........", "...ooooooooooooo......", "...oookkoookkooo......", ".....ooooooooo........", ".....ooooooooo........", ".....o.o...o.o........", ".....o.o...o.o........", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", ".....ooooooooo........", ".....ooooooooo........", "...ooookoookoooo......", "...ooookoookoooo......", ".....ooooooooo........", ".....ooooooooo........", ".....o.o...o.o........", ".....o.o...o.o........", "......................", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", ".....ooooooooo........", ".....ooooooooo........", "...ooookoookoooo......", "...ooookoookoooo......", ".....ooooooooo........", ".....ooooooooo........", ".....o.o...o.o........", ".....o.o...o.o........", "......................", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", "......................", ".....ooooooooo........", ".....ooooooooo........", "...oooookoookooo......", "...oooookoookooo......", ".....ooooooooo........", ".....ooooooooo........", ".....o.o...o.o........", ".....o.o...o.o........", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", "......................", ".....ooooooooo........", ".....ooooooooo........", "...oooookoookooo......", "...oooookoookooo......", ".....ooooooooo........", ".....ooooooooo........", ".....o.o...o.o........", ".....o.o...o.o........", "......................", "......................")), intArrayOf(180, 180, 180, 180, 180, 180, 180, 180, 180, 180, 180, 180)),
        Def(22, 18, 9.5f, 11f, listOf(listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", ".....ooooooooo........", ".....ooooooooo........", "...ooookoookoooo......", "...ooookoookoooo......", ".....ooooooooo........", ".....ooooooooo........", ".....o.o...o.o........", ".....o.o...o.o........", "......................", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", "......................", ".....ooooooooo........", ".....ooooooooo........", "...ooookoookoooo......", "...ooookoookoooo......", ".....ooooooooo........", ".....ooooooooo........", ".....o.o...o.o........", "......................", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", "......................", ".....ooooooooo........", ".....ooooooooo........", "...ooookoookoooo......", "...ooookoookoooo......", ".....ooooooooo........", ".....ooooooooo........", ".....o.o...o.o........", "......................", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", ".....ooooooooo........", ".....ooooooooo........", "...ooookoookoooo......", "...oookokokokooo......", ".....ooooooooo........", ".....ooooooooo........", ".....o.o...o.o........", ".....o.o...o.o........", "......................", "......................", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", ".....ooooooooo........", ".....ooooooooo........", "...ooookoookoooo......", "...oookokokokooo......", ".....ooooooooo........", ".....ooooooooo........", ".....o.o...o.o........", ".....o.o...o.o........", "......................", "......................", "......................", "......................", "......................", "......................"),
            listOf("......................", "......................", "......................", ".....ooooooooo........", ".....ooooooooo........", "...ooookoookoooo......", "...oookokokokooo......", ".....ooooooooo........", ".....ooooooooo........", ".....o.o...o.o........", ".....o.o...o.o........", "......................", "......................", "......................", "......................", "......................", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", ".....ooooooooo........", ".....ooooooooo........", "...ooookoookoooo......", "...oookokokokooo......", ".....ooooooooo........", ".....ooooooooo........", ".....o.o...o.o........", ".....o.o...o.o........", "......................", "......................", "......................", "......................", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", ".....ooooooooo........", ".....ooooooooo........", "...ooookoookoooo......", "...ooookoookoooo......", ".....ooooooooo........", ".....ooooooooo........", ".....o.o...o.o........", ".....o.o...o.o........", "......................", "......................", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", "......................", ".....ooooooooo........", ".....ooooooooo........", "...ooookoookoooo......", "...ooookoookoooo......", ".....ooooooooo........", ".....ooooooooo........", ".....o.o...o.o........", "......................", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", ".....ooooooooo........", ".....ooooooooo........", "...ooookoookoooo......", "...ooookoookoooo......", ".....ooooooooo........", ".....ooooooooo........", ".....o.o...o.o........", ".....o.o...o.o........", "......................", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", ".....ooooooooo........", ".....ooooooooo........", "...ooookoookoooo......", "...ooookoookoooo......", ".....ooooooooo........", ".....ooooooooo........", ".....o.o...o.o........", ".....o.o...o.o........", "......................", "......................", "......................")), intArrayOf(150, 90, 90, 70, 70, 120, 70, 70, 100, 100, 250)),
        Def(22, 18, 9.5f, 11f, listOf(listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", ".....ooooooooo........", ".....ooooooooo........", ".h.hoohohohohooo......", ".hhhoohhhohhhooo......", "..h..oohooohoo........", ".....ooooooooo........", ".....o.o...o.o....h.h.", ".....o.o...o.o....hhh.", "...................h..", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", "......................", ".h.h.ooooooooo........", ".hhh.ooooooooo........", "..hooohohohohooo......", "...ooohhhohhhooo......", ".....oohooohoo....h.h.", ".....ooooooooo....hhh.", ".....o.o...o.o.....h..", ".....o.o...o.o........", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", ".h.h.ooooooooo........", ".hhh.ooooooooo........", "..hooohohohohooo......", "...ooohhhohhhooo......", ".....oohooohoo....h.h.", ".....ooooooooo....hhh.", ".....o.o...o.o.....h..", ".....o.o...o.o........", "......................", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", ".h.h..................", ".hhh..................", "..h..ooooooooo........", ".....ooooooooo........", "...ooohohohohooo..h.h.", "...ooohhhohhhooo..hhh.", ".....oohooohoo.....h..", ".....ooooooooo........", ".....o.o...o.o........", ".....o.o...o.o........", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", ".h.h..................", ".hhh..................", "..h..ooooooooo........", ".....ooooooooo........", "...ooohohohohooo..h.h.", "...ooohhhohhhooo..hhh.", ".....oohooohoo.....h..", ".....ooooooooo........", ".....o.o...o.o........", ".....o.o...o.o........", "......................", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", "......................", ".....ooooooooo....h.h.", ".....ooooooooo....hhh.", "...ooohohohohooo...h..", "...ooohhhohhhooo......", ".....oohooohoo........", ".h.h.ooooooooo........", ".hhh.o.o...o.o........", "..h..o.o...o.o........", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", ".....ooooooooo....h.h.", ".....ooooooooo....hhh.", "...ooohohohohooo...h..", "...ooohhhohhhooo......", ".....oohooohoo........", ".h.h.ooooooooo........", ".hhh.o.o...o.o........", "..h..o.o...o.o........", "......................", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", "..................h.h.", "..................hhh.", ".....ooooooooo.....h..", ".....ooooooooo........", "...ooohohohohooo......", ".h.hoohhhohhhooo......", ".hhh.oohooohoo........", "..h..ooooooooo........", ".....o.o...o.o........", ".....o.o...o.o........", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "..................h.h.", "..................hhh.", ".....ooooooooo.....h..", ".....ooooooooo........", "...ooohohohohooo......", ".h.hoohhhohhhooo......", ".hhh.oohooohoo........", "..h..ooooooooo........", ".....o.o...o.o........", ".....o.o...o.o........", "......................", "......................", "......................")), intArrayOf(150, 150, 150, 150, 150, 150, 150, 150, 150)),
        Def(22, 18, 9.5f, 11f, listOf(listOf("......................", "......................", "......................", "......................", "......................", ".................s....", "................sss...", ".s...ooooooooo...s....", "sss..oosooosoo........", ".s.ooosssosssooo......", "...oooosooosoooo......", ".....ooooooooo........", ".....ooooooooo........", ".....o.o...o.o........", ".....o.o...o.o........", "......................", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", ".................s....", ".................s....", "...............sssss..", ".................s....", ".....ooooooooo...s....", ".....oosooosoo........", "...ooosssosssooo......", "...oooosooosoooo......", ".....ooooooooo........", ".....ooooooooo........", ".....o.o...o.o........", ".....o.o...o.o........", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", ".................s....", "................sss...", ".....ooooooooo...s....", ".....oosooosoo........", "...ooosssosssooo......", "...oooosooosoooo......", ".....ooooooooo....s...", ".....ooooooooo...sss..", ".....o.o...o.o....s...", ".....o.o...o.o........", "......................", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", "......................", ".....ooooooooo........", ".....oosooosoo........", "...ooosssosssooo..s...", "...oooosooosoooo..s...", ".....ooooooooo..sssss.", ".....ooooooooo....s...", ".....o.o...o.o....s...", ".....o.o...o.o........", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", ".s...ooooooooo........", "sss..oosooosoo........", ".s.ooosssosssooo......", "...oooosooosoooo......", ".....ooooooooo....s...", ".....ooooooooo...sss..", ".....o.o...o.o....s...", ".....o.o...o.o........", "......................", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", ".s....................", ".s....................", "ssss.ooooooooo........", ".s...oosooosoo........", ".s.ooosssosssooo......", "...oooosooosoooo......", ".....ooooooooo........", ".....ooooooooo........", ".....o.o...o.o........", ".....o.o...o.o........", "......................", "......................")), intArrayOf(200, 200, 200, 200, 200, 200)),
        Def(22, 18, 9.5f, 11f, listOf(listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", ".....ooooooooo........", ".....ooooooooo........", "...ooookoookoooo......", "...ooookoookoooo......", ".....ooooooooo........", ".....gcccddccg........", ".....gdddccccgo.......", "....oggggggggg........", "....ggggggggggg.......", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", ".....ooooooooo........", ".....ooooooooo........", "...ooookoookoooo......", "...ooookoookoooo......", ".....ooooooooo........", ".....gdcdccccg........", "....ogddcdcccg........", ".....gggggggggo.......", "....ggggggggggg.......", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", ".....ooooooooo........", ".....ooooooooo........", "...ooookoookoooo......", "...ooookoookoooo......", ".....ooooooooo........", ".....gdccccccg........", ".....gddcdcddgo.......", "....oggggggggg........", "....ggggggggggg.......", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", ".....ooooooooo........", ".....ooooooooo........", "...ooookoookoooo......", "...ooookoookoooo......", ".....ooooooooo........", ".....gdcdcdddg........", "....ogdddccccg........", ".....gggggggggo.......", "....ggggggggggg.......", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", ".....ooooooooo........", ".....ooooooooo........", "...ooookoookoooo......", "...ooookoookoooo......", ".....ooooooooo........", ".....gdcdddccg........", ".....gdcdccccgo.......", "....oggggggggg........", "....ggggggggggg.......", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", ".....ooooooooo........", ".....ooooooooo........", "...ooookoookoooo......", "...ooookoookoooo......", ".....ooooooooo........", ".....gdddccccg........", "....ogdddcdddg........", ".....gggggggggo.......", "....ggggggggggg.......", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", ".....ooooooooo........", ".....ooooooooo........", "...ooookoookoooo......", "...ooookoookoooo......", ".....ooooooooo........", ".....gcccccccg........", ".....gdcdddccgo.......", "....oggggggggg........", "....ggggggggggg.......", "......................", "......................"),
            listOf("......................", "......................", "......................", "......................", "......................", "......................", "......................", ".....ooooooooo........", ".....ooooooooo........", "...ooookoookoooo......", "...ooookoookoooo......", ".....ooooooooo........", ".....gcccddccg........", "....ogccdccccg........", ".....gggggggggo.......", "....ggggggggggg.......", "......................", "......................")), intArrayOf(140, 140, 140, 140, 140, 140, 140, 140))
    )
    private val ALL = STATIC + MOVING
    private val PAL = mapOf('o' to Color(0xFFD97757), 'k' to Color(0xFF1D1B1A), 'h' to Color(0xFFEE5A7A), 's' to Color(0xFFFFD54A), 't' to Color(0xFF7CC4FF),
        'b' to Color(0xFFF29A9A), 'g' to Color(0xFF6B7280), 'c' to Color(0xFFA5E8FF), 'd' to Color(0xFF2B6F86))

    // each frame as horizontal runs of one colour: fewer rectangles to draw
    class Run(val x: Int, val y: Int, val len: Int, val color: Color)
    class Sprite(val def: Def, val frames: List<List<Run>>, val cycle: Int)
    val SPRITES: List<Sprite> = ALL.map { d ->
        Sprite(d, d.frames.map { rows ->
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
        }, d.ms.sum())
    }
    val STATIC_COUNT get() = STATIC.size

    class Flyer(val at: Long, val dur: Long, val sprite: Int, val sizeDp: Float, val sx: Float, val ex: Float, val sy: Float, val ey: Float, val apex: Float, val spin: Float, val phase: Int)

    /** 0: not the command, 1: started (the box is emptied, or the message goes on when [send]), 2: refused (the text stays). */
    fun handle(app: AppState, text: String, send: Boolean = false): Int {
        val t = text.trim()
        if (TWICE.containsMatchIn(t)) { app.say("Write /claude only once"); return 2 }
        if (!ONE.matches(t)) return 0
        if (app.fxAt != 0L && System.currentTimeMillis() - app.fxAt < EVERY_MS) { app.say("Only one /claude every 30 seconds"); return 2 }
        app.fxAt = System.currentTimeMillis()
        return 1
    }

    /** A "/claude" that came in from the other person: played if it is fresh and the last one is more than 30 seconds ago. */
    fun received(app: AppState, sentAt: Long) {
        val now = System.currentTimeMillis()
        if (now - sentAt > 60_000L) return
        if (app.fxAt != 0L && now - app.fxAt < EVERY_MS) return
        app.fxAt = now
    }

    // who jumps when: a burst of ten at the start, then one to three every 0.1 to 0.4 s until second 36, each in the air 1.7 to 3.2 seconds
    fun plan(seed: Long): List<Flyer> {
        val r = Random(seed)
        val out = ArrayList<Flyer>()
        fun add(t: Long) {
            val s = r.nextInt(6)   // 0 to 2: from the bottom, 3: left side, 4: right side, 5: from the bottom going straight up
            val dur = 1700L + r.nextInt(1500)
            val size = 40f + r.nextFloat() * 56f
            val sprite = if (r.nextInt(100) < 45) STATIC_COUNT + r.nextInt(MOVING.size) else r.nextInt(STATIC_COUNT)
            val spin = (60 + r.nextInt(260)) * (if (r.nextBoolean()) 1f else -1f)
            val phase = r.nextInt(2000)
            out.add(when (s) {
                3 -> Flyer(t, dur, sprite, size, -0.15f, 0.3f + r.nextFloat() * 0.9f, 0.15f + r.nextFloat() * 0.85f, 1.25f, 0.1f + r.nextFloat() * 0.55f, spin, phase)
                4 -> Flyer(t, dur, sprite, size, 1.15f, 0.7f - r.nextFloat() * 0.9f, 0.15f + r.nextFloat() * 0.85f, 1.25f, 0.1f + r.nextFloat() * 0.55f, spin, phase)
                5 -> { val x0 = 0.05f + r.nextFloat() * 0.9f; Flyer(t, dur, sprite, size, x0, x0 + (r.nextFloat() - 0.5f) * 0.1f, 1.15f, 1.15f, 0.6f + r.nextFloat() * 0.6f, spin, phase) }
                else -> {
                    val x0 = -0.05f + r.nextFloat() * 1.1f
                    Flyer(t, dur, sprite, size, x0, (x0 + (r.nextFloat() - 0.5f) * 1.3f).coerceIn(-0.2f, 1.2f), 1.15f, 1.15f, 0.4f + r.nextFloat() * 0.7f, spin, phase)
                }
            })
        }
        for (i in 0 until 10) add(i * 30L)
        var t = 300L
        while (t < 36_300L) {
            repeat(1 + (if (r.nextInt(3) == 0) 1 else 0) + (if (r.nextInt(6) == 0) 1 else 0)) { add(t) }
            t += 100L + r.nextInt(300)
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
        if (app.fxAt == at) app.fxAt = 0L
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
            val sp = ClaudeFx.SPRITES[f.sprite]
            val cell = f.sizeDp * density / 13f
            // which frame of the drawing is on now
            var frame = 0
            if (sp.frames.size > 1) { var m = ((e + f.phase) % sp.cycle).toInt(); while (m >= sp.def.ms[frame]) { m -= sp.def.ms[frame]; frame++ } }
            val left = cx - sp.def.ax * cell; val top = cy - sp.def.ay * cell
            withTransform({ rotate(f.spin * (2f * p - 1f), Offset(cx, cy)) }) {
                for (r in sp.frames[frame]) drawRect(r.color, Offset(left + r.x * cell, top + r.y * cell), Size(r.len * cell + 0.6f, cell + 0.6f))
            }
        }
    }
}
