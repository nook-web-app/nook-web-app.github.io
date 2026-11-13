package io.github.nookwebapp.native_ui

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.compose.ui.graphics.toArgb
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
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
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import org.json.JSONObject

// Zenith calls: a push of the type call makes the phone ring for 30 seconds, like a normal call. Answer opens the app and starts the call
// (he speaks first and says why he called), Decline stops the ringing.
object IncomingCall {
    private const val CH = "nook_ring"
    private const val ID = 9

    fun show(ctx: Context, reason: String) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CH) == null) {
            nm.createNotificationChannel(NotificationChannel(CH, "Calls from Zenith", NotificationManager.IMPORTANCE_HIGH).apply {
                setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE), AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 700, 500, 700, 500, 700, 500, 700)
                setShowBadge(false)
            })
        }
        val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        val answer = PendingIntent.getActivity(ctx, 31, Intent(ctx, MainActivity::class.java).putExtra("open", "answer").putExtra("reason", reason).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP), flags)
        val screen = PendingIntent.getActivity(ctx, 33, Intent(ctx, IncomingCallActivity::class.java).putExtra("reason", reason).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP), flags)
        val decline = PendingIntent.getBroadcast(ctx, 32, Intent(ctx, CallReceiver::class.java).setAction("decline"), flags)
        val n = NotificationCompat.Builder(ctx, CH).setSmallIcon(R.drawable.ic_call).setContentTitle("Zenith").setContentText("Zenith is calling")
            .setCategory(NotificationCompat.CATEGORY_CALL).setPriority(NotificationCompat.PRIORITY_HIGH).setOngoing(true).setAutoCancel(false)
            // 30 seconds, then it is a missed call
            .setTimeoutAfter(30_000).setContentIntent(screen).setFullScreenIntent(screen, true).setColor(DarkColors.bg.toArgb())
            .addAction(NotificationCompat.Action.Builder(R.drawable.ic_call, "Decline", decline).build())
            .addAction(NotificationCompat.Action.Builder(R.drawable.ic_call, "Answer", answer).build())
            .build()
        // the sound repeats until the notification goes
        n.flags = n.flags or Notification.FLAG_INSISTENT
        runCatching { NotificationManagerCompat.from(ctx).notify(ID, n) }
    }

    fun clear(ctx: Context) { runCatching { NotificationManagerCompat.from(ctx).cancel(ID) } }
}

// A token for a call, asked for ahead of time (when the Zenith chat opens, and when the phone starts to ring), so a call does not start with that wait.
// Tokens are used once; this one is kept for up to 8 minutes.
object CallWarm {
    @Volatile private var kept: JSONObject? = null
    @Volatile private var at = 0L
    @Volatile private var busy = false

    private fun fresh() = kept != null && System.currentTimeMillis() - at < 8 * 60_000

    suspend fun prefetch() {
        if (busy || fresh()) return
        busy = true
        try {
            val r = Sb.fn("zenith", JSONObject().put("action", "live").put("model", 0).put("tz", java.util.TimeZone.getDefault().id).put("resume", "").put("simple", false), timeoutS = 20)
            if (r.ok && r.body.optBoolean("ok") && r.body.optString("token").isNotEmpty()) { kept = r.body; at = System.currentTimeMillis() }
        } finally { busy = false }
    }

    fun take(): JSONObject? {
        if (!fresh()) return null
        val k = kept
        kept = null
        return k
    }
}

// the ring screen: the whole screen, the app's colours, his picture, Answer and Decline. It is what a tap on the ringing notification opens, and
// what opens by itself when the phone is locked (or the app is open).
class IncomingCallActivity : ComponentActivity() {
    private var tone: android.media.Ringtone? = null
    private fun startRinging() {
        runCatching {
            tone = RingtoneManager.getRingtone(this, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))?.apply {
                audioAttributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
                if (Build.VERSION.SDK_INT >= 28) isLooping = true
                play()
            }
        }
        runCatching {
            val v = getSystemService(android.os.Vibrator::class.java)
            if (v != null && v.hasVibrator()) v.vibrate(android.os.VibrationEffect.createWaveform(longArrayOf(0, 700, 500, 700, 500), 0))
        }
    }
    private fun stopRinging() {
        runCatching { tone?.stop() }; tone = null
        runCatching { getSystemService(android.os.Vibrator::class.java)?.cancel() }
    }
    override fun onStop() { stopRinging(); super.onStop() }
    override fun onDestroy() { stopRinging(); super.onDestroy() }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // on top of the lock screen, and the screen turns on
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true) }
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val reason = intent.getStringExtra("reason").orEmpty()
        val answer = {
            IncomingCall.clear(this)
            answerCover.value = true
            startActivity(Intent(this, MainActivity::class.java).putExtra("open", "answer").putExtra("reason", reason).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP))
            finish()
        }
        val decline = { IncomingCall.clear(this); AppState.current?.declineCall(); finish() }
        // the screen is up, so it rings itself and the notification goes (two things on the screen at once looked wrong)
        IncomingCall.clear(this)
        startRinging()
        window.decorView.postDelayed({ if (!isFinishing) finish() }, 30_000)
        setContent {
            val app = AppState.current
            CompositionLocalProvider(LocalNook provides DarkColors) {
                if (app != null) CompositionLocalProvider(LocalApp provides app) { RingScreen(true, answer, decline) }
                else RingScreen(false, answer, decline)
            }
        }
    }
}

@Composable
fun RingScreen(app: Boolean, onAnswer: () -> Unit, onDecline: () -> Unit, still: Boolean = false) {
    val c = DarkColors
    var shown by remember { mutableStateOf(still) }
    LaunchedEffect(Unit) { shown = true; if (!still) { delay(31_000); onDecline() } }
    val inf = rememberInfiniteTransition(label = "ring")
    val t by inf.animateFloat(0f, 1f, infiniteRepeatable(tween(1500, easing = LinearEasing)), label = "t")
    val pulse by inf.animateFloat(1f, 1.1f, infiniteRepeatable(tween(650), RepeatMode.Reverse), label = "pulse")
    val rise by animateFloatAsState(if (shown) 1f else 0f, tween(450), label = "rise")
    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0xFF0E1620), c.bg)))) {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(horizontal = 28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Spacer(Modifier.height(56.dp))
            T("Incoming call", Fs.base, color = c.muted)
            Spacer(Modifier.height(10.dp))
            T("Zenith", Fs.x3, FontWeight.Bold, c.fg)
            T("is calling...", Fs.base, color = c.muted)
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Canvas(Modifier.size(300.dp)) {
                    val base = 80.dp.toPx() + 6.dp.toPx()
                    val far = size.minDimension / 2
                    for (i in 0..2) {
                        val q = (t + i / 3f) % 1f
                        drawCircle(c.accent.copy(alpha = (1f - q) * 0.4f), radius = base + (far - base) * q, style = Stroke(2.dp.toPx()))
                    }
                }
                if (app) ZenAv(168.dp)
                else Box(Modifier.size(168.dp).clip(CircleShape).background(Brush.linearGradient(listOf(Color(0xFF14466F), Color(0xFF208BFE)))), contentAlignment = Alignment.Center) { T("Z", 84.sp, FontWeight.Bold, Color.White) }
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 24.dp).graphicsLayer { alpha = rise; translationY = (1f - rise) * 48.dp.toPx() }, horizontalArrangement = Arrangement.SpaceBetween) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Box(Modifier.size(72.dp).clip(CircleShape).background(c.danger).pressTap(CircleShape) { onDecline() }, contentAlignment = Alignment.Center) { NIcon("phone", 32.dp, tint = Color.White, modifier = Modifier.rotate(135f)) }
                    T("Decline", Fs.sm, color = c.muted)
                }
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Box(Modifier.graphicsLayer { scaleX = pulse; scaleY = pulse }.size(72.dp).clip(CircleShape).background(c.fill).pressTap(CircleShape) { onAnswer() }, contentAlignment = Alignment.Center) { NIcon("phone", 32.dp, tint = Color.White) }
                    T("Answer", Fs.sm, color = c.muted)
                }
            }
            Spacer(Modifier.height(64.dp))
        }
    }
}

// the ring screen over whatever is open: needs "display over other apps". A tiny invisible window is shown first,
// because newer Android only lets an app open a screen from the background while it has a window on the screen
fun openRingOver(ctx: android.content.Context, reason: String) {
    if (!android.provider.Settings.canDrawOverlays(ctx)) return
    android.os.Handler(android.os.Looper.getMainLooper()).post {
        val wm = ctx.getSystemService(android.content.Context.WINDOW_SERVICE) as android.view.WindowManager
        val v = android.view.View(ctx)
        val lp = android.view.WindowManager.LayoutParams(1, 1, android.view.WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            android.view.WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or android.view.WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE, android.graphics.PixelFormat.TRANSLUCENT)
        runCatching { wm.addView(v, lp) }
        runCatching { ctx.startActivity(android.content.Intent(ctx, IncomingCallActivity::class.java).putExtra("reason", reason).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)) }
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({ runCatching { wm.removeView(v) } }, 4000)
    }
}

// shown from the moment Answer is pressed until the call screen is up, so the home page never shows in between
val answerCover = androidx.compose.runtime.mutableStateOf(false)
