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
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class MainActivity : ComponentActivity() {
    private lateinit var app: AppState
    // loads the saved state off the main thread, then builds the app
    private val boot = kotlinx.coroutines.MainScope()
    private var closeRt: Runnable? = null

    // the phone asks once whether Nook may show notifications; a yes turns them on
    private val notifPerm = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        Notify.setOn(this, ok)
        app.say(if (ok) "Phone notifications are on" else "Notifications are blocked. Allow them in your phone settings.")
    }

    // Google's fingerprint window answers here
    private var resultWait: kotlinx.coroutines.CompletableDeferred<androidx.activity.result.ActivityResult>? = null
    private val forResult = registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { r -> resultWait?.complete(r) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        Photos.cacheDir = cacheDir
        Notify.channel(this)
        // the start screen stays until the first page is fully drawn, so the app never shows up in pieces
        var ready = false
        val root = findViewById<android.view.View>(android.R.id.content)
        root.viewTreeObserver.addOnPreDrawListener(object : android.view.ViewTreeObserver.OnPreDrawListener {
            override fun onPreDraw(): Boolean { if (!ready) return false; root.viewTreeObserver.removeOnPreDrawListener(this); return true }
        })
        root.postDelayed({ ready = true; root.invalidate() }, 1500)
        // the cache file and the state file are read and parsed on a background thread
        boot.launch {
            val store = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                Cache.open(File(filesDir, "cache.json"))
                Store.open(this@MainActivity)
            }
            start(store, root) { ready = true }
        }
    }

    private fun start(store: Store, root: android.view.View, show: () -> Unit) {
        app = AppState(store)
        AppState.current = app
        app.ctx = applicationContext
        app.activity = java.lang.ref.WeakReference(this)
        app.startForResult = { pi ->
            val d = kotlinx.coroutines.CompletableDeferred<androidx.activity.result.ActivityResult>()
            resultWait?.cancel(); resultWait = d
            runCatching { forResult.launch(androidx.activity.result.IntentSenderRequest.Builder(pi).build()) }.fold({ d.await() }, { null })
        }
        app.clipboard = { t -> (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Nook", t).apply {
            // private text stays out of the clipboard previews of Android 13 and later
            description.extras = android.os.PersistableBundle().apply { putBoolean("android.content.extra.IS_SENSITIVE", true) }
        }) }
        app.sharePicture = { p, toCompose -> sharePicture(p, toCompose) }
        app.sharePictureTo = { p, done -> picture(p) { f -> f?.let { done(it.absolutePath) } ?: app.say("Could not make picture") } }
        app.backup = { backup() }
        app.checkUpdate = { manual -> checkUpdate(manual) }
        app.askNotifs = { askNotifs() }
        app.shareFile = { f, type -> send(f, type) }
        app.onSignedIn = {
            if (Notify.on(this)) { Notify.schedule(this); app.scope.launch { runCatching { Push.register(this@MainActivity) } } }
            // the first time somebody signs in here, the phone asks about notifications
            val prefs = getSharedPreferences("nook", 0)
            if (!prefs.getBoolean("asked", false)) { prefs.edit().putBoolean("asked", true).apply(); askNotifs() }
        }
        watchNetwork()
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
        setContent {
            NookApp(app)
            androidx.compose.runtime.LaunchedEffect(Unit) {
                // a few frames: the page, its pictures already in memory, and the lists measured
                repeat(3) { androidx.compose.runtime.withFrameNanos { } }
                show(); root.invalidate()
            }
        }
    }

    // the offline page follows the phone's connection: gone when it is back, and a start that failed for lack of it runs again
    private fun watchNetwork() {
        val cm = getSystemService(CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
        fun now() = cm.getNetworkCapabilities(cm.activeNetwork)?.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
        app.online = now()
        fun set(on: Boolean) = runOnUiThread {
            if (on == app.online) return@runOnUiThread
            app.online = on
            if (!on) return@runOnUiThread
            Sb.dropConnections()
            if (app.signedIn) { app.on.feedTries = 0; if (app.on.feedStatus == "error") app.on.loadFeed() }
            if (app.bootOffline) { app.bootOffline = false; app.scope.launch { app.on.boot() } }
        }
        runCatching {
            cm.registerDefaultNetworkCallback(object : android.net.ConnectivityManager.NetworkCallback() {
                override fun onCapabilitiesChanged(n: android.net.Network, caps: android.net.NetworkCapabilities) = set(caps.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_VALIDATED))
                override fun onLost(n: android.net.Network) = set(false)
            })
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // before the app is built, boot picks the intent up
        setIntent(intent)
        if (this::app.isInitialized) app.scope.launch { take(intent) }
    }

    override fun onStart() {
        super.onStart()
        if (!this::app.isInitialized) return
        closeRt?.let { window.decorView.removeCallbacks(it) }
        val was = app.foreground
        app.foreground = true
        if (!was) Sb.dropConnections()
        if (!was && app.signedIn) app.scope.launch {
            app.on.feedTries = 0
            app.on.deviceCheck(); app.on.checkEmailChange()
            app.on.checkBan(); app.on.refreshBadge(true); app.on.checkModNotices(); app.on.notesSync(); app.on.loadFeed()
            if (app.dm.rtChan == null) app.on.startRealtime()
        }
    }

    override fun onStop() {
        super.onStop()
        if (!this::app.isInitialized) return
        app.foreground = false
        app.saveNow()
        Cache.flush()
        // the copies made for sharing (the backup, pictures of posts, the exported data) do not stay on the phone; files
        // from the last minutes are kept, as the app they were handed to may still be reading them
        val share = File(cacheDir, "share")
        Thread {
            app.store.sweepMedia(); Photos.trimCache()
            share.listFiles()?.forEach { if (System.currentTimeMillis() - it.lastModified() > 600_000) it.delete() }
        }.start()
        // a minute in the background closes the live connection (the phone's push messages cover the time away); coming
        // back opens it again
        val r = Runnable { if (!app.foreground) app.on.stopRealtime() }
        closeRt = r
        window.decorView.postDelayed(r, 60_000)
    }

    override fun onDestroy() {
        super.onDestroy()
        boot.cancel()
        if (this::app.isInitialized) { app.scope.cancel(); notesStop(); if (AppState.current === app) AppState.current = null }
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
            if (v == "notifs") app.go(Route.Notifs) else if (v.startsWith("zen:")) app.go(Route.Conv(v.substring(4))) else if (v.startsWith("dm:") && Regex("^[0-9a-f-]{36}$", RegexOption.IGNORE_CASE).matches(v.substring(3))) app.on.openDm(v.substring(3))
            else if (v.startsWith("post:") && Regex("^[0-9a-f-]{36}$", RegexOption.IGNORE_CASE).matches(v.substring(5))) app.on.openNotePost(v.substring(5))
            else if (v.startsWith("user:") && Regex("^[0-9a-f-]{36}$", RegexOption.IGNORE_CASE).matches(v.substring(5))) app.go(Route.User(v.substring(5)))
        }
        val data = i.data
        if (i.action == Intent.ACTION_VIEW && data != null && data.host == "nook-web-app.github.io" && data.path?.startsWith("/reset") == true) {
            setIntent(Intent())
            val frag = android.net.Uri.parse("x://y?" + (data.fragment ?: ""))
            val at = frag.getQueryParameter("access_token"); val rt = frag.getQueryParameter("refresh_token")
            if (frag.getQueryParameter("type") == "recovery" && at != null && rt != null) app.on.takeResetLink(at, rt, data.getQueryParameter("rn") ?: "")
            else if (data.getQueryParameter("rn") == "email" && data.fragment?.contains("error_code=") != true) {
                // the link of an email change: the new email is confirmed, and the login is renewed so it shows
                app.say("Your new email is confirmed")
                Sb.session?.let { x -> Sb.useSession(Session(x.access, x.refresh, 0, x.user)) }
                app.scope.launch { Sb.token() }
            }
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
        // like the web app, the card of the first link is waited for at most 4.5 s
        val link = if (p.imgs.isEmpty()) firstUrl(cleanText(p.text)) else null
        app.scope.launch {
            val pv = link?.let { kotlinx.coroutines.withTimeoutOrNull(4500) { runCatching { app.on.getPreview(it) }.getOrNull() } }
            Thread {
            val bm = runCatching { PostPic.make(p, app.store.profile, colors, zp, pv) }.getOrNull()
            val f = bm?.let { b -> runCatching { File(File(cacheDir, "share").apply { mkdirs() }, "nook-post-" + uid() + ".png").apply { outputStream().use { b.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) } } }.getOrNull() }
            runOnUiThread { done(f) }
            }.start()
        }
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
                    // every update installs by itself when the phone lets Nook install apps (a check made by hand says so while it downloads)
                    Updater.mayInstall(this) -> getUpdate(quiet = !manual)
                    else -> app.open(listOf(
                        SheetItem("Update now") { getUpdate() },
                        SheetItem("Stay on current version", cancel = true),
                    ), "Update available (" + rel.name + ")")
                }
            }
        }.start()
    }

    private fun getUpdate(quiet: Boolean = false) {
        // one bar for both parts: the download fills the first 80 percent, the install the rest
        if (!quiet) { app.updPhase = "Downloading the update"; app.updProgress = 0f }
        Thread {
            // a try that fails (a slow start, a cut line) is made once more before it is called a failure
            var f: File? = null
            for (n in 0 until 2) {
                if (f != null) break
                f = runCatching { Updater.download(this) { p -> if (!quiet) runOnUiThread { app.updProgress = if (p < 0f) -1f else p * 0.8f } } }.getOrNull()
                if (f == null && n == 0) Thread.sleep(1500)
            }
            if (f == null) { runOnUiThread { app.updProgress = null; if (!quiet) app.say("Could not download the update. Try again") }; return@Thread }
            if (!quiet) runOnUiThread { app.updPhase = "Installing the update"; app.updProgress = 0.8f; creepInstall() }
            // the apk is written into the installer on this thread, not on the screen's, so the bar keeps moving meanwhile
            val ok = runCatching { Updater.install(this, f) }.getOrDefault(false)
            if (!ok) runOnUiThread { app.updProgress = null; app.say("Allow Nook to install the update, then tap Update now again") }
        }.start()
    }

    // while the phone installs, the bar keeps moving slowly toward the end over the last 20 percent (the installer's own progress is done as soon as the file is handed over, so it is not used; the app restarts when the install is finished)
    private fun creepInstall() {
        val tick = object : Runnable {
            override fun run() {
                val p = app.updProgress ?: return
                if (app.updPhase != "Installing the update") return
                app.updProgress = minOf(0.99f, p + (0.99f - p) * 0.015f + 0.0003f)
                window.decorView.postDelayed(this, 120)
            }
        }
        window.decorView.postDelayed(tick, 120)
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
