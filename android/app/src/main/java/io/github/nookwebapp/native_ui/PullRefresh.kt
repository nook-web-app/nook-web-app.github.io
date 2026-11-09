package io.github.nookwebapp.native_ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.math.roundToInt

// the pull down to refresh of the web app (#ptr): a round button follows the finger down from the top of a page, turns while
// it is pulled, and past 72dp a let-go refreshes the page; the round button spins while it works
@Composable
fun PullRefresh(enabled: Boolean, run: suspend () -> Unit, content: @Composable () -> Unit) {
    if (!enabled) { content(); return }
    val c = LocalNook.current
    val th = with(LocalDensity.current) { 72.dp.toPx() }
    val rest = with(LocalDensity.current) { 56.dp.toPx() }
    var pull by remember { mutableFloatStateOf(0f) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val run1 by androidx.compose.runtime.rememberUpdatedState(run)
    fun back() { scope.launch { animate(pull, 0f, animationSpec = tween(220)) { v, _ -> pull = v } } }
    val conn = remember {
        object : NestedScrollConnection {
            // a pull that is open closes first when the finger goes back up
            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                if (busy || source != NestedScrollSource.Drag || pull <= 0f || available.y >= 0f) return Offset.Zero
                val take = maxOf(available.y, -pull / 0.5f)
                pull += take * 0.5f
                return Offset(0f, take)
            }
            // what the list could not scroll (it is at its top) pulls the button down
            override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
                if (busy || source != NestedScrollSource.Drag || available.y <= 0f) return Offset.Zero
                pull = minOf(pull + available.y * 0.5f, th * 1.5f)
                return Offset(0f, available.y)
            }
            override suspend fun onPreFling(available: Velocity): Velocity {
                if (busy || pull <= 0f) return Velocity.Zero
                if (pull >= th) {
                    busy = true
                    scope.launch {
                        animate(pull, rest, animationSpec = tween(160)) { v, _ -> pull = v }
                        // whatever stalls, the spinner goes away after a few seconds
                        withTimeoutOrNull(8000) { runCatching { run1() } }
                        busy = false
                        animate(pull, 0f, animationSpec = tween(220)) { v, _ -> pull = v }
                    }
                } else back()
                return available
            }
        }
    }
    Box(Modifier.fillMaxSize().nestedScroll(conn)) {
        content()
        if (pull > 0f || busy) {
            val spin by rememberInfiniteTransition(label = "pull").animateFloat(0f, 360f, infiniteRepeatable(tween(800, easing = LinearEasing), RepeatMode.Restart), label = "spin")
            Box(
                Modifier.align(Alignment.TopCenter).offset { IntOffset(0, (pull - 44.dp.toPx()).roundToInt()) }.size(40.dp).alpha(minOf(1f, pull / (th * 0.6f)))
                    .clip(CircleShape).background(c.bg2).border(1.dp, c.line, CircleShape),
                contentAlignment = Alignment.Center,
            ) { Box(Modifier.rotate(if (busy) spin else pull * 0.35f)) { NIcon("refresh", 20.dp, c.fg) } }
        }
    }
}
