package io.github.nookwebapp.native_ui

import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

// Signing in and out, the accounts kept on this phone, and the checks that run when the app opens (boot() in app.js):
// a banned account sees the banned page, an account held for the age check sees the age question, a deactivated or
// missing account is signed out, and data on this phone that belongs to another account is swapped for its own.

// one saved account: its login (the refresh token), how it looks in the list, and whether it is the main one
class SavedAcct(val id: String, var rt: String, var username: String, var name: String, var avatar: String?, var main: Boolean) {
    fun json(): JSONObject = JSONObject().put("id", id).put("rt", rt).put("username", username).put("name", name).put("avatar", avatar ?: JSONObject.NULL).put("main", main)
    companion object { fun of(j: JSONObject) = SavedAcct(j.optString("id"), j.optString("rt"), j.optString("username"), j.optString("name"), j.optStr("avatar"), j.optBoolean("main")) }
}

private fun Online.dir(): File? = s.filesDir
private fun Online.sessionFile() = dir()?.let { File(it, "sb.bin") }
private fun Online.listFile() = dir()?.let { File(it, "accounts.bin") }
private fun Online.snapFile(id: String) = dir()?.let { File(File(it, "snaps").apply { mkdirs() }, "$id.json") }

fun Online.acctList(): MutableList<SavedAcct> = listFile()?.let { Vault.read(it) }?.let { t -> runCatching { JSONArray(t).objs().map { SavedAcct.of(it) }.toMutableList() }.getOrNull() } ?: mutableListOf()
fun Online.putList(l: List<SavedAcct>) { listFile()?.let { Vault.write(it, JSONArray(l.map { it.json() }).toString()) } }
fun mainAccountId(l: List<SavedAcct>) = (l.firstOrNull { it.main } ?: l.firstOrNull())?.id

// the login is saved sealed on this phone every time it changes, and handed to the live connection
fun Online.wireSession() {
    Sb.wired = true
    Sb.onSession = { ss ->
        sessionFile()?.let { Vault.write(it, ss?.json()?.toString()) }
        if (ss != null) {
            Rt.token(ss.access)
            // the saved account list keeps the newest login of the open account
            val l = acctList(); l.firstOrNull { it.id == ss.user.id }?.let { if (it.rt != ss.refresh) { it.rt = ss.refresh; putList(l) } }
        }
    }
    Sb.onSignedOut = { app.scope.launch { if (me != null && !switching) restart() } }
    Sb.session = sessionFile()?.let { Vault.read(it) }?.let { t -> runCatching { Session.of(JSONObject(t)) }.getOrNull() }
    me = Sb.user
}

// rememberAccount(): this account and its current login go into the list of accounts on this phone
fun Online.rememberAccount(username: String? = null, name: String? = null, avatar: String? = null) {
    val ss = Sb.session ?: return
    val l = acctList()
    val old = l.firstOrNull { it.id == ss.user.id }
    val av = avatar?.takeIf { it.length < 400_000 && !it.startsWith("/") } ?: old?.avatar
    val e = SavedAcct(ss.user.id, ss.refresh, username ?: old?.username ?: "", name ?: old?.name ?: "", av, old?.main == true || (old == null && l.isEmpty()))
    val at = l.indexOfFirst { it.id == ss.user.id }
    if (at >= 0) l[at] = e else l.add(e)
    putList(l)
}

fun Online.forgetAccount(id: String, keepSnap: Boolean = false) {
    putList(acctList().filter { it.id != id })
    if (!keepSnap) snapFile(id)?.delete()
}
fun Online.saveSnap(id: String) { snapFile(id)?.writeText(s.toJson().toString()) }

// "a page reload": everything this account had open is let go and the checks of boot() run again for whoever is signed in
var switching = false
suspend fun Online.restart() {
    Rt.removeAll()
    Cache.clearMem()
    acctCache.clear(); nickMap.clear(); clearMap.clear()
    follows = emptySet(); unreadN = 0; unreadPeople = 0; feedStatus = "loading"
    dmReset()
    me = Sb.user
    app.root(if (me == null) Route.Auth else Route.Home)
    boot()
    if (me != null) deviceCheck()
}

// boot(): what happens when the app opens with a login saved
suspend fun Online.boot() {
    val u = Sb.user
    if (u == null) { s.signedIn = false; if (app.top != Route.Auth && app.top !is Route.Legal) app.root(Route.Auth); return }
    me = u
    s.signedIn = true
    // only a real refusal means signed out; a failed call keeps the saved login like a slow answer does
    Sb.token()
    if (Sb.user == null) { me = null; s.signedIn = false; app.root(Route.Auth); return }
    val okKey = "age-ok:" + u.id
    var verified = Cache.read(okKey)?.v == true
    feedEarly = false
    if (verified) { feedEarly = true; loadFeed() }
    val (ban, acct, ageQ) = coroutineScope {
        val a = async { Sb.get(Q("bans").select("user_id").eq("user_id", u.id)) }
        val b = async { Sb.get(Q("accounts").select("id, deactivated, username, avatar, display_name").eq("id", u.id)) }
        val c = async { if (verified) null else Sb.rpc("my_age_verified") }
        Triple(a.await(), b.await(), c.await())
    }
    if (ban.one != null) { showBanned(u.email); return }
    val row = acct.one
    var ageHeld = false
    if (row != null) {
        if (!verified && ageQ != null && ageQ.ok && ageQ.data == true) { verified = true; Cache.write(okKey, true) }
        if (!verified) { val h = Sb.rpc("my_age_hold"); ageHeld = !h.ok || h.data == true }
    } else if (!acct.ok) {
        // no connection is not an age hold: the offline page is shown, and the start is made again when the connection is back
        val noNet = !app.online || acct.error?.status == 0
        // when the account could not be read at all, only a phone that already passed the age check is let through
        ageHeld = !verified && !noNet
        if (noNet) { app.bootOffline = true; if (!verified) return }
    }
    if (acct.ok && (row == null || row.optBoolean("deactivated"))) {
        app.notice = if (row != null) "That account is deactivated. Sign in again to bring it back." else "Your account could not be loaded. Sign in again."
        Sb.signOut(); me = null; s.signedIn = false; app.root(Route.Auth); return
    }
    // what is saved on this phone belongs to the account that used it last
    if (s.localUid != u.id) {
        val snap = snapFile(u.id)?.takeIf { it.exists() }
        when {
            snap != null -> runCatching { s.fromJson(JSONObject(snap.readText())) }
            s.localUid == null && (s.posts.isNotEmpty() || s.chats.isNotEmpty()) -> {
                // data made before the app went online stays on this phone, but is never posted by itself
                s.posts.forEach { if (it.remote == null) it.noRetry = true }
            }
            else -> s.wipe()
        }
        s.localUid = u.id
        s.signedIn = true
        app.persist()
    }
    if (row != null) {
        row.optStr("username")?.let { s.profile.handle = it }
        row.optStr("display_name")?.let { s.profile.name = it }
        row.optStr("avatar")?.let { if (s.profile.avatar == null || !s.profile.avatar!!.startsWith("/")) s.profile.avatar = it }
        rememberAccount(row.optStr("username"), row.optStr("display_name"), row.optStr("avatar"))
    }
    if (ageHeld) { app.root(Route.Age); return }
    if (app.top == Route.Auth || app.top == Route.Banned || app.top == Route.Age) app.root(Route.Home)
    app.notice?.let { if (it.startsWith("Welcome")) { app.say(it); app.notice = null } }
    if (!feedEarly) loadFeed()
    app.scope.launch { loadSocial() }
    app.scope.launch { runCatching { ensureE2E() } }
    startRealtime()
    app.scope.launch { runCatching { warmInbox() } }
    app.scope.launch { checkModNotices() }
    app.scope.launch { delay(5000); runCatching { Stall.send(this@boot) } }
    app.scope.launch { loadPostLock() }
    app.scope.launch { runCatching { zenStart() } }
    notesStart()
    refreshBadge(true)
    app.onSignedIn()
}

// checkBan(): asked again every minute while the app is open and whenever it comes back
suspend fun Online.checkBan() {
    val u = Sb.user ?: return
    if (app.top == Route.Banned) return
    if (Sb.get(Q("bans").select("user_id").eq("user_id", u.id)).one != null) showBanned(u.email)
}

// showBanned(): the login and the data on this phone go; the chat key stays so the backup can still open old messages
fun Online.showBanned(email: String?) {
    if (app.top == Route.Banned) return
    app.banEmail = email ?: Sb.user?.email ?: ""
    app.scope.launch {
        val id = Sb.user?.id
        Rt.removeAll()
        Sb.signOut()
        me = null
        s.wipe()
        // the saved copy of the account, its login entry and the cached copies of its profile and inbox go too
        if (id != null) { forgetAccount(id); Cache.drop { it.contains(id) } }
        app.root(Route.Banned)
    }
}

// ---- messages for what the sign in function answered ----

fun untilText(iso: String?): String {
    val t = parseIso(iso)
    if (t == 0L) return "a bit later"
    val tf = java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT).format(java.util.Date(t))
    val cal = java.util.Calendar.getInstance(); val day = { x: Long -> cal.timeInMillis = x; cal.get(java.util.Calendar.YEAR) * 400 + cal.get(java.util.Calendar.DAY_OF_YEAR) }
    val now = System.currentTimeMillis()
    return when (day(t)) {
        day(now) -> "at $tf"
        day(now + 86_400_000) -> "tomorrow at $tf"
        else -> java.text.SimpleDateFormat("EEE, MMM d", java.util.Locale.getDefault()).format(java.util.Date(t)) + " at " + tf
    }
}
fun lockedMsg(until: String?) = "Too many tries. Try again " + untilText(until)
fun failText(r: Fn?, fallback: String): String {
    val st = r?.status ?: 0
    if (st == 0) return "Could not reach Nook. Check your connection and try again"
    if (st == 401) return "Your session ended. Sign in again"
    if (st == 429) return "Too many tries. Wait a few minutes and try again"
    if (st >= 500) return "Nook is having trouble. Try again in a minute"
    val e = r?.body?.optString("error").orEmpty()
    return if (e.contains(" ") && e.length < 140) e else fallback
}
fun authMsg(code: String, m: String, status: Int = 0): String = when {
    code == "user_already_exists" || code == "email_exists" || Regex("already (been )?registered", RegexOption.IGNORE_CASE).containsMatchIn(m) -> "An account with this email already exists. Sign in instead"
    code == "weak_password" || (m.contains("password", true) && Regex("short|least|weak|characters", RegexOption.IGNORE_CASE).containsMatchIn(m)) -> "That password is too weak. Use 8 or more characters"
    code == "same_password" || m.contains("different from the old", true) -> "Pick a password you are not using now"
    code == "reused_password" || code == "weekly_limit" -> m
    code == "validation_failed" || code == "email_address_invalid" || (m.contains("email", true) && m.contains("valid", true)) -> "That email does not look right. Check for typos"
    code == "over_email_send_rate_limit" || code == "over_request_rate_limit" || status == 429 -> "Too many tries. Wait a few minutes and try again"
    code == "signup_disabled" -> "New accounts are closed for now"
    Regex("network|fetch", RegexOption.IGNORE_CASE).containsMatchIn(m) -> "Could not reach Nook. Check your connection"
    // anything else says what the server said when it is a short plain line
    m.isNotBlank() && m.length < 120 && !m.contains("{") && !m.contains("<") -> m.trim().let { if (it.endsWith(".")) it else "$it." }
    else -> "Something went wrong. Try again"
}
private fun left(b: JSONObject): String { val n = b.optInt("left"); return if (n > 0) " $n" + (if (n == 1) " try" else " tries") + " left before a wait." else "" }
fun signinMsg(r: Fn): String {
    if (r.ok) return ""
    return when (r.body.optString("error")) {
        "locked" -> lockedMsg(r.body.optStr("until"))
        "no_account" -> "Wrong email or password. You can tap Forgot password"
        "wrong_password" -> "Wrong password for this email." + left(r.body) + " You can tap Forgot password"
        "bad_email" -> "That email does not look right. Check for typos"
        "busy" -> "Lots of people are signing in right now. Try again in a minute"
        "not_confirmed" -> "This email is not confirmed yet. Open the link we sent you"
        "no_email" -> "Enter your email"
        "no_password" -> "Enter your password"
        else -> failText(r, "Could not sign in. Try again")
    }
}
fun setpwMsg(r: Fn): String = when (r.body.optString("error")) {
    "wrong_password" -> "Current password is wrong" + left(r.body).let { if (it.isEmpty()) "" else "." + it.removeSuffix(".") }
    "setpw_failed" -> authMsg(r.body.optString("code"), r.body.optString("message"))
    "no_password" -> "Enter your current password"
    "not_signed_in" -> "You are signed out. Sign in again"
    else -> failText(r, "Could not change the password. Try again")
}
fun pwBytes(v: String) = v.toByteArray().size
val EMAIL_RE = Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$")
const val PWNED_MSG = "That password was found in a data leak. Pick another one"

// ---- signing in and making an account (authV) ----

// sign in with email and password; the answer is the line to show, or null when the app went on to the home page
suspend fun Online.signIn(email: String, pw: String): String? {
    val r = Sb.fn("signin", JSONObject().put("email", email).put("password", pw))
    if (r.body.optString("error") == "banned") { showBanned(email); return null }
    if (!r.ok) return signinMsg(r)
    val ss = r.body.optJSONObject("session") ?: return "Could not sign in. Try again"
    Sb.takeSession(ss.optString("access_token"), ss.optString("refresh_token")) ?: return "Could not sign in. Try again"
    me = Sb.user
    app.banEmail = ""
    // an account that was deleted less than 30 days ago comes back here; the typed password opens the saved chat key on a new phone
    withTimeoutOrNull(10_000) {
        coroutineScope {
            val a = async {
                val rr = Sb.rpc("nook_restore_account")
                if (rr.data == true) app.notice = "Welcome back. Your account was restored"
                Sb.rpc("set_my_deactivated", JSONObject().put("flag", false))
            }
            val b = async { runCatching { loginBackup(pw, fast = true) } }
            a.await(); b.await()
        }
    }
    restart()
    return null
}

suspend fun Online.signUp(name: String, user: String, email: String, pw: String): String? {
    if (pwned(pw)) return PWNED_MSG
    // the name of the AI is not for anybody else, in any letter case
    if (user.lowercase() == "zenith") return "That username is taken"
    if (Sb.get(Q("accounts").select("id").eq("username", user)).one != null) return "That username is taken"
    val sr = Sb.fn("signin", JSONObject().put("action", "signup").put("email", email).put("password", pw))
    if (!sr.ok) return if (sr.body.optString("error") == "signup_failed") authMsg(sr.body.optString("code"), sr.body.optString("message"), sr.body.optInt("status")) else signinMsg(sr)
    val ss = sr.body.optJSONObject("session") ?: return "Check your email to confirm, then sign in"
    val got = Sb.takeSession(ss.optString("access_token"), ss.optString("refresh_token")) ?: return "Could not sign in. Try again"
    val ins = Sb.insert("accounts", JSONObject().put("id", got.user.id).put("username", user).put("display_name", name))
    if (!ins.ok) {
        // no half made account is left behind: the login that was just made is removed again
        Sb.fn("delete-account")
        Sb.signOut()
        return if (ins.error?.code == "23505") "That username is taken" else "Could not create the account. " + plainErr(ins.error?.message, "Try again")
    }
    me = Sb.user
    s.wipe(); s.localUid = got.user.id; s.profile.handle = user; s.profile.name = name; s.signedIn = true; app.persist()
    runCatching { loginBackup(pw) }
    delay(400)
    restart()
    return null
}

// ---- leaving ----

// signOutNow(): this phone's login is removed here and now; the server is told on the way out
fun Online.signOutNow() {
    app.scope.launch {
        app.say("Signing out...")
        runCatching { pushDetach() }
        leaveThisAccount(false)
    }
}

// leaveThisAccount(): keep means nothing of it is deleted from the phone (deactivating); its copy waits for the day it signs back in
suspend fun Online.leaveThisAccount(keep: Boolean) {
    val meId = Sb.user?.id ?: return
    if (keep) saveSnap(meId)
    forgetAccount(meId, keep)
    Cache.drop { k -> (!keep && k.contains(meId)) || Regex("^(follows|fl|ids|nicks|clears|inbox|fc|rpt|ui):").containsMatchIn(k) }
    val rest = acctList()
    val next = rest.firstOrNull { it.id == mainAccountId(rest) } ?: rest.firstOrNull()
    Rt.removeAll()
    Sb.signOut()
    me = null
    s.localUid = null; s.wipe()
    if (next != null && enterAccount(next) == "") return
    restart()
}

// enterAccount(): the saved login of another account is used; "" when it opened, else why not ("offline", "busy", "login")
suspend fun Online.enterAccount(e: SavedAcct): String {
    switching = true
    try {
        val (ss, st) = withTimeoutOrNull(12_000) { Sb.refresh(e.rt) } ?: (null to 0)
        if (ss == null) {
            if (st == 429) return "busy"
            if (st !in listOf(400, 401, 403)) return "offline"
            forgetAccount(e.id); return "login"
        }
        val l = acctList(); l.firstOrNull { it.id == e.id }?.rt = ss.refresh; putList(l)
        Rt.removeAll()
        Sb.useSession(ss)
        val snap = snapFile(e.id)?.takeIf { it.exists() }
        if (snap != null) runCatching { s.fromJson(JSONObject(snap.readText())) } else {
            s.wipe(); s.profile.handle = e.username.ifEmpty { s.profile.handle }; s.profile.name = e.name.ifEmpty { e.username }; s.profile.avatar = e.avatar
        }
        s.localUid = e.id; s.signedIn = true; app.persist()
        restart()
        return ""
    } catch (x: Exception) { return "offline" } finally { switching = false }
}

fun Online.switchAccount(id: String) {
    val cur = Sb.user ?: return
    if (id == cur.id || switching) return
    app.scope.launch {
        val target = acctList().firstOrNull { it.id == id } ?: return@launch
        app.say("Switching...")
        Cache.write("prev-acct", cur.id)
        rememberAccount()
        saveSnap(cur.id)
        runCatching { pushDetach() }
        when (enterAccount(target)) {
            "" -> {}
            "offline" -> app.say("No connection. Try again")
            "busy" -> app.say("Too many tries. Try again in a few minutes")
            else -> { app.say("Sign in again to use that account"); app.panels.add(Panel.AddAccount) }
        }
    }
}

// quickSwitch(): a double tap on the profile button goes back to the account used before, taps in a row walk the list
fun Online.quickSwitch() {
    val list = acctList().filter { it.username.isNotEmpty() }
    val cur = Sb.user ?: return
    if (list.size < 2) return
    val chain = (Cache.fresh("quick", 20_000) != null)
    val prev = Cache.read("prev-acct")?.v as? String
    val at = list.indexOfFirst { it.id == cur.id }
    val target = (if (!chain && prev != null && prev != cur.id) list.firstOrNull { it.id == prev } else null) ?: list[(at + 1) % list.size]
    Cache.write("quick", System.currentTimeMillis())
    switchAccount(target.id)
}

// infoForSession(): another account that signs in here may be hidden (deactivated); its own login reads it and brings it back
suspend fun Online.infoForSession(access: String, id: String): JSONObject? {
    val row = Sb.get(Q("accounts").select("id,username,display_name,avatar,deactivated").eq("id", id)).let { if (it.ok) it.one else null }
    // the read above used the open account's login; the other account's own login is used to read and wake itself
    val own = Sb.asUser(access, "GET", "accounts?select=id,username,display_name,avatar,deactivated&id=eq.$id", null).let { (c, t) -> if (c in 200..299) runCatching { JSONArray(t).optJSONObject(0) }.getOrNull() else null } ?: row
    if (own != null && own.optBoolean("deactivated")) {
        Sb.rpc("nook_restore_account", token = access)
        Sb.rpc("set_my_deactivated", JSONObject().put("flag", false), token = access)
    }
    return own
}

// addAccountModal(): another account goes into the list; the open one stays open
suspend fun Online.addAccount(email: String, pw: String): String? {
    val cur = Sb.user ?: return "Sign in first"
    val r = Sb.fn("signin", JSONObject().put("email", email).put("password", pw))
    if (r.body.optString("error") == "banned") return "That account is banned"
    if (!r.ok) return signinMsg(r)
    val ss = r.body.optJSONObject("session") ?: return "Could not sign in. Try again"
    val at = ss.optString("access_token"); val rt = ss.optString("refresh_token")
    val id = jwtSub(at) ?: return "Could not sign in. Try again"
    if (id == cur.id) return "That is the account you are in"
    val info = infoForSession(at, id)
    if (info == null || info.optString("username").isEmpty()) return "Could not load that account. Try again"
    val l = acctList().filter { it.id != id }.toMutableList()
    l.add(SavedAcct(id, rt, info.optString("username"), info.optString("display_name").ifEmpty { info.optString("username") }, info.optStr("avatar")?.takeIf { it.length < 400_000 }, false))
    putList(l)
    app.scope.launch { linkSavedAccounts(id, at) }
    return null
}

suspend fun Online.newAccount(name: String, user: String, email: String, pw: String): String? {
    if (user.lowercase() == "zenith") return "That username is taken"
    if (Sb.get(Q("accounts").select("id").eq("username", user)).one != null) return "That username is taken"
    if (pwned(pw)) return PWNED_MSG
    val sr = Sb.fn("signin", JSONObject().put("action", "signup").put("email", email).put("password", pw))
    if (sr.status == 0) return "Could not reach Nook. Check your connection"
    if (!sr.ok) return if (sr.body.optString("error") == "signup_failed") authMsg(sr.body.optString("code"), sr.body.optString("message"), sr.body.optInt("status")) else signinMsg(sr)
    val ss = sr.body.optJSONObject("session") ?: return "Check your email to confirm, then add it with Add account"
    val at = ss.optString("access_token"); val rt = ss.optString("refresh_token")
    val id = jwtSub(at) ?: return "Could not set it up. Try again"
    // a separate login, so the account that is open keeps its own
    val ins = Sb.asUser(at, "POST", "accounts", JSONObject().put("id", id).put("username", user).put("display_name", name))
    if (ins.first !in 200..299) return if (ins.second.contains("23505")) "That username is taken" else "Could not save the account. Try again"
    // its message key is made now and saved locked with the password, like for any new account
    val keyFail = !runCatching { newAccountKey(id, at, pw) }.getOrDefault(false)
    val l = acctList().filter { it.id != id }.toMutableList()
    l.add(SavedAcct(id, rt, user, name, null, false)); putList(l)
    app.scope.launch { linkSavedAccounts(id, at) }
    return if (keyFail) "Account created. Its message key is set up when you open it" else ""
}

// linkSavedAccounts(): accounts linked to each other; the server remembers it, and every phone then lists them
suspend fun Online.linkSavedAccounts(newId: String, newToken: String?) {
    val mine = Sb.token() ?: return
    val cur = Sb.user?.id ?: return
    val tokens = ArrayList<String>(); newToken?.let { tokens.add(it) }
    val l = acctList()
    l.filter { it.id != cur && it.id != newId && it.rt.isNotEmpty() }.forEach { a ->
        val (ss, _) = Sb.refresh(a.rt)
        if (ss != null) { tokens.add(ss.access); a.rt = ss.refresh }
    }
    putList(acctList().map { x -> l.firstOrNull { it.id == x.id }?.let { y -> x.rt = y.rt }; x })
    Sb.fn("link-accounts", JSONObject().put("tokens", JSONArray(tokens)), mine)
}

// linkedLoginModal(): a linked account that is not on this phone yet opens here with its password
suspend fun Online.linkedLogin(x: SavedAcct, pw: String): String? {
    val r = Sb.fn("signin", JSONObject().put("action", "linked").put("target", x.id).put("password", pw))
    if (r.status == 0) return "Could not reach Nook. Check your connection"
    if (r.body.optString("error") == "banned") return "That account is banned"
    if (!r.ok) return if (r.body.optString("error") == "not_linked") "That account is not linked anymore" else signinMsg(r)
    val ss = r.body.optJSONObject("session") ?: return "Could not sign in. Try again"
    val l = acctList().filter { it.id != x.id }.toMutableList()
    l.add(SavedAcct(x.id, ss.optString("refresh_token"), x.username, x.name, x.avatar, false)); putList(l)
    switchAccount(x.id)
    return null
}

// openAccounts(): the accounts on this phone, the linked ones that are not here yet, Add account and Remove or unlink
fun Online.openAccounts() {
    val cur = Sb.user ?: return
    app.scope.launch {
        val all = acctList()
        // the name, handle and picture of every account on this phone, read fresh so a changed picture shows at once
        withTimeoutOrNull(700) {
            val r = Sb.get(Q("accounts").select("id, username, display_name, avatar").inList("id", all.map { it.id }))
            r.rows.forEach { row -> all.firstOrNull { it.id == row.optString("id") }?.let { a -> a.username = row.optString("username"); a.name = row.optString("display_name").ifEmpty { a.username }; a.avatar = row.optStr("avatar")?.takeIf { it.length < 400_000 } } }
            if (r.ok) putList(acctList().map { x -> all.firstOrNull { it.id == x.id }?.let { a -> x.username = a.username; x.name = a.name; x.avatar = a.avatar }; x })
        }
        var linked = setOf<String>()
        val others = ArrayList<SavedAcct>()
        withTimeoutOrNull(1200) {
            val ls = Sb.get(Q("account_links").select("b").eq("a", cur.id))
            linked = ls.rows.map { it.optString("b") }.toSet()
            val missing = linked.filter { id -> all.none { it.id == id } }
            if (missing.isNotEmpty()) {
                val m = cachedAccounts(missing)
                missing.forEach { id -> val x = m.get(id); if (x != null && x.optString("username").isNotEmpty()) others.add(SavedAcct(id, "", x.optString("username"), x.optString("display_name").ifEmpty { x.optString("username") }, x.optStr("avatar")?.takeIf { Photos.ownMedia(it) && it.length < 400_000 }, false)) }
            }
        }
        val items = ArrayList<SheetItem>()
        all.filter { it.username.isNotEmpty() }.forEach { a ->
            items.add(SheetItem(if (a.username.isNotEmpty()) "@" + a.username else a.name, av = Author(a.id, a.name, a.username, a.avatar), on = a.id == cur.id) { if (a.id != cur.id) switchAccount(a.id) })
        }
        others.forEach { x -> items.add(SheetItem("@" + x.username, av = Author(x.id, x.name, x.username, x.avatar), trail = "lock") { app.panels.add(Panel.LinkedLogin(x)) }) }
        items.add(SheetItem("Add account", "plus") { app.panels.add(Panel.AddAccount) })
        val mainId = mainAccountId(all)
        val risky = ArrayList<SheetItem>()
        if (all.any { it.id == cur.id } && cur.id != mainId) risky.add(SheetItem("Remove this account", "close", danger = true) {
            app.confirm("Remove @" + s.profile.handle + " from this phone? You need its password to add it again.", "Remove") { app.scope.launch { runCatching { pushDetach() }; leaveThisAccount(false) } }
        })
        if (all.any { it.id == cur.id } && cur.id != mainId && mainId != null && mainId in linked) risky.add(SheetItem("Unlink this account", "close", danger = true) {
            app.confirm("Unlink @" + s.profile.handle + " from your other accounts? They stop listing each other on other phones.", "Unlink") {
                app.scope.launch { val r = Sb.delete(Q("account_links").or("a.eq.${cur.id},b.eq.${cur.id}")); app.say(if (r.ok) "Unlinked" else "Could not unlink") }
            }
        })
        if (risky.isNotEmpty()) items.add(SheetItem("Remove or unlink", "close", danger = true) { app.open(risky + SheetItem("Cancel", cancel = true), "@" + s.profile.handle) })
        items.add(SheetItem("Cancel", cancel = true))
        app.open(items, "Accounts on this phone")
    }
}

// ---- password, email, authenticator ----

// verifyPassword(): the current password is checked through the signin function so the same limit applies
suspend fun Online.verifyPassword(pw: String): String? {
    val r = Sb.fn("signin", JSONObject().put("check", true).put("password", pw))
    if (r.status == 0) return "Could not reach Nook. Check your connection"
    if (r.ok) { r.body.optJSONObject("session")?.let { Sb.takeSession(it.optString("access_token"), it.optString("refresh_token")) }; return null }
    if (r.body.optString("error") == "wrong_password") return "Current password is wrong" + r.body.optInt("left").let { if (it > 0) ". $it" + (if (it == 1) " try" else " tries") + " left before a wait" else "" }
    return signinMsg(r)
}

suspend fun Online.changePassword(cur: String, nw0: String, again0: String): String? {
    // spaces at the ends (usually from pasting) are not part of a password
    val nw = nw0.trim(); val again = again0.trim()
    if (cur.isEmpty() || nw.isEmpty()) return "Fill in every box"
    if (nw.length < 8) return "New password needs 8 or more characters"
    if (pwBytes(nw) > 72) return "New password is too long (72 bytes at most)"
    if (nw != again) return "New passwords do not match"
    if (nw == cur.trim()) return "Pick a different password"
    if (pwned(nw)) return PWNED_MSG
    val pr = Sb.fn("signin", JSONObject().put("action", "setpw").put("current", cur).put("password", nw))
    if (pr.status == 0) return "Could not reach Nook. Check your connection"
    if (!pr.ok) return setpwMsg(pr)
    pr.body.optJSONObject("session")?.let { Sb.takeSession(it.optString("access_token"), it.optString("refresh_token")) }
    val kr = runCatching { loginBackup(nw, reseal = true) }.getOrDefault("fail")
    app.say(if (kr == "fail") "Password changed. Your message key could not be saved with it" else "Password changed")
    return null
}

suspend fun Online.changeEmail(cur: String, email: String, verified: Boolean = false): String? {
    val e = email.trim().lowercase()
    if (cur.isEmpty() || e.isEmpty()) return "Fill in every box"
    if (!EMAIL_RE.matches(e)) return "That email does not look real"
    if (e == (Sb.user?.email ?: "").lowercase()) return "That is already your email"
    if (!verified) verifyPassword(cur)?.let { return it }
    val err = Sb.updateEmail(e) ?: run { app.say("Confirmation link sent to $e. Open it to finish"); watchEmailChange(e); return null }
    return when {
        err.status == 0 -> "Could not reach Nook. Check your connection"
        err.code == "email_exists" || err.code == "user_already_exists" || Regex("already (been )?registered", RegexOption.IGNORE_CASE).containsMatchIn(err.message) -> "That email is already used by another account"
        err.code == "over_email_send_rate_limit" || err.status == 429 -> "Too many emails were sent. Wait a few minutes and try again"
        else -> authMsg(err.code, err.message, err.status)
    }
}

var totpOn: Boolean? = null

// recoverModal(): the reset email goes out when the account exists (and the authenticator code fits, when it uses one)
suspend fun Online.sendReset(ident: String, code: String): String? {
    if (ident.isEmpty()) return "Type your email or username"
    val nonce = Crypto.b64(Crypto.random(18)).replace("+", "-").replace("/", "_").trimEnd('=')
    Cache.write("reset-nonce", JSONObject().put("n", nonce).put("t", System.currentTimeMillis()))
    val r = Sb.fn("totp", JSONObject().put("action", "reset").put("ident", ident).put("code", code.replace(Regex("\\s+"), "")).put("redirectTo", "https://nook-web-app.github.io/reset/?rn=$nonce"))
    if (!r.ok) return if (r.status == 0) "Could not reach the server. Try again later." else "Could not send the link. Try again later."
    app.say("If that account exists and the code fits, a reset link is on its way")
    return null
}

suspend fun Online.recoverWithCode(ident: String, code: String, pw: String, pw2: String): String? {
    val c = code.replace(Regex("\\s+"), "")
    if (ident.isEmpty() || !Regex("^\\d{6}$").matches(c)) return "Fill in your email or username and the 6 digit code"
    if (pw.length < 8) return "New password needs 8 or more characters"
    if (pwBytes(pw) > 72) return "New password can be 72 bytes at most (fewer for emoji or accents)"
    if (pw != pw2) return "New passwords do not match"
    if (pwned(pw)) return PWNED_MSG
    val r = Sb.fn("totp", JSONObject().put("action", "recover").put("ident", ident).put("code", c).put("password", pw))
    if (!r.ok) return failText(r, "Could not reset the password")
    app.say("Password changed. Sign in with it now.")
    return null
}

// the reset link of an email opened this app (the reset page passes it on): it must carry the nonce made here
suspend fun Online.takeResetLink(access: String, refresh: String, rn: String): Boolean {
    val mine = (Cache.read("reset-nonce")?.v as? JSONObject)?.takeIf { System.currentTimeMillis() - it.optLong("t") < 2 * 3600_000 }?.optString("n") ?: ""
    if (mine.length < 16 || rn != mine) { app.say("That link was not requested on this phone, so it was not used. Ask for a new reset link here"); return false }
    val c = jwtClaims(access)
    if (c == null || c.optString("iss") != "$SB_URL/auth/v1" || c.optString("role") != "authenticated" || c.optString("sub").isEmpty()) { app.say("That reset link is not valid. Ask for a new one"); return false }
    Sb.takeSession(access, refresh) ?: run { app.say("Could not check the reset link. Check your connection, or ask for a new link"); return false }
    Cache.remove("reset-nonce")
    me = Sb.user
    app.panels.add(Panel.NewPassword)
    return true
}

suspend fun Online.setNewPassword(pw: String, pw2: String): String? {
    if (pw.length < 8) return "New password needs 8 or more characters"
    if (pwBytes(pw) > 72) return "New password is too long (72 bytes at most)"
    if (pw != pw2) return "New passwords do not match"
    if (pwned(pw)) return PWNED_MSG
    val pr = Sb.fn("signin", JSONObject().put("action", "setpw").put("password", pw))
    if (pr.status == 0) return "Could not reach Nook. Check your connection"
    if (!pr.ok) return if (pr.body.optString("error") == "no_password") "This link has run out. Ask for a new one" else setpwMsg(pr)
    pr.body.optJSONObject("session")?.let { Sb.takeSession(it.optString("access_token"), it.optString("refresh_token")) }
    val kr = runCatching { loginBackup(pw, reseal = true) }.getOrDefault("fail")
    app.say(if (kr == "fail") "Password changed. Your message key could not be saved with it" else "Password changed")
    restart()
    return null
}

// ---- deactivating and deleting ----

// the account is hidden until the next sign in; the caller has already proved who is asking (password or fingerprint)
suspend fun Online.deactivate(): String? {
    val r = Sb.rpc("set_my_deactivated", JSONObject().put("flag", true))
    if (!r.ok) return "Could not deactivate. Try again"
    runCatching { pushDetach() }
    leaveThisAccount(true)
    return null
}

// confirmLogin(): the email and password are checked first; only then is the data download offered
suspend fun Online.checkDeleteLogin(email: String, pw: String): String? {
    if (email.trim().isEmpty() || pw.isEmpty()) return "Type your email and password"
    if (email.trim().lowercase() != (Sb.user?.email ?: "").lowercase()) return "That is not the email of this account"
    return verifyPassword(pw)?.replace("Current password", "Password")
}

// delete-account: the account is hidden and kept for 30 days; the phone is cleared
suspend fun Online.deleteAccount(): String? {
    val r = Sb.fn("delete-account")
    if (!r.ok) return failText(r, "Could not delete the account. Try again")
    runCatching { pushDetach() }
    dropMyKeys()
    leaveThisAccount(false)
    return null
}

// the age question: the server says whether the answer passes
suspend fun Online.answerAge(years: Int): String? {
    val r = Sb.fn("age", JSONObject().put("action", "answer").put("age", years))
    when (r.body.optString("state")) {
        "passed" -> { restart(); return null }
        "banned" -> { showBanned(Sb.user?.email); return null }
    }
    return failText(r, "Something went wrong. Try again.")
}

// the mod notices of this account that were not seen yet (checkModNotices)
suspend fun Online.checkModNotices() {
    if (uid == null) return
    val r = Sb.get(Q("mod_notices").select("id, kind, post_id, note").isNull("seen_at").order("created_at").limit(5))
    r.rows.forEach { showModNotice(it) }
}

private val modShown = HashSet<String>()
// showModNotice(): a post or a part of the profile was taken down: say what and why
fun Online.showModNotice(n: JSONObject) {
    val id = n.optString("id")
    if (id.isEmpty() || !modShown.add(id)) return
    val kind = n.optString("kind")
    val seen = { app.scope.launch { Sb.update(Q("mod_notices").eq("id", id), JSONObject().put("seen_at", isoNow())) } }
    n.optStr("post_id")?.let { dropLocalPosts(listOf(it)) }
    if (kind == "exposed") { app.warns.add(Warn("Your email was posted", "This email address was written in a public post. The post has been removed.", mail = n.optString("note"), wait = 10, onDone = { seen() })); return }
    if (kind == "minor") { seen(); app.root(Route.Age); return }
    if (kind == "bio") s.profile.bio = ""
    if (kind == "name") s.profile.name = ""
    val field = Regex("^(avatar|banner)").find(kind)?.value
    if (field == "avatar") s.profile.avatar = null
    if (field == "banner") s.profile.banner = null
    app.persist()
    val sexual = kind == "sexual" || (field != null && !Regex("_(toolarge|rules)$").containsMatchIn(kind))
    val what = when { field == "avatar" -> "Profile photo removed"; field == "banner" -> "Banner removed"; else -> mapOf("bio" to "Bio removed", "name" to "Name removed", "username" to "Username changed")[kind] ?: "Post removed" }
    val note = n.optString("note").trim().replace(Regex("[.\\s]+$"), "")
    val why = when {
        kind == "removed" -> "Reason: reported and removed by the owner."
        Regex("^(rules|bio|name|username|avatar_rules|banner_rules)$").matches(kind) -> "Reason: " + (if (note.isNotEmpty()) "$note." else "text that is not allowed.")
        sexual -> "Reason: sexual content."
        else -> "Reason: the file could not be checked."
    }
    val w = Warn(what, why, onDone = { seen() })
    app.warns.add(w)
    if (n.optStr("post_id") != null && Regex("^(rules|sexual)$").matches(kind)) app.scope.launch { loadPostLock(); if (lockLeft() > 0) w.extra = "Posting is paused for " + lockText(lockLeft()) + "." }
}

// always counted in hours, so 14 days reads as 336 hours
fun lockText(ms: Long): String { val h = maxOf(1, Math.ceil(ms / 3.6e6).toInt()); return "$h" + if (h == 1) " hour" else " hours" }

// the banned page's Download my data: the posts, photos, profile and chats of the banned account in one zip
suspend fun Online.banExport(email: String, pw: String, say: (String) -> Unit): File? {
    val r = Sb.fn("ban-export", JSONObject().put("email", email).put("password", pw), token = "")
    if (!r.ok) { say(if (r.body.optString("error") == "locked") lockedMsg(r.body.optStr("until")) else r.body.optString("error").ifEmpty { "Could not get your data. Try again later." }); return null }
    return buildBanZip(r.body, say)
}
