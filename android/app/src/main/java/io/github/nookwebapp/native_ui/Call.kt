package io.github.nookwebapp.native_ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlin.math.PI
import kotlin.math.sin

// The call screen with Zenith (owner only). This first version is a test of the look: the phases and the words are played from a script,
// no microphone is used and nothing is sent anywhere yet.
enum class CallPhase(val label: String) {
    Connecting("Connecting..."), Listening("Listening"), Thinking("Thinking..."), Searching("Searching the web..."), Speaking("Speaking"),
}

private class Beat(val phase: CallPhase, val ms: Long, val who: String? = null, val line: String? = null)

private val DEMO = listOf(
    Beat(CallPhase.Listening, 2800, "You", "whats the weather in seeb right now"),
    Beat(CallPhase.Thinking, 1100),
    Beat(CallPhase.Searching, 1600),
    Beat(CallPhase.Speaking, 3600, "Zenith", "its sunny and around 29 degrees out there"),
    Beat(CallPhase.Listening, 2600, "You", "nice thanks"),
    Beat(CallPhase.Speaking, 2200, "Zenith", "anytime"),
)

private fun clock(s: Int) = "%d:%02d".format(s / 60, s % 60)

// a round button of the call screen: filled white when it is on
@Composable
private fun CallBtn(icon: String, label: String, on: Boolean, onClick: () -> Unit) {
    val c = LocalNook.current
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.size(64.dp).clip(CircleShape).background(if (on) c.fg else c.bg2).pressTap(CircleShape) { onClick() }, contentAlignment = Alignment.Center) {
            NIcon(icon, 26.dp, tint = if (on) c.bg else c.fg)
        }
        T(label, Fs.xs, color = c.muted)
    }
}

@Composable
fun CallPanel(app: AppState, p: Panel.Call) {
    val c = LocalNook.current
    // only the owner has calls; a still picture (the screenshot tests) skips the check
    if (p.still == null && !zOn()) { LaunchedEffect(Unit) { app.closePanel(p) }; return }
    val still = p.still?.let { s -> CallPhase.entries.firstOrNull { it.name.equals(s, true) } }
    var phase by remember { mutableStateOf(still ?: CallPhase.Connecting) }
    var seconds by remember { mutableIntStateOf(if (still != null && still != CallPhase.Connecting) 42 else 0) }
    var muted by remember { mutableStateOf(false) }
    var speaker by remember { mutableStateOf(true) }
    var captions by remember { mutableStateOf(true) }
    val lines = remember { mutableStateListOf<Pair<String, String>>().also { if (still != null && still != CallPhase.Connecting) { it.add("You" to "whats the weather in seeb right now"); it.add("Zenith" to "its sunny and around 29 degrees out there") } } }

    // the screen stays on during the call
    val view = LocalView.current
    DisposableEffect(Unit) { view.keepScreenOn = true; onDispose { view.keepScreenOn = false } }

    if (still == null) {
        LaunchedEffect(Unit) {
            delay(1600)
            while (true) for (b in DEMO) {
                phase = b.phase
                if (b.who != null && b.line != null) { lines.add(b.who to b.line); while (lines.size > 3) lines.removeAt(0) }
                delay(b.ms)
            }
        }
        val live = phase != CallPhase.Connecting
        LaunchedEffect(live) { if (live) while (true) { delay(1000); seconds++ } }
    }

    val inf = rememberInfiniteTransition(label = "call")
    val t by inf.animateFloat(0f, 1f, infiniteRepeatable(tween(1800, easing = LinearEasing)), label = "ring")
    val wob by inf.animateFloat(0f, (2 * PI).toFloat(), infiniteRepeatable(tween(900, easing = LinearEasing)), label = "wob")
    val level by animateFloatAsState(
        when { phase == CallPhase.Speaking -> 1f; phase == CallPhase.Listening && !muted -> 0.35f; else -> 0.12f }, tween(300), label = "level",
    )
    val status = if (muted && phase == CallPhase.Listening) "Muted" else phase.label

    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0xFF0E1620), c.bg)))) {
        Column(Modifier.fillMaxSize().padding(horizontal = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Spacer(Modifier.height(20.dp))
            Box(Modifier.clip(RoundedCornerShape(Rad.pill)).background(c.bg2).padding(horizontal = 12.dp, vertical = 6.dp)) {
                T("Test call: no real voice yet", Fs.xs, color = c.muted)
            }
            Spacer(Modifier.height(24.dp))
            T("Zenith", Fs.x3, FontWeight.Bold, c.fg)
            T(status, Fs.base, color = c.muted)
            T(if (phase == CallPhase.Connecting) " " else clock(seconds), Fs.md, color = c.muted)
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Canvas(Modifier.size(300.dp)) {
                    val base = 74.dp.toPx() + 6.dp.toPx()
                    val far = size.minDimension / 2
                    // rings that grow outwards while he speaks, a slow steady ring while you are heard
                    for (i in 0..2) {
                        val q = (t + i / 3f) % 1f
                        drawCircle(c.accent.copy(alpha = (1f - q) * 0.35f * level), radius = base + (far - base) * q, style = Stroke(2.dp.toPx()))
                    }
                    drawCircle(c.accent.copy(alpha = 0.22f + 0.2f * level), radius = base + (sin(wob) * 0.5f + 0.5f) * 8.dp.toPx() * level, style = Stroke(3.dp.toPx()))
                }
                ZenAv(148.dp)
            }
            // what was said, when captions are on
            Box(Modifier.fillMaxWidth().height(96.dp), contentAlignment = Alignment.BottomCenter) {
                if (captions) Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    lines.takeLast(2).forEach { (who, line) ->
                        T(if (who == "You") line else line, Fs.md, if (who == "You") FontWeight.Normal else FontWeight.Medium, if (who == "You") c.muted else c.fg, align = TextAlign.Center)
                    }
                }
            }
            Spacer(Modifier.height(20.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                CallBtn(if (muted) "micoff" else "mic", "Mute", muted) { muted = !muted }
                CallBtn("speaker", if (speaker) "Speaker" else "Earpiece", speaker) { speaker = !speaker }
                CallBtn("captions", "Captions", captions) { captions = !captions }
            }
            Spacer(Modifier.height(28.dp))
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.size(72.dp).clip(CircleShape).background(c.danger).pressTap(CircleShape) { app.closePanel(p) }, contentAlignment = Alignment.Center) {
                    NIcon("phone", 30.dp, tint = Color.White, modifier = Modifier.rotate(135f))
                }
                T("End", Fs.xs, color = c.muted)
            }
            Spacer(Modifier.height(32.dp))
        }
    }
}
