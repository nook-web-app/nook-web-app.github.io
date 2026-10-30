package io.github.nookwebapp.native_ui

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

// Work that must not stop when the person leaves the app (Zenith writing his answer, a message or a photo being sent): a
// small foreground service holds the process while it runs, with a quiet notification, and goes when the last job ends.
object Keep {
    private var n = 0
    fun begin(ctx: Context?) {
        ctx ?: return
        synchronized(this) { n++; if (n > 1) return }
        runCatching { androidx.core.content.ContextCompat.startForegroundService(ctx, Intent(ctx, KeepService::class.java)) }
    }
    fun end(ctx: Context?) {
        ctx ?: return
        synchronized(this) { n = maxOf(0, n - 1); if (n > 0) return }
        runCatching { ctx.stopService(Intent(ctx, KeepService::class.java)) }
    }
    // the notification of a download: its name and a bar from 0 to 100 (only when the number moved)
    private var lastPct = -1; private var lastAt = 0L
    fun progress(ctx: Context?, title: String, pct: Int) {
        ctx ?: return
        val now = System.currentTimeMillis()
        if (pct == lastPct || (pct in 1..99 && now - lastAt < 400)) return
        lastPct = pct; lastAt = now
        runCatching {
            val nm = ctx.getSystemService(NotificationManager::class.java)
            if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel("nook_work") == null) nm.createNotificationChannel(NotificationChannel("nook_work", "Nook working", NotificationManager.IMPORTANCE_LOW))
            val n = NotificationCompat.Builder(ctx, "nook_work").setSmallIcon(R.drawable.ic_stat).setContentTitle(title.take(60)).setContentText("$pct%")
                .setProgress(100, pct.coerceIn(0, 100), false).setPriority(NotificationCompat.PRIORITY_LOW).setOngoing(true).setOnlyAlertOnce(true).setSilent(true).build()
            nm.notify(7, n)
        }
    }
    suspend fun <T> around(ctx: Context?, f: suspend () -> T): T { begin(ctx); try { return f() } finally { end(ctx) } }
}

class KeepService : Service() {
    override fun onBind(i: Intent?): IBinder? = null
    override fun onStartCommand(i: Intent?, flags: Int, id: Int): Int {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel("nook_work") == null) nm.createNotificationChannel(NotificationChannel("nook_work", "Nook working", NotificationManager.IMPORTANCE_MIN))
        val n: Notification = NotificationCompat.Builder(this, "nook_work").setSmallIcon(R.drawable.ic_stat).setContentTitle("Nook is working").setContentText("Finishing what you started")
            .setPriority(NotificationCompat.PRIORITY_MIN).setOngoing(true).setSilent(true).build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(7, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else startForeground(7, n)
        return START_NOT_STICKY
    }
}
