package io.github.nookwebapp.native_ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.content.FileProvider
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class MainActivity : ComponentActivity() {
    private lateinit var app: AppState

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        app = AppState(Store.open(this))
        app.clipboard = { t -> (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Nook", t)) }
        app.sharePicture = { p, toCompose -> sharePicture(p, toCompose) }
        app.backup = { backup() }
        app.checkUpdate = { manual -> checkUpdate(manual) }
        // like the web app, a new version is looked for a moment after the app opens
        window.decorView.postDelayed({ checkUpdate(false) }, 3000)
        takeShared(intent)
        setContent { NookApp(app) }
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); takeShared(intent) }

    override fun onStop() { super.onStop(); app.store.save(); Thread { app.store.sweepMedia() }.start() }

    // something shared to Nook from another app (the web app's share target): its text and photos open in a new post
    private fun takeShared(i: Intent?) {
        if (i == null || (i.action != Intent.ACTION_SEND && i.action != Intent.ACTION_SEND_MULTIPLE)) return
        val dir = app.store.mediaDir ?: return
        val text = listOfNotNull(i.getStringExtra(Intent.EXTRA_SUBJECT), i.getStringExtra(Intent.EXTRA_TEXT)).joinToString(" ").trim()
        @Suppress("DEPRECATION")
        val uris = if (i.action == Intent.ACTION_SEND_MULTIPLE) i.getParcelableArrayListExtra<android.net.Uri>(Intent.EXTRA_STREAM).orEmpty()
        else listOfNotNull(i.getParcelableExtra<android.net.Uri>(Intent.EXTRA_STREAM))
        Thread {
            val files = uris.take(4).mapNotNull { Photos.intake(this, dir, it) }
            runOnUiThread {
                if (!app.store.signedIn) { app.say("Sign in first"); return@runOnUiThread }
                app.panels.add(Panel.Compose(files = files, text = text))
            }
        }.start()
        setIntent(Intent())
    }

    // Share post: the picture of the post goes into a new post, or out to another app
    private fun sharePicture(p: LPost, toCompose: Boolean) {
        val colors = if ((resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES && app.store.theme != ThemeMode.Light || app.store.theme == ThemeMode.Dark) DarkColors else LightColors
        Thread {
            val bm = runCatching { PostPic.make(p, app.store.profile, colors) }.getOrNull()
            runOnUiThread {
                if (bm == null) { app.say("Could not make picture"); return@runOnUiThread }
                if (toCompose) {
                    val dir = app.store.mediaDir ?: return@runOnUiThread
                    val f = File(dir, uid() + ".png").apply { outputStream().use { bm.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) } }
                    app.panels.add(Panel.Compose(files = listOf(f.absolutePath)))
                } else {
                    val f = File(File(cacheDir, "share").apply { mkdirs() }, "nook-post.png").apply { outputStream().use { bm.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) } }
                    send(f, "image/png")
                }
            }
        }.start()
    }

    // the web app's update sheet; Update now downloads the new apk and opens Android's installer
    private fun checkUpdate(manual: Boolean) {
        Thread {
            val r = Updater.latest(this)
            runOnUiThread {
                val rel = r.getOrNull()
                when {
                    r.isFailure -> if (manual) app.say("Could not check. Check your connection and try again")
                    rel == null -> if (manual) app.say("Up to date")
                    else -> app.open(listOf(
                        SheetItem("Update now") { getUpdate() },
                        SheetItem("Stay on current version", cancel = true),
                    ), "Update available (" + rel.name + ")")
                }
            }
        }.start()
    }

    private fun getUpdate() {
        app.say("Downloading the update...")
        Thread {
            val f = runCatching { Updater.download(this) }.getOrNull()
            runOnUiThread {
                if (f == null) app.say("Could not download the update. Try again")
                else if (!Updater.install(this, f)) app.say("Allow Nook to install the update, then tap Update now again")
            }
        }.start()
    }

    // Download backup: everything on this phone (the state file and the photos) in one zip, handed to the share sheet
    private fun backup() {
        app.store.save()
        Thread {
            val day = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(java.util.Date())
            val out = File(File(cacheDir, "share").apply { mkdirs() }, "nook-backup-$day.zip")
            runCatching {
                ZipOutputStream(out.outputStream()).use { z ->
                    File(filesDir, "state.json").takeIf { it.exists() }?.let { z.putNextEntry(ZipEntry("nook.json")); it.inputStream().use { s -> s.copyTo(z) }; z.closeEntry() }
                    app.store.mediaDir?.listFiles()?.forEach { f -> z.putNextEntry(ZipEntry("media/" + f.name)); f.inputStream().use { s -> s.copyTo(z) }; z.closeEntry() }
                }
            }.onSuccess { runOnUiThread { send(out, "application/zip") } }.onFailure { runOnUiThread { app.say("Could not make the backup") } }
        }.start()
    }

    private fun send(f: File, type: String) {
        val uri = FileProvider.getUriForFile(this, "$packageName.files", f)
        val i = Intent(Intent.ACTION_SEND).setType(type).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        startActivity(Intent.createChooser(i, null))
    }
}
