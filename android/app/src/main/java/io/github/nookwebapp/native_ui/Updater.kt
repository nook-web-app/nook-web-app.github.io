package io.github.nookwebapp.native_ui

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

// Updates without a store, the way Telegram's own apk does it: the app reads apk/version.json from the Nook site, and
// when a newer build is there it asks (the web app's "Update available" sheet); Update now downloads the apk and hands
// it to Android's installer, which keeps everything on the phone because the new apk is signed with the same key.
object Updater {
    private const val BASE = "https://nook-web-app.github.io/apk/"
    class Release(val code: Long, val name: String)

    private fun myCode(ctx: Context): Long {
        val pi = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        @Suppress("DEPRECATION")
        return if (Build.VERSION.SDK_INT >= 28) pi.longVersionCode else pi.versionCode.toLong()
    }

    // null when it could not be read; a Release only when it is newer than this app
    fun latest(ctx: Context): Result<Release?> = runCatching {
        val c = URL(BASE + "version.json?t=" + System.currentTimeMillis()).openConnection() as HttpURLConnection
        c.connectTimeout = 8000; c.readTimeout = 8000; c.useCaches = false
        val j = JSONObject(c.inputStream.use { it.readBytes().decodeToString() })
        val r = Release(j.getLong("code"), j.optString("name"))
        if (r.code > myCode(ctx)) r else null
    }

    // onProgress gets 0..1 while the apk comes in (a size that is not known gives -1)
    fun download(ctx: Context, onProgress: ((Float) -> Unit)? = null): File {
        val out = File(File(ctx.cacheDir, "update").apply { mkdirs() }, "nook.apk")
        val c = URL(BASE + "nook.apk?t=" + System.currentTimeMillis()).openConnection() as HttpURLConnection
        c.connectTimeout = 10000; c.readTimeout = 30000; c.useCaches = false
        if (c.contentLengthLong > 500_000_000L) throw SecurityException("update too large")
        val total = c.contentLengthLong
        c.inputStream.use { i ->
            out.outputStream().use { o ->
                val buf = ByteArray(64 * 1024); var done = 0L; var last = -1
                while (true) {
                    val n = i.read(buf)
                    if (n < 0) break
                    o.write(buf, 0, n); done += n
                    // a report for every whole percent, not for every chunk
                    val pct = if (total > 0) (done * 100 / total).toInt() else -1
                    if (pct != last) { last = pct; onProgress?.invoke(if (total > 0) done.toFloat() / total else -1f) }
                }
            }
        }
        // only a newer build of this same app, signed with this app's own key, is ever handed to the installer
        if (!trusted(ctx, out)) { out.delete(); throw SecurityException("update not signed by Nook") }
        return out
    }

    private fun certs(ctx: Context, pi: android.content.pm.PackageInfo?): Set<String> {
        @Suppress("DEPRECATION")
        val sigs = if (Build.VERSION.SDK_INT >= 28) pi?.signingInfo?.let { if (it.hasMultipleSigners()) it.apkContentsSigners else it.signingCertificateHistory } else pi?.signatures
        return sigs.orEmpty().map { java.security.MessageDigest.getInstance("SHA-256").digest(it.toByteArray()).joinToString("") { b -> "%02x".format(b) } }.toSet()
    }
    private fun trusted(ctx: Context, apk: File): Boolean = runCatching {
        val pm = ctx.packageManager
        @Suppress("DEPRECATION")
        val flags = if (Build.VERSION.SDK_INT >= 28) android.content.pm.PackageManager.GET_SIGNING_CERTIFICATES else android.content.pm.PackageManager.GET_SIGNATURES
        val theirs = pm.getPackageArchiveInfo(apk.path, flags) ?: return false
        if (theirs.packageName != ctx.packageName) return false
        @Suppress("DEPRECATION")
        val code = if (Build.VERSION.SDK_INT >= 28) theirs.longVersionCode else theirs.versionCode.toLong()
        if (code <= myCode(ctx)) return false
        val mine = certs(ctx, pm.getPackageInfo(ctx.packageName, flags))
        mine.isNotEmpty() && certs(ctx, theirs).any { it in mine }
    }.getOrDefault(false)

    // a patch (same first two numbers, like 3.27.4 to 3.27.5) installs by itself; a new minor or major version asks first
    fun isPatch(r: Release): Boolean {
        val a = r.name.split("."); val b = APP_VERSION.split(".")
        return a.size >= 2 && b.size >= 2 && a[0] == b[0] && a[1] == b[1]
    }

    // every update, not only patches, installs by itself in the background: nothing is asked
    @Suppress("UNUSED_PARAMETER")
    fun allQuiet(ctx: Context): Boolean = true

    fun mayInstall(ctx: Context): Boolean = Build.VERSION.SDK_INT < 26 || ctx.packageManager.canRequestPackageInstalls()

    // Android asks once whether Nook may install apps. The apk goes in through a session that asks for no tap: on Android 12
    // and up, once Nook itself has installed an update, the next ones are applied quietly. When the phone still wants a tap
    // (the first time), UpdateReceiver shows the installer's own screen.
    fun askInstallRight(ctx: Context) {
        ctx.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    // onProgress gets the installer's own 0..1 while the apk is checked and put in place
    fun install(ctx: Context, apk: File, onProgress: ((Float) -> Unit)? = null): Boolean {
        if (!mayInstall(ctx)) { askInstallRight(ctx); return false }
        val pi = ctx.packageManager.packageInstaller
        // a session left over from an earlier try would block this one
        runCatching { pi.mySessions.forEach { pi.abandonSession(it.sessionId) } }
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(ctx.packageName)
            if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            // Android 14: Nook keeps the update ownership of itself, so its later updates need no question
            if (Build.VERSION.SDK_INT >= 34) runCatching { setRequestUpdateOwnership(true) }
        }
        val id = pi.createSession(params)
        if (onProgress != null) {
            val cb = object : PackageInstaller.SessionCallback() {
                override fun onCreated(sessionId: Int) {}
                override fun onBadgingChanged(sessionId: Int) {}
                override fun onActiveChanged(sessionId: Int, active: Boolean) {}
                override fun onProgressChanged(sessionId: Int, progress: Float) { if (sessionId == id) onProgress(progress) }
                override fun onFinished(sessionId: Int, success: Boolean) { if (sessionId == id) pi.unregisterSessionCallback(this) }
            }
            runCatching { pi.registerSessionCallback(cb, android.os.Handler(android.os.Looper.getMainLooper())) }
        }
        pi.openSession(id).use { s ->
            apk.inputStream().use { i -> s.openWrite("nook.apk", 0, apk.length()).use { o -> i.copyTo(o); s.fsync(o) } }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
            val done = PendingIntent.getBroadcast(ctx, id, Intent(ctx, UpdateReceiver::class.java).setPackage(ctx.packageName), flags)
            s.commit(done.intentSender)
        }
        // the bytes are in the installer's session: the copy in the cache is not kept
        runCatching { apk.delete() }
        return true
    }
}

// the installer's answer: when it needs the person's tap it hands over its own screen, and a failure is said once
class UpdateReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, i: Intent) {
        when (i.getIntExtra(PackageInstaller.EXTRA_STATUS, -1)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                AppState.current?.updPhase = "Confirm the install on the screen that opened"
                @Suppress("DEPRECATION")
                val next = if (Build.VERSION.SDK_INT >= 33) i.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java) else i.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                next?.let { ctx.startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            }
            PackageInstaller.STATUS_SUCCESS -> {}
            else -> {
                AppState.current?.updProgress = null
                // the installer says why, so the reason can be told
                val why = i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE).orEmpty().take(80)
                AppState.current?.say("The update could not be installed" + if (why.isNotEmpty()) " ($why)" else "")
            }
        }
    }
}
