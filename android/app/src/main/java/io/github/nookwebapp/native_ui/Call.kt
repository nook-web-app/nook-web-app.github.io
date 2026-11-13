package io.github.nookwebapp.native_ui

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import androidx.compose.animation.Crossfade
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
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
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.sin

// The call with Zenith (owner only). This version is a test of the look: the phases and the words are played from a script, no microphone is
// used and nothing is sent anywhere yet. The call lives in AppState.call, so closing the call screen does not end it; while it runs there
// is a notification with the call timer (the chip in the status bar of the phone), and the End button or the notification ends it.
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

class CallSession(private val scope: CoroutineScope? = null, private val onLive: () -> Unit = {}) {
    var phase by mutableStateOf(CallPhase.Connecting)
    var seconds by mutableIntStateOf(0)
    var muted by mutableStateOf(false)
    var speaker by mutableStateOf(true)
    var captions by mutableStateOf(true)
    val lines = mutableStateListOf<Pair<String, String>>()
    // when the call was picked up (the timer of the notification counts from here); null while it connects
    var connectedAt: Long? = null
    private var job: Job? = null

    fun start() {
        job = scope?.launch {
            delay(1600)
            connectedAt = System.currentTimeMillis()
            onLive()
            launch { while (true) { delay(1000); seconds++ } }
            while (true) for (b in DEMO) {
                phase = b.phase
                if (b.who != null && b.line != null) { lines.add(b.who to b.line); while (lines.size > 3) lines.removeAt(0) }
                delay(b.ms)
            }
        }
    }

    fun stop() { job?.cancel() }

    companion object {
        // a frozen call, for the pictures of the screenshot tests
        fun still(name: String): CallSession = CallSession().also { s ->
            s.phase = CallPhase.entries.firstOrNull { it.name.equals(name, true) } ?: CallPhase.Connecting
            if (s.phase != CallPhase.Connecting) { s.seconds = 42; s.lines.add("You" to "whats the weather in seeb right now"); s.lines.add("Zenith" to "its sunny and around 29 degrees out there") }
        }
    }
}

// the notification of a call: Android's call style with a timer, in the blue of the app's background, asking to be shown in the status bar
// (the chip that Samsung's One UI and Android 16 show for an ongoing call)
object CallNote {
    const val CH = "nook_call"
    const val ID = 8
    fun build(ctx: Context, since: Long?): Notification {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CH) == null) nm.createNotificationChannel(NotificationChannel(CH, "Calls with Zenith", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(ctx, 21, Intent(ctx, MainActivity::class.java).putExtra("open", "call").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val end = PendingIntent.getBroadcast(ctx, 22, Intent(ctx, CallReceiver::class.java).setAction("end"), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val who = Person.Builder().setName("Zenith").setImportant(true).build()
        val b = NotificationCompat.Builder(ctx, CH).setSmallIcon(R.drawable.ic_stat).setContentTitle("Zenith").setContentText(if (since == null) "Connecting..." else "Call in progress")
            .setOngoing(true).setOnlyAlertOnce(true).setSilent(true).setCategory(NotificationCompat.CATEGORY_CALL).setContentIntent(open)
            .setColor(DarkColors.bg.toArgb()).setColorized(true)
            .setStyle(NotificationCompat.CallStyle.forOngoingCall(who, end))
            // Android 16: a live notification that may take a place in the status bar
            .addExtras(Bundle().apply { putBoolean("android.requestPromotedOngoing", true) })
        if (since != null) b.setUsesChronometer(true).setShowWhen(true).setWhen(since)
        return b.build()
    }
}

// holds the process (and shows the notification) while a call runs
class CallService : Service() {
    override fun onBind(i: Intent?): IBinder? = null
    override fun onStartCommand(i: Intent?, flags: Int, id: Int): Int {
        val call = AppState.current?.call
        if (call == null) { stopSelf(); return START_NOT_STICKY }
        val n = CallNote.build(this, call.connectedAt)
        if (Build.VERSION.SDK_INT >= 29) startForeground(CallNote.ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else startForeground(CallNote.ID, n)
        return START_NOT_STICKY
    }
}

// the End button of the notification
class CallReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, i: Intent) {
        val app = AppState.current
        if (app != null) app.endCall() else runCatching { ctx.stopService(Intent(ctx, CallService::class.java)) }
    }
}

private fun clock(s: Int) = "%d:%02d".format(s / 60, s % 60)

// the buttons slide up one after the other when the screen opens
private fun Modifier.rise(shown: Boolean, i: Int): Modifier = composed {
    val a by animateFloatAsState(if (shown) 1f else 0f, tween(420, delayMillis = 70 * i), label = "rise")
    graphicsLayer { alpha = a; translationY = (1f - a) * 36.dp.toPx() }
}

// a round button of the call screen: it fills white when it is on, the colours fade, and it bounces when it is switched
@Composable
private fun CallBtn(icon: String, label: String, on: Boolean, enter: Modifier, red: Boolean = false, turn: Float = 0f, onClick: () -> Unit) {
    val c = LocalNook.current
    val bg by animateColorAsState(if (red) c.danger else if (on) c.fg else c.bg2, tween(220), label = "bg")
    val tint by animateColorAsState(if (red) Color.White else if (on) c.bg else c.fg, tween(220), label = "tint")
    val bounce = remember { Animatable(1f) }
    var first by remember { mutableStateOf(true) }
    LaunchedEffect(on) { if (first) first = false else { bounce.snapTo(0.8f); bounce.animateTo(1f, spring(0.4f, 380f)) } }
    Column(enter, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.graphicsLayer { scaleX = bounce.value; scaleY = bounce.value }.size(60.dp).clip(CircleShape).background(bg).pressTap(CircleShape) { onClick() }, contentAlignment = Alignment.Center) {
            Crossfade(icon, animationSpec = tween(180), label = "icon") { NIcon(it, 26.dp, tint = tint, modifier = Modifier.rotate(turn)) }
        }
        T(label, Fs.xs, color = c.muted)
    }
}

@Composable
fun CallPanel(app: AppState, p: Panel.Call) {
    // only the owner has calls; a still picture (the screenshot tests) skips the check
    if (p.still == null && !zOn()) { LaunchedEffect(Unit) { app.closePanel(p) }; return }
    val s = if (p.still != null) remember(p.still) { CallSession.still(p.still) } else app.call
    // the call ended (from the notification, say): the screen goes
    if (s == null) { LaunchedEffect(Unit) { app.closePanel(p) }; return }
    // the call screen is always dark, whatever the theme of the app is
    CompositionLocalProvider(LocalNook provides DarkColors) { CallBody(app, p, s) }
}

@Composable
private fun CallBody(app: AppState, p: Panel.Call, s: CallSession) {
    val c = LocalNook.current
    var shown by remember { mutableStateOf(p.still != null) }
    LaunchedEffect(Unit) { shown = true }

    // the screen stays on, and the status bar icons are light, while this screen is open
    val view = LocalView.current
    DisposableEffect(Unit) {
        view.keepScreenOn = true
        val win = (view.context as? android.app.Activity)?.window
        val ctl = win?.let { androidx.core.view.WindowCompat.getInsetsController(it, view) }
        val was = ctl?.isAppearanceLightStatusBars
        ctl?.isAppearanceLightStatusBars = false
        onDispose { view.keepScreenOn = false; if (was != null) ctl?.isAppearanceLightStatusBars = was }
    }

    val inf = rememberInfiniteTransition(label = "call")
    val t by inf.animateFloat(0f, 1f, infiniteRepeatable(tween(1800, easing = LinearEasing)), label = "ring")
    val wob by inf.animateFloat(0f, (2 * PI).toFloat(), infiniteRepeatable(tween(900, easing = LinearEasing)), label = "wob")
    val level by animateFloatAsState(
        when { s.phase == CallPhase.Speaking -> 1f; s.phase == CallPhase.Listening && !s.muted -> 0.35f; else -> 0.12f }, tween(300), label = "level",
    )
    val status = if (s.muted && s.phase == CallPhase.Listening) "Muted" else s.phase.label

    // the gradient fills the whole screen, behind the status bar and the navigation bar too
    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0xFF0E1620), c.bg)))) {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(horizontal = 20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            // top: close the screen (the call goes on), the test label, captions
            Row(Modifier.fillMaxWidth().padding(top = 12.dp).rise(shown, 0), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(40.dp).clip(CircleShape).background(c.bg2).pressTap(CircleShape) { app.closePanel(p) }, contentAlignment = Alignment.Center) {
                    NIcon("back", 22.dp, tint = c.fg, modifier = Modifier.rotate(-90f))
                }
                Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                    Box(Modifier.clip(RoundedCornerShape(Rad.pill)).background(c.bg2).padding(horizontal = 12.dp, vertical = 6.dp)) {
                        T("Test call, no voice yet", Fs.xs, color = c.muted, maxLines = 1)
                    }
                }
                val capBg by animateColorAsState(if (s.captions) c.fg else c.bg2, tween(220), label = "cap")
                val capTint by animateColorAsState(if (s.captions) c.bg else c.fg, tween(220), label = "capTint")
                Box(Modifier.size(40.dp).clip(CircleShape).background(capBg).pressTap(CircleShape) { s.captions = !s.captions }, contentAlignment = Alignment.Center) {
                    NIcon("captions", 20.dp, tint = capTint)
                }
            }
            Spacer(Modifier.height(24.dp))
            Column(Modifier.rise(shown, 1), horizontalAlignment = Alignment.CenterHorizontally) {
                T("Zenith", Fs.x3, FontWeight.Bold, c.fg)
                Crossfade(status, animationSpec = tween(250), label = "status") { T(it, Fs.base, color = c.muted) }
                T(if (s.phase == CallPhase.Connecting) " " else clock(s.seconds), Fs.md, color = c.muted)
            }
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
                if (s.captions) Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    s.lines.takeLast(2).forEach { (who, line) ->
                        T(line, Fs.md, if (who == "You") FontWeight.Normal else FontWeight.Medium, if (who == "You") c.muted else c.fg, align = TextAlign.Center)
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
            // mute, speaker and end, well apart from each other
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                CallBtn(if (s.muted) "micoff" else "mic", "Mute", s.muted, Modifier.rise(shown, 2)) { s.muted = !s.muted }
                CallBtn("speaker", "Speaker", s.speaker, Modifier.rise(shown, 3)) { s.speaker = !s.speaker }
                CallBtn("phone", "End", false, Modifier.rise(shown, 4), red = true, turn = 135f) { app.endCall() }
            }
            Spacer(Modifier.height(32.dp))
        }
    }
}
