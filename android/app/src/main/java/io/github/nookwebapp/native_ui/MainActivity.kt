package io.github.nookwebapp.native_ui

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class MainActivity : ComponentActivity() {
    private lateinit var app: AppState

    // the phone asks once whether Nook may show notifications; a yes turns them on
    private val notifPerm = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        Notify.setOn(this, ok)
        app.say(if (ok) "Phone notifications are on" else "Notifications are blocked. Allow them in your phone settings.")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        Photos.cacheDir = cacheDir
        Cache.open(File(filesDir, "cache.json"))
        Notify.channel(this)
        app = AppState(Store.open(this))
        AppState.current = app
        app.ctx = applicationContext
        app.activity = java.lang.ref.WeakReference(this)
        app.clipboard = { t -> (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Nook", t)) }
        app.sharePicture = { p, toCompose -> sharePicture(p, toCompose) }
        app.sharePictureTo = { p, done -> picture(p) { f -> f?.let { done(it.absolutePath) } ?: app.say("Could not make picture") } }
        app.backup = { backup() }
        app.checkUpdate = { manual -> checkUpdate(manual) }
        app.askNotifs = { askNotifs() }
        app.shareFile = { f, type -> send(f, type) }
        app.onSignedIn = {
            if (Notify.on(this)) Notify.schedule(this)
            // the first time somebody signs in here, the phone asks about notifications
            val prefs = getSharedPreferences("nook", 0)
            if (!prefs.getBoolean("asked", false)) { prefs.edit().putBoolean("asked", true).apply(); askNotifs() }
        }
        app.on.wireSession()
        app.scope.launch { app.on.boot(); take(intent) }
        // a new version is looked for a moment after the app opens
        window.decorView.postDelayed({ checkUpdate(false) }, 3000)
        app.scope.launch {
            var n = 0
            while (true) {
                delay(15_000); n++
                Cache.flush()
                if (!app.foreground) continue
                // whether somebody is banned is only ever decided by the server: asked every minute while the app is open
                if (n % 4 == 0) app.on.checkBan()
                if (n % 3 == 0) app.on.retryUnsent()
            }
        }
        setContent { NookApp(app) }
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); app.scope.launch { take(intent) } }

    override fun onStart() {
        super.onStart()
        if (!this::app.isInitialized) return
        val was = app.foreground
        app.foreground = true
        if (!was && app.signedIn) app.scope.launch {
            app.on.checkBan(); app.on.refreshBadge(true); app.on.checkModNotices(); app.on.notesSync(); app.on.loadFeed()
            if (app.dm.rtChan == null) app.on.startRealtime()
        }
    }

    override fun onStop() {
        super.onStop()
        app.foreground = false
        app.store.save()
        Cache.flush()
        Thread { app.store.sweepMedia(); Photos.trimCache() }.start()
    }

    private fun askNotifs() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) notifPerm.launch(Manifest.permission.POST_NOTIFICATIONS)
        else if (Notify.allowed(this)) { if (!Notify.on(this)) { Notify.setOn(this, true); app.say("Phone notifications are on") } }
        else {
            app.say("Notifications are blocked. Allow them in your phone settings.")
            runCatching { startActivity(Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, packageName)) }
        }
    }

    // what opened the app: a notification, the link of a reset email, or something shared from another app
    private suspend fun take(i: Intent?) {
        if (i == null) return
        i.getStringExtra("open")?.let { v ->
            i.removeExtra("open")
            if (!app.signedIn) return@let
            if (v == "notifs") app.go(Route.Notifs) else if (v.startsWith("dm:") && Regex("^[0-9a-f-]{36}$", RegexOption.IGNORE_CASE).matches(v.substring(3))) app.on.openDm(v.substring(3))
        }
        val data = i.data
        if (i.action == Intent.ACTION_VIEW && data != null && data.host == "nook-web-app.github.io" && data.path?.startsWith("/reset") == true) {
            setIntent(Intent())
            val frag = android.net.Uri.parse("x://y?" + (data.fragment ?: ""))
            val at = frag.getQueryParameter("access_token"); val rt = frag.getQueryParameter("refresh_token")
            if (frag.getQueryParameter("type") == "recovery" && at != null && rt != null) app.on.takeResetLink(at, rt, data.getQueryParameter("rn") ?: "")
            else if (data.fragment?.contains("error_code=") == true) app.say("That link did not work. Ask for a new one.")
            return
        }
        if (i.action == Intent.ACTION_SEND || i.action == Intent.ACTION_SEND_MULTIPLE) takeShared(i)
    }

    // something shared to Nook from another app (the web app's share target): a post, or a message
    private fun takeShared(i: Intent) {
        val dir = app.store.mediaDir ?: return
        val text = cleanText(listOfNotNull(i.getStringExtra(Intent.EXTRA_SUBJECT), i.getStringExtra(Intent.EXTRA_TEXT)).joinToString("\n").trim())
        @Suppress("DEPRECATION")
        val uris = if (i.action == Intent.ACTION_SEND_MULTIPLE) i.getParcelableArrayListExtra<android.net.Uri>(Intent.EXTRA_STREAM).orEmpty()
        else listOfNotNull(i.getParcelableExtra<android.net.Uri>(Intent.EXTRA_STREAM))
        setIntent(Intent())
        if (!app.signedIn) { app.say("Sign in first"); return }
        app.scope.launch {
            val files = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { uris.take(4).mapNotNull { Photos.intake(this@MainActivity, dir, it) } }
            if (text.isEmpty() && files.isEmpty()) return@launch
            val targets = runCatching { app.on.messageTargets() }.getOrDefault(emptyList())
            val compose = { if (app.canPost()) app.panels.add(Panel.Compose(files = files, text = text)) }
            if (targets.isEmpty()) { compose(); return@launch }
            app.open(listOf(
                SheetItem("Post", "edit") { compose() },
                SheetItem("Message", "chat") {
                    app.on.chooseTarget(targets) { t ->
                        app.scope.launch {
                            if (t.note) {
                                val chat = app.store.chats.firstOrNull { it.id == t.id } ?: return@launch
                                if (text.isNotEmpty()) chat.msgs.add(LMsg(uid(), text, System.currentTimeMillis(), emptyList()))
                                files.forEach { chat.msgs.add(LMsg(uid(), "", System.currentTimeMillis(), listOf(it))) }
                                app.persist(); app.say("Saved in " + t.name)
                            } else try {
                                if (text.isNotEmpty()) { firstUrl(text)?.let { u -> kotlinx.coroutines.withTimeoutOrNull(4500) { app.on.getPreview(u) } }; app.on.sendDm(t.id, text) }
                                files.forEach { app.on.sendDm(t.id, "", listOf(it)) }
                                app.say("Sent to " + t.name)
                            } catch (e: Exception) { app.say("Could not send") }
                        }
                    }
                },
                SheetItem("Cancel", cancel = true)), "Share to")
        }
    }

    private fun colors() = if ((resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES && app.store.theme != ThemeMode.Light || app.store.theme == ThemeMode.Dark) DarkColors else LightColors

    // the picture of a post (postPic), saved as a file
    private fun picture(p: LPost, done: (File?) -> Unit) {
        val colors = colors()
        val zp = app.store.zen.optStr("pfp")
        Thread {
            val bm = runCatching { PostPic.make(p, app.store.profile, colors, zp) }.getOrNull()
            val f = bm?.let { b -> runCatching { File(File(cacheDir, "share").apply { mkdirs() }, "nook-post-" + uid() + ".png").apply { outputStream().use { b.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) } } }.getOrNull() }
            runOnUiThread { done(f) }
        }.start()
    }

    // Share post: the picture of the post goes into a new post, or out to another app
    private fun sharePicture(p: LPost, toCompose: Boolean) {
        picture(p) { f ->
            if (f == null) { app.say("Could not make picture"); return@picture }
            if (toCompose) {
                val dir = app.store.mediaDir ?: return@picture
                val keep = File(dir, uid() + ".png").also { f.copyTo(it, true) }
                if (app.canPost()) app.panels.add(Panel.Compose(files = listOf(keep.absolutePath)))
            } else send(f, "image/png")
        }
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
        app.say("Preparing backup...")
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
