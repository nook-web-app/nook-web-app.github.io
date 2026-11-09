package io.github.nookwebapp.native_ui

import android.content.Context
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

// The phones signed in to an account register themselves (name and last use), so the account info page can list them and sign
// one out. Signing a phone out marks its row; that phone sees the mark when it opens and signs out by itself.
object Dev {
    // one random id per install, kept in the app's own storage
    fun id(ctx: Context): String {
        val sp = ctx.getSharedPreferences("nook_device", Context.MODE_PRIVATE)
        return sp.getString("id", null) ?: java.util.UUID.randomUUID().toString().also { sp.edit().putString("id", it).apply() }
    }
    // the exact phone, like "Samsung SM-S911B" (the maker is only added when the model does not already start with it)
    fun name(): String {
        val maker = android.os.Build.MANUFACTURER.orEmpty().replaceFirstChar { it.uppercase() }
        val model = android.os.Build.MODEL.orEmpty()
        return (if (model.startsWith(maker, true)) model else "$maker $model").trim().ifEmpty { "Android phone" }.take(80)
    }
}

// deviceSync(): false when this phone was signed out from another device; otherwise this phone's row is written (or kept up to date)
suspend fun Online.deviceSync(): Boolean {
    val me = uid ?: return true
    val ctx = app.ctx ?: return true
    val did = Dev.id(ctx)
    val r = Sb.get(Q("devices").select("id, revoked").eq("user_id", me).eq("device_id", did))
    // a missing table or no connection never signs anybody out
    if (!r.ok) return true
    val row = r.one
    if (row != null && row.optBoolean("revoked")) { Sb.delete(Q("devices").eq("id", row.optString("id"))); return false }
    Sb.upsert("devices", JSONObject().put("user_id", me).put("device_id", did).put("name", Dev.name()).put("platform", "android").put("last_seen", isoNow()), "user_id,device_id")
    return true
}

// the check at every start and every return to the app
fun Online.deviceCheck() {
    app.scope.launch {
        if (!deviceSync()) { app.say("This phone was signed out from another device"); signOutNow() }
    }
}

// a pending email change: the link in the mail confirms it on the server, so the app asks now and then until the new email shows
fun Online.watchEmailChange(email: String) {
    Cache.write("pending-email", email.trim().lowercase())
    app.scope.launch { repeat(72) { delay(5000); if (!checkEmailChange()) return@launch } }
}

// true while a change is still waited for
suspend fun Online.checkEmailChange(): Boolean {
    val want = (Cache.read("pending-email")?.v as? String)?.takeIf { it.isNotEmpty() } ?: return false
    val u = Sb.me() ?: return true
    val now = u.optString("email").lowercase()
    if (now == want) {
        Cache.write("pending-email", "")
        app.say("Your email is now $want")
        return false
    }
    return true
}
