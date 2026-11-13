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
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas as GCanvas
import android.graphics.Paint
import android.graphics.Shader
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.BlurredEdgeTreatment
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.sin

// The call with Zenith (owner only): a live voice call (see LiveCall.kt). The call lives in AppState.call, so closing the call screen does
// not end it; while it runs there is a notification with the call timer (the chip in the status bar), a small pill inside the app, and
// a card, like the one of Samsung's music player, that opens from both of them. The End button, or the one of the notification, ends it.
enum class CallPhase(val label: String) {
    Connecting("Connecting..."), Reconnecting("Reconnecting..."), Listening("Listening"), Thinking("Thinking..."), Searching("Searching the web..."), Speaking("Speaking"),
}

// a line of the captions; its words grow while it is being said
class Cap(val id: Int, val who: String, text: String) { var text by mutableStateOf(text) }

class CallSession(private val scope: CoroutineScope? = null, private val onLive: () -> Unit = {}, val reason: String? = null) {
    var phase by mutableStateOf(CallPhase.Connecting)
    var seconds by mutableIntStateOf(0)
    var muted by mutableStateOf(false)
    var speaker by mutableStateOf(true)
    var captions by mutableStateOf(true)
    // End was pressed: the screen plays its goodbye before it goes
    var ending by mutableStateOf(false)
    val lines = mutableStateListOf<Cap>()
    // when the call was picked up (the timer of the notification counts from here); null while it connects
    var connectedAt: Long? = null
    private var engine: LiveEngine? = null
    private var timer: Job? = null
    private var ids = 0

    fun startLive(app: AppState) { engine = LiveEngine(app, this).also { it.start() } }

    // the model is ready: the timer starts
    fun live() {
        if (connectedAt != null) return
        connectedAt = System.currentTimeMillis()
        onLive()
        timer = scope?.launch { while (true) { delay(1000); seconds++ } }
    }

    // words of the call: a person's chunks join into one line until a turn ends
    fun say(who: String, text: String, fresh: Boolean) {
        val last = lines.lastOrNull()
        if (!fresh && last != null && last.who == who) last.text = last.text + text
        else { lines.add(Cap(++ids, who, text.trimStart())); while (lines.size > 6) lines.removeAt(0) }
    }

    fun toggleMute() { muted = !muted }
    fun toggleSpeaker() { speaker = !speaker; engine?.route() }
    fun stop() { engine?.stop(); timer?.cancel() }

    companion object {
        // a frozen call, for the pictures of the screenshot tests
        fun still(name: String): CallSession = CallSession().also { s ->
            s.phase = CallPhase.entries.firstOrNull { it.name.equals(name, true) } ?: CallPhase.Connecting
            if (s.phase != CallPhase.Connecting) {
                s.seconds = 42
                s.say("You", "whats the weather in seeb right now", true)
                s.say("Zenith", "its sunny and around 29 degrees out there", true)
            }
            if (name.equals("ending", true)) { s.phase = CallPhase.Listening; s.ending = true }
            if (name.equals("off", true)) { s.phase = CallPhase.Listening; s.muted = true; s.speaker = false; s.captions = true }
        }
    }
}

// the notification of a call: a plain ongoing one with a timer, asking for a place in the status bar (the chip that Android 16 and Samsung's
// One UI show), in the blue of the app's background, with his picture and the End button
object CallNote {
    const val CH = "nook_call_live"
    const val ID = 8
    @Volatile var avatar: Bitmap? = null

    // his picture as a round bitmap for the notification (off the main thread)
    fun loadAvatar(app: AppState) {
        val src = app.store.zen.optStr("pfp") ?: return
        val bm = runCatching { Photos.bytesOf(src)?.let { BitmapFactory.decodeByteArray(it, 0, it.size) } }.getOrNull() ?: return
        val side = minOf(bm.width, bm.height)
        val sq = Bitmap.createBitmap(bm, (bm.width - side) / 2, (bm.height - side) / 2, side, side)
        val out = Bitmap.createBitmap(192, 192, Bitmap.Config.ARGB_8888)
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { shader = BitmapShader(Bitmap.createScaledBitmap(sq, 192, 192, true), Shader.TileMode.CLAMP, Shader.TileMode.CLAMP) }
        GCanvas(out).drawCircle(96f, 96f, 96f, p)
        avatar = out
    }

    fun build(ctx: Context, since: Long?): Notification {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CH) == null) nm.createNotificationChannel(NotificationChannel(CH, "Calls with Zenith", NotificationManager.IMPORTANCE_DEFAULT).apply { setSound(null, null); enableVibration(false); setShowBadge(false) })
        // a tap opens the card of the call, like the one of a music player
        val open = PendingIntent.getActivity(ctx, 21, Intent(ctx, CallCardActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val end = PendingIntent.getBroadcast(ctx, 22, Intent(ctx, CallReceiver::class.java).setAction("end"), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val b = NotificationCompat.Builder(ctx, CH).setSmallIcon(R.drawable.ic_call).setContentTitle("Zenith").setContentText(if (since == null) "Connecting..." else "Call in progress")
            .setOngoing(true).setOnlyAlertOnce(true).setSilent(true).setContentIntent(open).setColor(DarkColors.bg.toArgb())
            .addAction(NotificationCompat.Action.Builder(R.drawable.ic_call, "End call", end).build())
            // Android 16: a live notification that may take a place in the status bar
            .addExtras(Bundle().apply { putBoolean("android.requestPromotedOngoing", true) })
        avatar?.let { b.setLargeIcon(it) }
        if (since != null) b.setUsesChronometer(true).setShowWhen(true).setWhen(since)
        return b.build()
    }
}

// holds the process (and shows the notification) while a call runs; the microphone is why it must be a foreground service
class CallService : Service() {
    override fun onBind(i: Intent?): IBinder? = null
    override fun onStartCommand(i: Intent?, flags: Int, id: Int): Int {
        val call = AppState.current?.call
        if (call == null) { stopSelf(); return START_NOT_STICKY }
        val n = CallNote.build(this, call.connectedAt)
        runCatching {
            if (Build.VERSION.SDK_INT >= 30) startForeground(CallNote.ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE) else startForeground(CallNote.ID, n)
        }.onFailure { stopSelf() }
        return START_NOT_STICKY
    }
}

// the End button of the notification
class CallReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, i: Intent) {
        if (i.action == "decline") { IncomingCall.clear(ctx); return }
        val app = AppState.current
        if (app != null) app.endCall() else runCatching { ctx.stopService(Intent(ctx, CallService::class.java)) }
    }
}

// the card that a tap on the notification (or on the status bar chip) opens over whatever is on the screen
class CallCardActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = AppState.current
        if (app?.call == null) { finish(); return }
        window.setFlags(android.view.WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS, android.view.WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS)
        setContent {
            CompositionLocalProvider(LocalApp provides app, LocalNook provides DarkColors) {
                val s = app.call
                if (s == null) LaunchedEffect(Unit) { finish() }
                else Box(Modifier.fillMaxSize().clickable(remember { MutableInteractionSource() }, null) { finish() }) {
                    CallCard(app, s, onOpen = {
                        startActivity(Intent(this@CallCardActivity, MainActivity::class.java).putExtra("open", "call").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP))
                        finish()
                    }, onEnd = { app.endCall(); finish() }, modifier = Modifier.align(Alignment.TopCenter).statusBarsPadding())
                }
            }
        }
    }
}

private fun clock(s: Int) = "%d:%02d".format(s / 60, s % 60)

// the timer, apart from everything else, so only this little text is drawn again every second
@Composable
private fun CallClock(s: CallSession, size: androidx.compose.ui.unit.TextUnit, color: Color) {
    val started = s.seconds > 0 || (s.phase != CallPhase.Connecting)
    T(if (started) clock(s.seconds) else " ", size, color = color)
}

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
    // the call is gone from the app when the screen starts to slide away: the last one is kept so the screen still shows its goodbye while it moves
    val last = remember { arrayOfNulls<CallSession>(1) }
    val live = app.call
    if (live != null) last[0] = live
    val s = if (p.still != null) remember(p.still) { CallSession.still(p.still) } else live ?: last[0]
    // no call at all (it ended before the screen was ever drawn): the screen goes
    if (s == null) { LaunchedEffect(Unit) { app.closePanel(p) }; return }
    // the call screen is always dark, whatever the theme of the app is
    CompositionLocalProvider(LocalNook provides DarkColors) { CallBody(app, p, s) }
}

private val CALL_BG = Brush.verticalGradient(listOf(Color(0xFF0E1620), DarkColors.bg))

@Composable
private fun CallBody(app: AppState, p: Panel.Call, s: CallSession) {
    val c = LocalNook.current
    var shown by remember { mutableStateOf(p.still != null) }
    LaunchedEffect(Unit) { shown = true }

    // the screen stays on while this screen is open; dark status bar icons (a light theme) are made light for the time
    val view = LocalView.current
    DisposableEffect(Unit) {
        view.keepScreenOn = true
        val win = (view.context as? android.app.Activity)?.window
        val ctl = win?.let { androidx.core.view.WindowCompat.getInsetsController(it, view) }
        val was = ctl?.isAppearanceLightStatusBars == true
        if (was) ctl?.isAppearanceLightStatusBars = false
        onDispose { view.keepScreenOn = false; if (was) ctl?.isAppearanceLightStatusBars = true }
    }

    val inf = rememberInfiniteTransition(label = "call")
    val t by inf.animateFloat(0f, 1f, infiniteRepeatable(tween(1800, easing = LinearEasing)), label = "ring")
    val wob by inf.animateFloat(0f, (2 * PI).toFloat(), infiniteRepeatable(tween(900, easing = LinearEasing)), label = "wob")
    val level by animateFloatAsState(
        when { s.ending -> 0f; s.phase == CallPhase.Speaking -> 1f; s.phase == CallPhase.Listening && !s.muted -> 0.35f; else -> 0.12f }, tween(300), label = "level",
    )
    // the goodbye: the picture shrinks and fades, the buttons slide down and fade
    val gone by animateFloatAsState(if (s.ending) 1f else 0f, tween(340, easing = FastOutSlowInEasing), label = "gone")
    val status = if (s.ending) "Call ended" else if (s.muted && s.phase == CallPhase.Listening) "Muted" else s.phase.label

    // the gradient fills the whole screen, behind the status bar and the navigation bar too
    Box(Modifier.fillMaxSize().background(CALL_BG)) {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(horizontal = 20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            // top: close the screen (the call goes on), the test label, captions
            Row(Modifier.fillMaxWidth().padding(top = 12.dp).rise(shown, 0), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(40.dp).clip(CircleShape).background(c.bg2).pressTap(CircleShape) { app.closePanel(p) }, contentAlignment = Alignment.Center) {
                    NIcon("back", 22.dp, tint = c.fg, modifier = Modifier.rotate(-90f))
                }
                Spacer(Modifier.weight(1f))
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
                CallClock(s, Fs.md, c.muted)
            }
            Spacer(Modifier.weight(0.3f))
            Box(Modifier.fillMaxWidth().height(290.dp).graphicsLayer { val k = 1f - 0.14f * gone; scaleX = k; scaleY = k; alpha = 1f - 0.45f * gone }, contentAlignment = Alignment.Center) {
                Canvas(Modifier.size(290.dp)) {
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
            // what was said, right under his picture; the lines fade in and the box grows and shrinks with them
            Box(Modifier.fillMaxWidth().heightIn(min = 96.dp).animateContentSize(), contentAlignment = Alignment.TopCenter) {
                androidx.compose.animation.AnimatedVisibility(s.captions && !s.ending, enter = fadeIn(tween(250)) + expandVertically(tween(250)), exit = fadeOut(tween(180)) + shrinkVertically(tween(180))) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.animateContentSize()) {
                        val shownLines = s.lines.takeLast(2)
                        shownLines.forEachIndexed { i, cap ->
                            key(cap.id) {
                                val vis = remember { MutableTransitionState(false).also { it.targetState = true } }
                                AnimatedVisibility(vis, enter = fadeIn(tween(300)) + slideInVertically(tween(300)) { it / 2 }) {
                                    val latest = i == shownLines.lastIndex
                                    T(cap.text, Fs.md, if (latest) FontWeight.Medium else FontWeight.Normal, if (latest) c.fg else c.muted, align = TextAlign.Center)
                                }
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.weight(1f))
            // mute, speaker and end, well apart from each other
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp).graphicsLayer { alpha = 1f - gone; translationY = gone * 48.dp.toPx() }, horizontalArrangement = Arrangement.SpaceBetween) {
                CallBtn(if (s.muted) "micoff" else "mic", "Mute", s.muted, Modifier.rise(shown, 2)) { s.toggleMute() }
                CallBtn(if (s.speaker) "speaker" else "speakeroff", "Speaker", s.speaker, Modifier.rise(shown, 3)) { s.toggleSpeaker() }
                CallBtn("phone", "End", false, Modifier.rise(shown, 4), red = true, turn = 135f) { app.endCall() }
            }
            Spacer(Modifier.height(32.dp))
        }
    }
}

// a small round button of the card
@Composable
private fun MiniBtn(icon: String, on: Boolean, red: Boolean = false, turn: Float = 0f, onClick: () -> Unit) {
    val bg by animateColorAsState(if (red) DarkColors.danger else if (on) Color.White else Color(0x33FFFFFF), tween(200), label = "mbg")
    val tint by animateColorAsState(if (on && !red) Color(0xFF0E1620) else Color.White, tween(200), label = "mtint")
    Box(Modifier.size(48.dp).clip(CircleShape).background(bg).pressTap(CircleShape) { onClick() }, contentAlignment = Alignment.Center) {
        Crossfade(icon, animationSpec = tween(160), label = "micon") { NIcon(it, 22.dp, tint = tint, modifier = Modifier.rotate(turn)) }
    }
}

// the card of the call, like the one of Samsung's music player: his picture is the background, under a dark veil, with the state of the
// call, the last words and the buttons. It opens from the pill inside the app and from the notification and the chip of the status bar.
@Composable
fun CallCard(app: AppState, s: CallSession, onOpen: () -> Unit, onEnd: () -> Unit, modifier: Modifier = Modifier) {
    val c = DarkColors
    app.zenVersion
    val pfp = app.store.zen.optStr("pfp")
    val shape = RoundedCornerShape(28.dp)
    // the card does not pass a tap on to what is behind it
    Box(modifier.fillMaxWidth().padding(12.dp).clip(shape).background(Color(0xFF0E1620)).clickable(remember { MutableInteractionSource() }, null) {}) {
        if (pfp != null) Box(Modifier.matchParentSize().blur(22.dp, BlurredEdgeTreatment.Unbounded)) { PicBare(pfp, Modifier.matchParentSize().graphicsLayer { scaleX = 1.3f; scaleY = 1.3f }) }
        else Box(Modifier.matchParentSize().background(Brush.linearGradient(listOf(Color(0xFF14466F), Color(0xFF208BFE)))))
        Box(Modifier.matchParentSize().background(Brush.verticalGradient(listOf(Color(0x80000000), Color(0xCC000000)))))
        Column(Modifier.fillMaxWidth().padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                ZenAv(48.dp)
                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                    T("Zenith", Fs.lg, FontWeight.Bold, Color.White)
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Crossfade(if (s.ending) "Call ended" else s.phase.label, animationSpec = tween(220), label = "cstatus") { T(it, Fs.md, color = Color(0xCCFFFFFF)) }
                        T("·", Fs.md, color = Color(0x99FFFFFF))
                        CallClock(s, Fs.md, Color(0xCCFFFFFF))
                    }
                }
                Box(Modifier.clip(RoundedCornerShape(Rad.pill)).background(Color(0x33FFFFFF)).pressTap(RoundedCornerShape(Rad.pill)) { onOpen() }.padding(horizontal = 14.dp, vertical = 8.dp)) {
                    T("Open", Fs.md, FontWeight.Medium, Color.White)
                }
            }
            val last = s.lines.lastOrNull()
            if (s.captions && last != null) {
                Spacer(Modifier.height(12.dp))
                T(last.text, Fs.md, color = Color(0xE6FFFFFF), maxLines = 2, modifier = Modifier.animateContentSize())
            }
            Spacer(Modifier.height(14.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                MiniBtn(if (s.muted) "micoff" else "mic", s.muted) { s.toggleMute() }
                MiniBtn(if (s.speaker) "speaker" else "speakeroff", s.speaker) { s.toggleSpeaker() }
                MiniBtn("phone", false, red = true, turn = 135f) { onEnd() }
            }
        }
    }
}

// inside the app: the pill with the call timer, where the system's chip sits in the status bar, and the card that it opens
@Composable
fun CallHost(app: AppState) {
    val s = app.call ?: return
    val inPanel = app.panels.any { it is Panel.Call }
    val c = DarkColors
    if (!s.ending && !inPanel) {
        val density = LocalDensity.current
        val bar = WindowInsets.statusBars.getTop(density)
        val h = 24.dp
        val top = with(density) { ((bar - h.toPx()) / 2f).coerceAtLeast(4.dp.toPx()).toDp() }
        val vis = remember { MutableTransitionState(false).also { it.targetState = true } }
        AnimatedVisibility(vis, enter = fadeIn(tween(220)) + scaleIn(tween(260), initialScale = 0.6f, transformOrigin = TransformOrigin(0f, 0.5f))) {
            val pill = RoundedCornerShape(Rad.pill)
            Row(Modifier.padding(start = 62.dp, top = top).height(h).clip(pill).background(c.bg).border(1.dp, c.accent.copy(alpha = 0.75f), pill).pressTap(pill) { app.callCard = true }.padding(horizontal = 10.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                NIcon("phone", 13.dp, tint = c.accent)
                CallClock(s, Fs.xs, Color.White)
            }
        }
    }
    AnimatedVisibility(app.callCard && !inPanel && !s.ending, enter = fadeIn(tween(200)) + slideInVertically(tween(260)) { -it / 3 }, exit = fadeOut(tween(160)) + slideOutVertically(tween(200)) { -it / 3 }) {
        Box(Modifier.fillMaxSize().background(Color(0x66000000)).clickable(remember { MutableInteractionSource() }, null) { app.callCard = false }) {
            CallCard(app, s, onOpen = { app.callCard = false; app.openCall() }, onEnd = { app.callCard = false; app.endCall() }, modifier = Modifier.align(Alignment.TopCenter).statusBarsPadding())
        }
    }
}
