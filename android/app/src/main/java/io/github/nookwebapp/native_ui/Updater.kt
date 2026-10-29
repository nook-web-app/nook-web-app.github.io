package io.github.nookwebapp.native_ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
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

    fun download(ctx: Context): File {
        val out = File(File(ctx.cacheDir, "update").apply { mkdirs() }, "nook.apk")
        val c = URL(BASE + "nook.apk?t=" + System.currentTimeMillis()).openConnection() as HttpURLConnection
        c.connectTimeout = 10000; c.readTimeout = 30000; c.useCaches = false
        c.inputStream.use { i -> out.outputStream().use { o -> i.copyTo(o) } }
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

    // Android asks once whether Nook may install apps; after that the installer's own Update button is all it takes
    fun install(ctx: Context, apk: File): Boolean {
        if (Build.VERSION.SDK_INT >= 26 && !ctx.packageManager.canRequestPackageInstalls()) {
            ctx.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return false
        }
        val uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".files", apk)
        ctx.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
        return true
    }
}
