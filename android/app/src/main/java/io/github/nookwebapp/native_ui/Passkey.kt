package io.github.nookwebapp.native_ui

import android.app.Activity
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import androidx.credentials.exceptions.publickeycredential.CreatePublicKeyCredentialDomException
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

// Fingerprint sign in (the web app's passkeys). Google's own passkey window (Play services) asks for the fingerprint and
// signs with the key Google Password Manager keeps, the same key the web app made in Chrome; another password manager
// (Samsung Pass) is never asked first. Only when Google's window cannot be used does Android's Credential Manager ask.
// The keys belong to the site (nook-web-app.github.io); the site's assetlinks.json lets this app use them, and the
// passkey function accepts this app's signature as the origin next to the site's.
object Passkey {
    const val RP_ID = "nook-web-app.github.io"

    // passkeys need Android 9 or later
    fun ok() = android.os.Build.VERSION.SDK_INT >= 28

    private fun b64u(b: ByteArray) = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(b)

    // pkChallenge(): 32 random bytes with the time (milliseconds, as a big endian double) in bytes 16 to 23; the server takes
    // a fresh one once, so nothing has to be asked from it before the fingerprint window opens
    fun challenge(): String {
        val b = ByteArray(32).also { java.security.SecureRandom().nextBytes(it) }
        java.nio.ByteBuffer.wrap(b).putDouble(16, System.currentTimeMillis().toDouble())
        return b64u(b)
    }

    // "Android phone Oct 29", like pkName()
    fun name() = "Android phone " + java.text.SimpleDateFormat("MMM d", java.util.Locale.US).format(java.util.Date())

    sealed class Got { class Ok(val json: JSONObject) : Got(); class No(val msg: String) : Got() }

    private fun unb64u(s: String) = java.util.Base64.getUrlDecoder().decode(s.trimEnd('='))
    private suspend fun <T> com.google.android.gms.tasks.Task<T>.wait(): T = kotlinx.coroutines.suspendCancellableCoroutine { c ->
        addOnSuccessListener { c.resumeWith(Result.success(it)) }; addOnFailureListener { c.resumeWith(Result.failure(it)) }
    }

    // Google's window: the credential it answered with, Got.No("") when the person closed it, or null when it could not
    // be used at all (then Credential Manager is asked instead)
    private suspend fun google(app: AppState, pi: suspend (com.google.android.gms.fido.fido2.Fido2ApiClient) -> android.app.PendingIntent): Pair<com.google.android.gms.fido.fido2.api.common.PublicKeyCredential?, Got.No?>? {
        val a = app.activity?.get() ?: return null
        val start = app.startForResult ?: return null
        return try {
            val r = start(pi(com.google.android.gms.fido.Fido.getFido2ApiClient(a))) ?: return null
            if (r.resultCode != Activity.RESULT_OK) return null to Got.No("")
            val bytes = r.data?.getByteArrayExtra(com.google.android.gms.fido.Fido.FIDO2_KEY_CREDENTIAL_EXTRA) ?: return null
            val c = com.google.android.gms.fido.fido2.api.common.PublicKeyCredential.deserializeFromBytes(bytes)
            val resp = c.response
            if (resp is com.google.android.gms.fido.fido2.api.common.AuthenticatorErrorResponse) {
                // closing the window, or no key of this site in Google Password Manager
                if (resp.errorCode.name == "NOT_ALLOWED_ERR") return null to Got.No("")
                return null
            }
            c to null
        } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { null }
    }

    suspend fun askGoogle(app: AppState): Got? {
        val opts = com.google.android.gms.fido.fido2.api.common.PublicKeyCredentialRequestOptions.Builder()
            .setChallenge(unb64u(challenge())).setRpId(RP_ID).setTimeoutSeconds(60.0).setAllowList(emptyList()).build()
        val res = google(app) { it.getSignPendingIntent(opts).wait() } ?: return null
        res.second?.let { return it }
        val c = res.first!!
        val a = c.response as com.google.android.gms.fido.fido2.api.common.AuthenticatorAssertionResponse
        val resp = JSONObject().put("clientDataJSON", b64u(a.clientDataJSON)).put("authenticatorData", b64u(a.authenticatorData)).put("signature", b64u(a.signature))
        a.userHandle?.let { resp.put("userHandle", b64u(it)) }
        return Got.Ok(JSONObject().put("id", b64u(c.rawId)).put("rawId", b64u(c.rawId)).put("type", "public-key").put("authenticatorAttachment", c.authenticatorAttachment ?: "platform")
            .put("clientExtensionResults", JSONObject()).put("response", resp))
    }

    suspend fun createGoogle(app: AppState, o: JSONObject): Got? {
        val g = com.google.android.gms.fido.fido2.api.common.PublicKeyCredentialCreationOptions.Builder()
            .setRp(com.google.android.gms.fido.fido2.api.common.PublicKeyCredentialRpEntity(o.getJSONObject("rp").optString("id", RP_ID), o.getJSONObject("rp").optString("name", "Nook"), null))
            .setUser(com.google.android.gms.fido.fido2.api.common.PublicKeyCredentialUserEntity(unb64u(o.getJSONObject("user").getString("id")), o.getJSONObject("user").optString("name"), "", o.getJSONObject("user").optString("displayName")))
            .setChallenge(unb64u(o.getString("challenge")))
            .setParameters(o.optJSONArray("pubKeyCredParams").objs().map { com.google.android.gms.fido.fido2.api.common.PublicKeyCredentialParameters("public-key", it.optInt("alg")) })
            .setTimeoutSeconds(60.0)
            .setExcludeList(o.optJSONArray("excludeCredentials")?.objs()?.map { com.google.android.gms.fido.fido2.api.common.PublicKeyCredentialDescriptor("public-key", unb64u(it.getString("id")), null) } ?: emptyList())
            .setAuthenticatorSelection(com.google.android.gms.fido.fido2.api.common.AuthenticatorSelectionCriteria.Builder()
                .setAttachment(com.google.android.gms.fido.fido2.api.common.Attachment.PLATFORM)
                .setResidentKeyRequirement(com.google.android.gms.fido.fido2.api.common.ResidentKeyRequirement.RESIDENT_KEY_REQUIRED).build())
            .setAttestationConveyancePreference(com.google.android.gms.fido.fido2.api.common.AttestationConveyancePreference.NONE)
            .build()
        val res = google(app) { it.getRegisterPendingIntent(g).wait() } ?: return null
        res.second?.let { return it }
        val c = res.first!!
        val a = c.response as com.google.android.gms.fido.fido2.api.common.AuthenticatorAttestationResponse
        val resp = JSONObject().put("clientDataJSON", b64u(a.clientDataJSON)).put("attestationObject", b64u(a.attestationObject)).put("transports", JSONArray(a.transports?.toList() ?: listOf("internal", "hybrid")))
        return Got.Ok(JSONObject().put("id", b64u(c.rawId)).put("rawId", b64u(c.rawId)).put("type", "public-key").put("authenticatorAttachment", c.authenticatorAttachment ?: "platform")
            .put("clientExtensionResults", JSONObject()).put("response", resp))
    }

    // passkeyAsk() up to the phone's answer: the signed response, or a short text ("" when the person just cancelled)
    suspend fun ask(a: Activity): Got {
        if (!ok()) return Got.No("This phone cannot do that")
        val opts = JSONObject().put("challenge", challenge()).put("rpId", RP_ID).put("timeout", 60000).put("userVerification", "required").put("allowCredentials", JSONArray())
        return try {
            val r = CredentialManager.create(a).getCredential(a, GetCredentialRequest(listOf(GetPublicKeyCredentialOption(opts.toString()))))
            val c = r.credential as? PublicKeyCredential ?: return Got.No("Could not use the fingerprint here")
            Got.Ok(JSONObject(c.authenticationResponseJson))
        } catch (e: GetCredentialCancellationException) { Got.No("") }
        catch (e: NoCredentialException) { Got.No("No fingerprint key is saved on this phone. Sign in with your password and add it in Settings") }
        catch (e: Exception) { Got.No("Could not use the fingerprint here") }
    }

    // passkeyAdd() on the phone's side: the registration options from reg-start go to the phone, its answer comes back
    suspend fun create(a: Activity, options: JSONObject): Got {
        if (!ok()) return Got.No("This phone cannot do that")
        return try {
            val r = CredentialManager.create(a).createCredential(a, CreatePublicKeyCredentialRequest(options.toString()))
            val c = r as? CreatePublicKeyCredentialResponse ?: return Got.No("Could not set it up on this phone")
            Got.Ok(JSONObject(c.registrationResponseJson))
        } catch (e: CreateCredentialCancellationException) { Got.No("") }
        catch (e: CreatePublicKeyCredentialDomException) {
            Got.No(if (e.domError is androidx.credentials.exceptions.domerrors.InvalidStateError) "This phone already has a key saved" else "Could not set it up on this phone")
        }
        catch (e: Exception) { Got.No("Could not set it up on this phone") }
    }
}

// pkMsg(): what a refused fingerprint sign in tells the person
fun pkMsg(e: String, d: String = "") = when {
    (e == "server" || e == "failed") && d.isNotEmpty() -> "Could not sign in ($d)"
    e == "banned" -> "That account is banned"
    e == "busy" -> "Too many tries. Wait a minute"
    e == "unknown_key" -> "This phone's key is not saved on any account. Sign in with your password and set it up again"
    else -> "Could not sign in with that. Try again"
}

private var pkWarmAt = 0L
// passkeyWarm(): the sign in page wakes the passkey function up, so the real sign in does not wait for a cold start
fun Online.passkeyWarm() {
    if (!Passkey.ok() || System.currentTimeMillis() - pkWarmAt < 120_000) return
    pkWarmAt = System.currentTimeMillis()
    app.scope.launch { Sb.fn("passkey", JSONObject().put("action", "ping")) }
}

// the fingerprint is asked for and the server checks it: a session (access, refresh), or what went wrong
// ("" when the person cancelled; "banned" when the account is banned)
suspend fun Online.passkeySession(): Pair<Pair<String, String>?, String> {
    val a = app.activity?.get() ?: return null to "Could not use the fingerprint here"
    val got = Passkey.askGoogle(app) ?: Passkey.ask(a)
    if (got is Passkey.Got.No) return null to got.msg
    val resp = (got as Passkey.Got.Ok).json
    val f = Sb.fn("passkey", JSONObject().put("action", "auth-finish").put("response", resp))
    val ss = f.body.optJSONObject("session")
    if (!f.ok || ss == null) return null to if (f.body.optString("error") == "banned") "banned" else if (f.status == 0) "Could not reach Nook. Check your connection" else pkMsg(f.body.optString("error"), f.body.optString("detail"))
    return (ss.optString("access_token") to ss.optString("refresh_token")) to ""
}

// the sign in page's "Sign in with Fingerprint"
suspend fun Online.signInPasskey(): String? {
    val (ss, err) = passkeySession()
    if (ss == null) { if (err == "banned") { showBanned(null); return null }; return err }
    Sb.takeSession(ss.first, ss.second) ?: return "Could not sign in. Try again"
    me = Sb.user
    app.banEmail = ""
    // an account that was deactivated or deleted less than 30 days ago comes back, like with a password
    kotlinx.coroutines.withTimeoutOrNull(8000) {
        kotlinx.coroutines.coroutineScope {
            val x = async { Sb.rpc("nook_restore_account") }
            val y = async { Sb.rpc("set_my_deactivated", JSONObject().put("flag", false)) }
            x.await(); y.await()
        }
    }
    restart()
    return null
}

// Add account with the fingerprint: another account goes into the list, the open one stays open
suspend fun Online.addAccountPasskey(): String? {
    val cur = Sb.user ?: return "Sign in first"
    val (ss, err) = passkeySession()
    if (ss == null) return if (err == "banned") "That account is banned" else err
    val id = jwtSub(ss.first) ?: return "Could not sign in. Try again"
    if (id == cur.id) return "That is the account you are in"
    val info = infoForSession(ss.first, id)
    if (info == null || info.optString("username").isEmpty()) return "Could not load that account. Try again"
    val l = acctList().filter { it.id != id }.toMutableList()
    l.add(SavedAcct(id, ss.second, info.optString("username"), info.optString("display_name").ifEmpty { info.optString("username") }, info.optStr("avatar")?.takeIf { it.length < 400_000 }, false))
    putList(l)
    app.scope.launch { runCatching { linkSavedAccounts(id, ss.first) } }
    return null
}

// a linked account opened with the fingerprint instead of its password
suspend fun Online.linkedLoginPasskey(x: SavedAcct): String? {
    val (ss, err) = passkeySession()
    if (ss == null) return if (err == "banned") "That account is banned" else err
    if (jwtSub(ss.first) != x.id) return "That key belongs to a different account"
    val l = acctList().filter { it.id != x.id }.toMutableList()
    l.add(SavedAcct(x.id, ss.second, x.username, x.name, x.avatar, false)); putList(l)
    switchAccount(x.id)
    return null
}

// the keys saved on this account: [{ id, name }], or null when they could not be read
suspend fun Online.passkeys(): List<JSONObject>? {
    val r = Sb.get(Q("passkeys").select("id, name").order("created_at"))
    return if (r.ok) r.rows else null
}

// passkeyAdd(): this phone's fingerprint becomes a way to sign in to this account
suspend fun Online.passkeyAdd(): Boolean {
    val a = app.activity?.get() ?: return false
    val r = Sb.fn("passkey", JSONObject().put("action", "reg-start"))
    if (!r.ok) { app.say(if (r.body.optString("error") == "too_many") "You can save up to 5 keys. Remove one first" else "Could not start. Try again"); return false }
    val got = Passkey.createGoogle(app, r.body) ?: Passkey.create(a, r.body)
    if (got is Passkey.Got.No) { if (got.msg.isNotEmpty()) app.say(got.msg); return false }
    val resp = (got as Passkey.Got.Ok).json
    val f = Sb.fn("passkey", JSONObject().put("action", "reg-finish").put("response", resp).put("name", Passkey.name()))
    if (!f.ok) { app.say(if (f.body.optString("error") == "already") "That key is already saved" else "Could not save the key. Try again"); return false }
    return true
}

