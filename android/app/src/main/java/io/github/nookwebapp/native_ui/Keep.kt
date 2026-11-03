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
    // the download whose progress notification is also the one Android asks for while the service runs (so a download shows one
    // notification, not two); null when the service holds some other work
    @Volatile var holder: String? = null
    @Volatile var holderTitle: String = "Nook"
    fun begin(ctx: Context?, key: String? = null, title: String = "Nook") {
        ctx ?: return
        synchronized(this) {
            n++; if (n > 1) return
            holder = key; holderTitle = title
            runCatching { androidx.core.content.ContextCompat.startForegroundService(ctx, Intent(ctx, KeepService::class.java)) }
        }
    }
    fun end(ctx: Context?, key: String? = null) {
        ctx ?: return
        synchronized(this) {
            n = maxOf(0, n - 1)
            if (n > 0) {
                // the finished download no longer owns the service notification: the quiet one of the remaining work replaces it
                if (key != null && key == holder) {
                    holder = null
                    runCatching { androidx.core.content.ContextCompat.startForegroundService(ctx, Intent(ctx, KeepService::class.java)) }
                }
                return
            }
            holder = null
            runCatching { ctx.stopService(Intent(ctx, KeepService::class.java)) }
        }
    }
    // the notification of a download: its name and a bar from 0 to 100, one for each download (its own number, apart from the one of the
    // service) that goes away at 100 or when the download ends; shown only when the number moved
    private val last = HashMap<String, Pair<Int, Long>>()
    private fun nid(key: String) = 1000 + (key.hashCode() and 0xffff)
    fun progress(ctx: Context?, key: String, title: String, pct: Int) {
        ctx ?: return
        // the service's own notification is this download: its bar is updated there, and it goes when the service stops
        if (holder == key) { if (pct >= 100) return }
        else if (pct >= 100) { clear(ctx, key); return }
        val now = System.currentTimeMillis()
        synchronized(last) {
            val l = last[key]
            if (l != null && (pct == l.first || (pct > 0 && now - l.second < 400))) return
            last[key] = pct to now
        }
        runCatching {
            val nm = ctx.getSystemService(NotificationManager::class.java)
            if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel("nook_dl") == null) nm.createNotificationChannel(NotificationChannel("nook_dl", "Downloads", NotificationManager.IMPORTANCE_LOW))
            val n = NotificationCompat.Builder(ctx, "nook_dl").setSmallIcon(R.drawable.ic_stat).setContentTitle(title.take(60)).setContentText("$pct%")
                .setProgress(100, pct.coerceIn(0, 100), false).setPriority(NotificationCompat.PRIORITY_LOW).setOngoing(true).setOnlyAlertOnce(true).setSilent(true).build()
            nm.notify(if (holder == key) 7 else nid(key), n)
        }
    }
    fun clear(ctx: Context?, key: String) {
        ctx ?: return
        synchronized(last) { last.remove(key) }
        runCatching { ctx.getSystemService(NotificationManager::class.java).cancel(nid(key)) }
    }
    suspend fun <T> around(ctx: Context?, f: suspend () -> T): T { begin(ctx); try { return f() } finally { end(ctx) } }
    // a download: the service shows the progress bar of this download as its one notification
    suspend fun <T> download(ctx: Context?, key: String, title: String, f: suspend () -> T): T { begin(ctx, key, title); try { return f() } finally { end(ctx, key) } }
}

class KeepService : Service() {
    override fun onBind(i: Intent?): IBinder? = null
    override fun onStartCommand(i: Intent?, flags: Int, id: Int): Int {
        val nm = getSystemService(NotificationManager::class.java)
        val download = Keep.holder != null
        if (Build.VERSION.SDK_INT >= 26) {
            if (nm.getNotificationChannel("nook_work") != null) nm.deleteNotificationChannel("nook_work")
            if (download && nm.getNotificationChannel("nook_dl") == null) nm.createNotificationChannel(NotificationChannel("nook_dl", "Downloads", NotificationManager.IMPORTANCE_LOW))
            if (!download && nm.getNotificationChannel("nook_hold") == null) nm.createNotificationChannel(NotificationChannel("nook_hold", "Background work", NotificationManager.IMPORTANCE_NONE))
        }
        // a download: its bar is the notification Android asks for; other work: a quiet one on a channel that is switched off
        val n: Notification = if (download) NotificationCompat.Builder(this, "nook_dl").setSmallIcon(R.drawable.ic_stat).setContentTitle(Keep.holderTitle.take(60)).setProgress(100, 0, true)
            .setPriority(NotificationCompat.PRIORITY_LOW).setOngoing(true).setOnlyAlertOnce(true).setSilent(true).build()
        else NotificationCompat.Builder(this, "nook_hold").setSmallIcon(R.drawable.ic_stat).setContentTitle("Nook").setPriority(NotificationCompat.PRIORITY_MIN).setOngoing(true).setSilent(true).build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(7, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else startForeground(7, n)
        return START_NOT_STICKY
    }
}
