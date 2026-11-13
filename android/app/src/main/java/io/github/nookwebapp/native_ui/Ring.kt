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
        val decline = PendingIntent.getBroadcast(ctx, 32, Intent(ctx, CallReceiver::class.java).setAction("decline"), flags)
        val n = NotificationCompat.Builder(ctx, CH).setSmallIcon(R.drawable.ic_call).setContentTitle("Zenith").setContentText("Zenith is calling")
            .setCategory(NotificationCompat.CATEGORY_CALL).setPriority(NotificationCompat.PRIORITY_HIGH).setOngoing(true).setAutoCancel(false)
            // 30 seconds, then it is a missed call
            .setTimeoutAfter(30_000).setContentIntent(answer).setFullScreenIntent(answer, true).setColor(DarkColors.bg.toArgb())
            .addAction(NotificationCompat.Action.Builder(R.drawable.ic_call, "Decline", decline).build())
            .addAction(NotificationCompat.Action.Builder(R.drawable.ic_call, "Answer", answer).build())
            .build()
        // the sound repeats until the notification goes
        n.flags = n.flags or Notification.FLAG_INSISTENT
        runCatching { NotificationManagerCompat.from(ctx).notify(ID, n) }
    }

    fun clear(ctx: Context) { runCatching { NotificationManagerCompat.from(ctx).cancel(ID) } }
}
