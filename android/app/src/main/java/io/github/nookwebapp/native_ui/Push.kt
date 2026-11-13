package io.github.nookwebapp.native_ui

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONObject
import java.io.File

// Phone notifications through Firebase Cloud Messaging, the same push channel Google's own apps use: Android keeps one
// shared connection for all apps, so Nook adds almost no battery use and a message arrives at once, even when the app is
// closed. The Firebase project is set up here in code (these ids are public identifiers, not secrets).
object Push {
    private const val APP_ID = "1:418212626378:android:e102b456d1e0f3520cd933"
    private const val API_KEY = "AIzaSyA4RDGGHJ38H9ixqpQCRVBwQsxwx2O1e1c"
    private const val PROJECT = "nook-app-push"
    private const val SENDER = "418212626378"

    fun init(ctx: Context) {
        if (FirebaseApp.getApps(ctx).isNotEmpty()) return
        runCatching { FirebaseApp.initializeApp(ctx, FirebaseOptions.Builder().setApplicationId(APP_ID).setApiKey(API_KEY).setProjectId(PROJECT).setGcmSenderId(SENDER).build()) }
    }

    private suspend fun <T> com.google.android.gms.tasks.Task<T>.wait(): T = suspendCancellableCoroutine { c ->
        addOnSuccessListener { c.resumeWith(Result.success(it)) }; addOnFailureListener { c.resumeWith(Result.failure(it)) }
    }

    fun loadSession(ctx: Context) {
        if (Sb.session != null) return
        Sb.session = Vault.read(File(ctx.filesDir, "sb.bin"))?.let { runCatching { Session.of(JSONObject(it)) }.getOrNull() }
        if (!Sb.wired) Sb.onSession = { ss -> Vault.write(File(ctx.filesDir, "sb.bin"), ss?.json()?.toString()) }
    }

    // this phone's token goes to the server for the account that is signed in (again when Google gives a new one)
    suspend fun register(ctx: Context) {
        if (!Notify.on(ctx) || !Notify.allowed(ctx)) return
        init(ctx)
        loadSession(ctx)
        if (Sb.session == null) return
        val t = runCatching { FirebaseMessaging.getInstance().token.wait() }.getOrNull() ?: return
        val r = Sb.rpc("nook_register_fcm", JSONObject().put("p_token", t))
        if (r.ok) ctx.getSharedPreferences("nook", 0).edit().putString("fcm", t).apply()
    }

    // the account leaves this phone: its token is removed from the server
    suspend fun detach(ctx: Context) {
        val t = ctx.getSharedPreferences("nook", 0).getString("fcm", null) ?: return
        loadSession(ctx)
        if (Sb.delete(Q("fcm_tokens").eq("token", t)).ok) ctx.getSharedPreferences("nook", 0).edit().remove("fcm").apply()
    }
}

class PushService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        val ctx = applicationContext
        kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.IO).launch { runCatching { Push.register(ctx) } }
    }

    // a notification arrives as data only; the phone shows it (not while the app is open, where the live connection tells)
    override fun onMessageReceived(m: RemoteMessage) {
        val d = m.data
        // a call comes in about two minutes: only said when this app is behind the newest one
        if (d["type"] == "precall") {
            val ctx = applicationContext
            kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.IO).launch {
                if (Updater.latest(ctx).getOrNull() != null) runCatching { Notify.show(ctx, "Update Nook now", "Zenith calls in about 2 minutes. Open Nook to update first.", "update") }
            }
            return
        }
        // Zenith is calling: it rings, also when the app is open
        if (d["type"] == "call") {
            val ctx = applicationContext
            val reason = d["reason"].orEmpty()
            IncomingCall.show(ctx, reason)
            val app = AppState.current
            if (app != null) {
                // the call is made ready right away; the ring screen opens by itself when the app is in front
                android.os.Handler(android.os.Looper.getMainLooper()).post {
                    app.prewarmCall(reason)
                    if (app.foreground) runCatching { ctx.startActivity(android.content.Intent(ctx, IncomingCallActivity::class.java).putExtra("reason", reason).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)) } else openRingOver(ctx, reason)
                }
            } else {
                kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.IO).launch { runCatching { Push.loadSession(ctx); CallWarm.prefetch() } }
                openRingOver(ctx, reason)
            }
            return
        }
        val id = d["id"].orEmpty()
        if (id.isNotEmpty() && id in Notify.seen(applicationContext)) return
        if (AppState.current?.foreground == true) return
        val kind = d["open"].orEmpty()
        if (!Notify.on(applicationContext)) return
        Notify.show(applicationContext, d["title"].orEmpty().ifEmpty { "Nook" }, d["body"].orEmpty(), kind.ifEmpty { "notifs" }, id.hashCode())
        if (id.isNotEmpty()) Notify.markSeen(applicationContext, listOf(id))
    }
}
