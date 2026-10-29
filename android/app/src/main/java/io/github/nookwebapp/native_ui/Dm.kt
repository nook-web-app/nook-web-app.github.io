package io.github.nookwebapp.native_ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

// Messages between people, sealed end to end like in the web app: each account has a P-256 key pair, the private half
// lives on the phone (sealed in the vault) and, locked with the login or a recovery password, on the server as a backup
// only the person can open. Two people's keys make the AES key of their chat. Pictures are sealed the same way and kept
// in the private dm-media bucket.

const val ZMARK = "⁣Z⁣"
const val ZPOST = "⁣P⁣"
const val RPOST = "⁣R⁣"
const val LOCKED_MSG = "Open your messages first (Settings, Message key backup)"
private val UUID_RE = Regex("^[0-9a-f-]{36}$", RegexOption.IGNORE_CASE)

// one message of a chat with a person, as the server holds it and as it was opened on this phone
class DmMsg(val id: Long?, val sender: String, val recipient: String, val body: String, media: JSONArray, val created: String, var readAt: String?) {
    var media by mutableStateOf(media)
    var text by mutableStateOf<String?>(null)
    var rpost by mutableStateOf<RPost?>(null)
    var zpost by mutableStateOf<ZPost?>(null)
    var ai = false
    var plain = false
    // shown while it is still on its way (.tmpm)
    var tmp by mutableStateOf(false)
    var fresh = false
    val t get() = parseIso(created)
    fun sig() = body + "|" + (0 until media.length()).joinToString(",") { media.optJSONObject(it)?.optString("url").orEmpty() }
    fun json(): JSONObject = JSONObject().put("id", id ?: JSONObject.NULL).put("sender_id", sender).put("recipient_id", recipient).put("body", body).put("media", media).put("created_at", created).put("read_at", readAt ?: JSONObject.NULL)
    companion object {
        fun of(j: JSONObject) = DmMsg(if (j.isNull("id")) null else j.optLong("id"), j.optString("sender_id"), j.optString("recipient_id"), j.optString("body"),
            j.optJSONArray("media") ?: runCatching { JSONArray(j.optString("media")) }.getOrNull() ?: JSONArray(), j.optString("created_at"), j.optStr("read_at"))
    }
}

// a row of the chat list (dmInbox)
class Convo(val other: String, val name: String, val avatar: String?, val unread: Int, val last: JSONObject?) {
    var gist by mutableStateOf<String?>(null)
    fun json(): JSONObject = JSONObject().put("other", other).put("name", name).put("avatar", avatar ?: JSONObject.NULL).put("unread", unread).put("last", last ?: JSONObject.NULL)
    companion object { fun of(j: JSONObject) = Convo(j.optString("other"), j.optString("name"), j.optStr("avatar"), j.optInt("unread"), j.optJSONObject("last")) }
}

// the chat that is open (liveDm): its rows, the typing dots and whether messaging is off
class LiveDm(val id: String) {
    val rows = mutableStateListOf<DmMsg>()
    var typing by mutableStateOf(false)
    var locked by mutableStateOf("")
    var loaded by mutableStateOf(false)
    var failed by mutableStateOf(false)
    var known = listOf<JSONObject>()
    var fullAt = 0L
    var fill: ((String) -> Unit)? = null
}

// everything about messages that lives as long as the account is open
class DmState {
    var locked by mutableStateOf(false)
    var restoreAsked = false
    var okAt = 0L
    var mine: Deferred<Crypto.Keys>? = null
    val shared = HashMap<String, Pair<Long, Deferred<ByteArray>>>()
    val ready = HashMap<String, ByteArray>()
    val untrusted = HashMap<String, String>()
    val muteSet = HashMap<String, Long>()
    val hideSet = HashSet<String>()
    var mutesAt = 0L
    var targetsAt = 0L
    var targetsUser = ""
    var targetIds: List<String> = emptyList()
    var live by mutableStateOf<LiveDm?>(null)
    var inbox by mutableStateOf<List<Convo>?>(null)
    var inboxN by mutableStateOf(-1)
    val typingIn = HashMap<String, Long>()
    // true while that person is typing, so only the row of that person redraws
    val typingFlag = mutableStateMapOf<String, Boolean>()
    val typeOut = HashMap<String, Pair<Rt.Ch, LongArray>>()
    var rtChan: Rt.Ch? = null
    var delChan: Rt.Ch? = null
    var tpChan: Rt.Ch? = null
    var rtOk = false
    val linkShown = HashSet<String>()
    var linkWatching = false
    var linkIdle = 0
    val signed = HashMap<String, Pair<Long, String>>()
    val rp = HashMap<String, JSONObject?>()
}

val Online.dm: DmState get() = app.dm
fun Online.dmReset() { app.dm = DmState() }

// ---- the key of this phone ----

private fun Online.keyFile(id: String) = s.filesDir?.let { File(File(it, "keys").apply { mkdirs() }, "$id.bin") }
fun Online.readLocalKeys(id: String): Crypto.Keys? = keyFile(id)?.let { Vault.read(it) }?.let { runCatching { Crypto.fromJwk(JSONObject(it)) }.getOrNull() }
fun Online.saveLocalKeys(id: String, k: Crypto.Keys) { keyFile(id)?.let { Vault.write(it, Crypto.jwk(k).toString()) } }
fun Online.dropMyKeys() { uid?.let { keyFile(it)?.delete() } }

fun Online.lockKeys() {
    dm.locked = true; dm.okAt = 0
    if (app.top == Route.Chats || app.top is Route.Dm) promptUnlock()
}
fun Online.promptUnlock() {
    if (!dm.locked || dm.restoreAsked) return
    dm.restoreAsked = true
    app.scope.launch { delay(400); unlockSheet() }
}

// loadMyKeys(): a new phone must never make a new key when the account already has one: that would lock the old messages
private suspend fun Online.loadMyKeys(id: String): Crypto.Keys {
    readLocalKeys(id)?.let { dm.locked = false; return it }
    val me = Sb.get(Q("accounts").select("public_key").eq("id", id))
    val bk = Sb.get(Q("key_backups").select("user_id").eq("user_id", id).neq("mode", "off").limit(1))
    if (!me.ok || !bk.ok) throw IllegalStateException("Could not check your message key. Try again")
    if (me.one?.optStr("public_key") != null || bk.rows.isNotEmpty()) { lockKeys(); throw IllegalStateException(LOCKED_MSG) }
    val k = Crypto.newKeys()
    saveLocalKeys(id, k)
    return k
}

suspend fun Online.myKeys(): Crypto.Keys {
    val id = uid ?: throw IllegalStateException("signed out")
    val d = dm.mine ?: app.scope.async { loadMyKeys(id) }.also { dm.mine = it }
    return try { d.await() } catch (e: Exception) { if (dm.mine === d) dm.mine = null; throw e }
}

fun Online.resetKeyCaches() { dm.okAt = 0; dm.mine = null; dm.shared.clear(); dm.ready.clear() }

// loginBackup(): the key is saved locked with the login password, so signing in on a new phone opens the messages by itself
suspend fun Online.loginBackup(pw: String, fast: Boolean = false, reseal: Boolean = false, enable: Boolean = false): String {
    val id = uid ?: return "fail"
    if (pw.isEmpty()) return "fail"
    try {
        val rowsQ = Sb.get(Q("key_backups").select("mode, pub, salt, iv, ct, iters").eq("user_id", id))
        val meQ = Sb.get(Q("accounts").select("public_key").eq("id", id))
        if (!rowsQ.ok) return "fail"
        val rows = rowsQ.rows
        val pub = meQ.one?.optStr("public_key")
        val login = rows.firstOrNull { it.optString("mode") == "login" }
        val optedOut = rows.any { it.optString("mode") == "off" }
        val mine = readLocalKeys(id)
        if (mine == null) {
            if (login != null && pub == login.optString("pub")) {
                return try {
                    val k = withContext(kotlinx.coroutines.Dispatchers.Default) { Crypto.openBackup(login, pw, id) }
                    saveLocalKeys(id, k); resetKeyCaches(); dm.locked = false
                    if (!Crypto.kbV2(login.optInt("iters"))) runCatching { Sb.upsert("key_backups", withContext(kotlinx.coroutines.Dispatchers.Default) { Crypto.sealBackup(k, pw, id, "login") }, "user_id,mode") }
                    "restored"
                } catch (e: Exception) { "locked" }
            }
            if (pub != null) return "locked"
            if (rows.any { it.optString("mode") != "off" }) return "locked"
            if (optedOut && !enable) return "off"
            resetKeyCaches()
            val k = myKeys()
            val up = Sb.upsert("key_backups", withContext(kotlinx.coroutines.Dispatchers.Default) { Crypto.sealBackup(k, pw, id, "login") }, "user_id,mode")
            return if (up.ok) "saved" else "fail"
        }
        if (pub != null && pub != mine.pubB64) return "locked"
        if (optedOut && !enable) return "off"
        if (login != null && login.optString("pub") == mine.pubB64 && !reseal) {
            if (fast && Crypto.kbV2(login.optInt("iters"))) return "saved"
            val opens = runCatching { withContext(kotlinx.coroutines.Dispatchers.Default) { Crypto.openBackup(login, pw, id) } }.isSuccess
            if (opens && Crypto.kbV2(login.optInt("iters"))) return "saved"
        }
        val up = Sb.upsert("key_backups", withContext(kotlinx.coroutines.Dispatchers.Default) { Crypto.sealBackup(mine, pw, id, "login") }, "user_id,mode")
        if (up.ok && enable) Sb.delete(Q("key_backups").eq("user_id", id).eq("mode", "off"))
        return if (up.ok) "saved" else "fail"
    } catch (e: Exception) { return "fail" }
}

// a new account made next to the open one gets its key now, saved locked with its password (with its own login)
suspend fun Online.newAccountKey(id: String, token: String, pw: String): Boolean {
    val k = Crypto.newKeys()
    saveLocalKeys(id, k)
    val row = withContext(kotlinx.coroutines.Dispatchers.Default) { Crypto.sealBackup(k, pw, id, "login") }
    val a = Sb.asUser(token, "POST", "key_backups?on_conflict=user_id,mode", row, "return=minimal,resolution=merge-duplicates")
    val b = Sb.asUser(token, "PATCH", "accounts?id=eq.$id", JSONObject().put("public_key", k.pubB64))
    return a.first in 200..299 && b.first in 200..299
}

// ensureE2E(): this phone's key is the account's key; another phone holding a newer one means this one asks for it
suspend fun Online.ensureE2E() {
    val id = uid ?: return
    val k = myKeys()
    val r = Sb.get(Q("accounts").select("public_key").eq("id", id))
    if (!r.ok) throw IllegalStateException("network")
    val pub = r.one?.optStr("public_key")
    if (pub != null && pub != k.pubB64) {
        dm.mine = CompletableDeferred<Crypto.Keys>().apply { completeExceptionally(IllegalStateException(LOCKED_MSG)) }
        lockKeys()
        throw IllegalStateException(LOCKED_MSG)
    }
    if (pub == null) { val u = Sb.update(Q("accounts").eq("id", id), JSONObject().put("public_key", k.pubB64)); if (!u.ok) throw IllegalStateException(u.error?.message) }
    watchLinks()
}

// adoptNewKey(): a new key reaches the server first and this phone second, so a failed call never destroys the old key
private suspend fun Online.adoptNewKey(k: Crypto.Keys) {
    val id = uid ?: return
    val u = Sb.update(Q("accounts").eq("id", id), JSONObject().put("public_key", k.pubB64))
    if (!u.ok) throw IllegalStateException(u.error?.message)
    saveLocalKeys(id, k)
}
private suspend fun Online.dropOldBackups(modes: List<String>? = null) {
    val id = uid ?: return
    repeat(3) {
        var q = Q("key_backups").eq("user_id", id)
        q = if (modes != null) q.inList("mode", modes) else q.neq("mode", "off")
        if (Sb.delete(q).ok) return
    }
    throw IllegalStateException("old backup")
}
suspend fun Online.makeNewKey(): Crypto.Keys {
    val k = Crypto.newKeys()
    adoptNewKey(k); dropOldBackups()
    uid?.let { Sb.delete(Q("key_links").eq("user_id", it)) }
    return k
}

// unlockModal(): the ways to open the messages on this phone
fun Online.unlockSheet() {
    val id = uid ?: return
    app.scope.launch {
        val r = Sb.get(Q("key_backups").select("mode").eq("user_id", id))
        if (!r.ok) { app.say("Could not load your backup. Check your connection and try again"); return@launch }
        val has = { m: String -> r.rows.any { it.optString("mode") == m } }
        val items = ArrayList<SheetItem>()
        items.add(SheetItem("Approve on my other phone", "userswap") { app.panels.add(Panel.WaitApproval) })
        if (has("login")) items.add(SheetItem("Use my login password", "lock") { app.panels.add(Panel.RestoreKeys(true)) })
        if (has("recovery")) items.add(SheetItem("Use my recovery password", "pass") { app.panels.add(Panel.RestoreKeys(false)) })
        items.add(SheetItem("Start fresh", "trash", danger = true) {
            app.confirm("Start fresh? Older messages will not open anymore, here or for the other person.", "Start fresh") {
                app.scope.launch { try { makeNewKey(); app.say("New message key made"); delay(500); restart() } catch (e: Exception) { app.say("Could not do that. Try again") } }
            }
        })
        items.add(SheetItem("Cancel", cancel = true))
        app.open(items, "Open your messages")
    }
}

// restoreKeysModal(): the saved copy opened with the login or recovery password; an older key never replaces the account's
suspend fun Online.restoreKeys(login: Boolean, pw: String): String? {
    val id = uid ?: return "Sign in first"
    if (pw.isEmpty()) return "Type the password"
    val r = Sb.get(Q("key_backups").select("mode, salt, iv, ct, iters, pub").eq("user_id", id).eq("mode", if (login) "login" else "recovery"))
    val row = r.one ?: return "Could not load the saved key. Try again"
    val k = runCatching { withContext(kotlinx.coroutines.Dispatchers.Default) { Crypto.openBackup(row, pw, id) } }.getOrNull() ?: return "That is not the right password"
    val me = Sb.get(Q("accounts").select("public_key").eq("id", id))
    if (!me.ok) return "Could not reach Nook. Check your connection and try again"
    val pub = me.one?.optStr("public_key")
    if (pub != null && pub != k.pubB64) return "That saved key is older than the one on your account. Use another way"
    if (pub == null && !Sb.update(Q("accounts").eq("id", id), JSONObject().put("public_key", k.pubB64)).ok) return "Could not reach Nook. Try again"
    saveLocalKeys(id, k)
    dm.locked = false
    app.say("Messages unlocked")
    delay(500); restart()
    return null
}

// backupSetupModal(): a recovery password only the person knows
suspend fun Online.backupSetup(a: String, b: String, changing: Boolean): String? {
    val id = uid ?: return "Sign in first"
    if (a.length < 10) return "Use at least 10 characters. Three random words work well"
    if (a != b) return "The two passwords do not match"
    val cur = try { myKeys() } catch (e: Exception) { return if (e.message == LOCKED_MSG) LOCKED_MSG else plainErr(e.message, "Your message key could not be opened") }
    val row = withContext(kotlinx.coroutines.Dispatchers.Default) { Crypto.sealBackup(cur, a, id, "recovery") }
    if (!Sb.upsert("key_backups", row, "user_id,mode").ok) return "Could not save the backup. Try again"
    app.say(if (changing) "Recovery password changed" else "Backup is on")
    return null
}

// loginBackupModal(): the login password copy turned back on, after the password is checked
suspend fun Online.startSaving(pw: String): String? {
    if (pw.isEmpty()) return "Type your login password"
    val chk = Sb.fn("signin", JSONObject().put("action", "check").put("password", pw))
    if (chk.status == 0) return "Could not reach Nook. Check your connection"
    if (!chk.ok) return signinMsg(chk)
    if (loginBackup(pw, enable = true, reseal = true) != "saved") return "Could not save it. Try again"
    app.say("Saved with your login password")
    return null
}

suspend fun Online.stopSaving() {
    val id = uid ?: return
    val a = Sb.delete(Q("key_backups").eq("user_id", id).eq("mode", "login"))
    val b = Sb.upsert("key_backups", JSONObject().put("user_id", id).put("mode", "off").put("salt", "x").put("iv", "x").put("ct", "x").put("iters", 100000).put("pub", JSONObject.NULL), "user_id,mode")
    app.say(if (!a.ok || !b.ok) "Could not do that" else "Stopped saving with your login password")
}

// the state the Settings row shows: "off", "locked" or "on", and which copies there are
suspend fun Online.keyState(): Pair<String, List<String>>? {
    val id = uid ?: return null
    val bk = Sb.get(Q("key_backups").select("mode, pub").eq("user_id", id))
    if (!bk.ok) return null
    val rows = bk.rows.filter { it.optString("mode") != "off" }
    val loc = readLocalKeys(id)
    val st = if (rows.isEmpty()) "off" else if (loc == null || rows.none { it.optString("pub") == loc.pubB64 }) "locked" else "on"
    return st to rows.map { it.optString("mode") }
}

// ---- moving the key to a new phone (key_links) ----

// waitForApprovalModal(): this phone asks; the other phone shows the same twenty digits and approves
suspend fun Online.waitForApproval(show: (String) -> Unit, say: (String) -> Unit, stopped: () -> Boolean) {
    val id = uid ?: return
    var linkId: String? = null
    try {
        val eph = Crypto.newKeys()
        Sb.delete(Q("key_links").eq("user_id", id))
        val ins = Sb.insert("key_links", JSONObject().put("user_id", id).put("req_pub", eph.pubB64), select = "id")
        linkId = ins.one?.optString("id")?.ifEmpty { null } ?: throw IllegalStateException("insert")
        show(Crypto.linkCode(eph.pubB64))
        val until = System.currentTimeMillis() + 10 * 60_000
        var polls = 0
        while (!stopped() && System.currentTimeMillis() < until) {
            delay(minOf(8000L, 2000L + 250L * ++polls))
            if (stopped()) return
            val row = Sb.get(Q("key_links").select("status, sender_pub, iv, ct").eq("id", linkId)).one ?: continue
            if (row.optString("status") != "approved") continue
            say("Opening...")
            val key = Crypto.shared(eph.priv, Crypto.pubFromB64(row.getString("sender_pub")))
            val k = Crypto.fromJwk(JSONObject(String(Crypto.open(key, Crypto.unb64(row.getString("iv")), Crypto.unb64(row.getString("ct"))))))
            val me = Sb.get(Q("accounts").select("public_key").eq("id", id)).one
            if (me?.optStr("public_key") != k.pubB64) { say("That key does not match this account. Try again"); return }
            saveLocalKeys(id, k)
            Sb.delete(Q("key_links").eq("id", linkId))
            dm.locked = false
            app.say("Messages opened")
            delay(500); restart()
            return
        }
        if (!stopped()) say("Nobody answered. Close this and try again")
    } catch (e: Exception) { say("Something went wrong. Close this and try again") }
    finally { if (stopped()) linkId?.let { l -> app.scope.launch { Sb.delete(Q("key_links").eq("id", l)) } } }
}

// checkLinks() / watchLinks(): a new phone of this account asking for the key shows up here to be approved
fun Online.watchLinks() {
    if (dm.linkWatching) return
    dm.linkWatching = true
    app.scope.launch {
        while (uid != null) {
            if (app.foreground && !dm.locked) runCatching {
                val since = isoOf(System.currentTimeMillis() - 10 * 60_000)
                val r = Sb.get(Q("key_links").select("id, req_pub").eq("status", "pending").gt("created_at", since).order("created_at", false).limit(1))
                val row = r.one
                if (row != null) dm.linkIdle = 0 else dm.linkIdle++
                if (row != null && dm.linkShown.add(row.optString("id"))) app.panels.add(Panel.ApproveLink(row.optString("id"), row.optString("req_pub")))
            }
            delay(if (dm.linkIdle > 200) 60_000 else if (dm.linkIdle > 12) 20_000 else 8000)
        }
        dm.linkWatching = false
    }
}

suspend fun Online.approveLink(linkId: String, reqPub: String): String? {
    return try {
        val k = myKeys()
        val eph = Crypto.newKeys()
        val key = Crypto.shared(eph.priv, Crypto.pubFromB64(reqPub))
        val iv = Crypto.random(12)
        val ct = Crypto.seal(key, iv, Crypto.jwk(k).toString().toByteArray())
        val up = Sb.update(Q("key_links").eq("id", linkId), JSONObject().put("status", "approved").put("sender_pub", eph.pubB64).put("iv", Crypto.b64(iv)).put("ct", Crypto.b64(ct)))
        if (!up.ok) "Something went wrong. Try again" else { app.say("Approved"); null }
    } catch (e: Exception) { "Something went wrong. Try again" }
}
fun Online.denyLink(linkId: String) = app.scope.launch { Sb.delete(Q("key_links").eq("id", linkId)) }

// ---- the key of a chat ----

// sharedKey(): worked out from this phone's key and the other person's public key; the first key seen of a person is
// remembered, and a different one later is shown, never silent (sending waits until it is trusted)
suspend fun Online.sharedKey(other: String): ByteArray {
    val me = uid ?: throw IllegalStateException("signed out")
    val hit = dm.shared[other]
    if (hit != null && System.currentTimeMillis() - hit.first < 60_000) return try { hit.second.await() } catch (e: Exception) { dm.shared.remove(other); throw e }
    val d = app.scope.async {
        val mine = myKeys()
        val r = Sb.get(Q("accounts").select("id, public_key").eq("id", other))
        if (!r.ok) throw IllegalStateException(r.error?.message ?: "network")
        val pub = r.one?.optStr("public_key") ?: throw IllegalStateException("they need to open nook once first")
        val pinName = "pin:$me:$other"
        val pinned = Cache.read(pinName)?.v as? String
        if (pinned == null) Cache.write(pinName, pub)
        if (pinned != null && pinned != pub && other != me) { dm.untrusted[other] = pub; app.scope.launch { delay(600); keyChangedNotice(other) } } else dm.untrusted.remove(other)
        Crypto.shared(mine.priv, Crypto.pubFromB64(pub)).also { dm.ready[other] = it }
    }
    dm.shared[other] = System.currentTimeMillis() to d
    return try { d.await() } catch (e: Exception) { dm.shared.remove(other); throw e }
}

// sharedKeyFast(): reading uses the key this phone already worked out (or the remembered key of the person) at once
suspend fun Online.sharedKeyFast(other: String): ByteArray {
    dm.ready[other]?.let { app.scope.launch { runCatching { sharedKey(other) } }; return it }
    val me = uid ?: throw IllegalStateException("signed out")
    val pinned = Cache.read("pin:$me:$other")?.v as? String
    if (pinned == null || other == me) return sharedKey(other)
    app.scope.launch { runCatching { sharedKey(other) } }
    return runCatching { Crypto.shared(myKeys().priv, Crypto.pubFromB64(pinned)).also { if (!dm.ready.containsKey(other)) dm.ready[other] = it } }.getOrElse { sharedKey(other) }
}

fun Online.keyChangedNotice(other: String) {
    val a = acctCache[other]
    val who = nickOf(other).ifEmpty { a?.optString("name") ?: "This person" }
    app.open(listOf(
        SheetItem("Trust the new key") { dm.untrusted.remove(other)?.let { nk -> Cache.write("pin:" + uid + ":" + other, nk); app.say("New key trusted") } },
        SheetItem("Not now", cancel = true),
    ), "$who has a new security key. That happens with a new phone or a reset. If you did not expect it, do not trust it. Nothing is sent to them until you do.")
}
private fun Online.keyGate(other: String) {
    if (dm.untrusted.containsKey(other)) { app.scope.launch { delay(100); keyChangedNotice(other) }; throw IllegalStateException("Their security key changed. Confirm it first") }
}

suspend fun Online.sealFor(other: String, text: String): String {
    val key = sharedKey(other)
    keyGate(other)
    return Crypto.sealText(key, text)
}

// openText(): flag marks a body that is not sealed, so plain text put in by the server or a stranger never looks private
suspend fun Online.openText(other: String, raw: String, flag: Boolean = false): String {
    if (raw.isEmpty()) return ""
    if (!raw.startsWith("e2e1:")) return if (flag) "[not encrypted] $raw" else raw
    return try {
        val k = sharedKeyFast(other)
        runCatching { Crypto.openText(k, raw) }.getOrElse { Crypto.openText(sharedKey(other), raw) }
    } catch (e: Exception) { if (dm.locked) "Locked. Unlock your messages in Settings" else "Can't open this one (the chat key changed)" }
}

// zUn(): the hidden marks of Zenith's answers and of shared posts are not shown as text
fun zUn(t: String) = if (t.startsWith(ZMARK)) t.substring(ZMARK.length) else if (t.startsWith(ZPOST) || t.startsWith(RPOST)) "a post" else t

fun rPostOf(t: String): RPost? {
    if (!t.startsWith(RPOST)) return null
    val j = runCatching { JSONObject(t.substring(RPOST.length)) }.getOrNull() ?: return null
    val id = j.optString("id").takeIf { UUID_RE.matches(it) } ?: return null
    return RPost(id, j.optString("u").takeIf { UUID_RE.matches(it) })
}
fun zPostOf(t: String): ZPost? {
    if (!t.startsWith(ZPOST)) return null
    val j = runCatching { JSONObject(t.substring(ZPOST.length)) }.getOrNull() ?: return null
    val a = j.optString("a").takeIf { it.startsWith("$SB_URL/storage/v1/object/public/media/") && it.length < 400 }
    return if (j.has("x")) ZPost(j.optString("x").take(600), j.optLong("t").takeIf { it > 0 } ?: System.currentTimeMillis(), a) else null
}

// openRows(): what each message says, with the marks of Zenith and the shared posts only believed from the owner
suspend fun Online.openRows(rows: List<DmMsg>, other: String) {
    rows.forEach { m ->
        val t = openText(other, m.body)
        val rp = rPostOf(t)
        if (rp != null || t.startsWith(RPOST)) { m.text = ""; m.rpost = rp; return@forEach }
        val fromOwner = m.sender == OWNER_ID
        val marked = t.startsWith(ZMARK); val card = t.startsWith(ZPOST)
        if (!fromOwner && (marked || card)) { m.text = t.substring(if (marked) ZMARK.length else ZPOST.length); return@forEach }
        val zp = zPostOf(t)
        m.text = if (zp != null || card) "" else zUn(t)
        m.ai = marked
        m.zpost = zp
        if (m.body.isNotEmpty() && !m.body.startsWith("e2e1:") && !m.ai && m.rpost == null && m.zpost == null) m.plain = true
    }
}

// ---- the pictures of a chat ----

// dmSignedUrl(): the bucket is private, so a stored link becomes a short signed link
suspend fun Online.signedFor(url: String): String? {
    val path = Sb.pathOf(url, "dm-media") ?: return null
    dm.signed[path]?.let { if (it.first > System.currentTimeMillis()) return it.second }
    val u = Sb.signedUrl("dm-media", path, 3600) ?: return null
    dm.signed[path] = (System.currentTimeMillis() + 3_000_000) to u
    return u
}
suspend fun Online.signBatch(media: List<JSONObject>) {
    val paths = media.mapNotNull { Sb.pathOf(it.optString("url"), "dm-media") }.distinct().filter { (dm.signed[it]?.first ?: 0) < System.currentTimeMillis() }
    if (paths.size < 2) return
    val got = Sb.signedUrls("dm-media", paths, 3600)
    val t = System.currentTimeMillis() + 3_000_000
    got.forEach { (p, u) -> dm.signed[p] = t to u }
}

// loadEncMedia(): a sealed picture is fetched and opened; the opened copy is kept in the app's own cache
suspend fun Online.encMedia(md: JSONObject, keyOf: suspend () -> ByteArray): String? {
    val url = md.optString("url")
    val dir = Photos.cacheDir?.let { File(it, "dm").apply { mkdirs() } } ?: return null
    val f = File(dir, Crypto.sha1Hex(url).lowercase())
    if (f.exists()) return f.path
    val signed = signedFor(url) ?: return null
    val raw = Sb.bytes(signed) ?: return null
    val iv = md.optStr("iv")
    // opening a full photo is heavy work, so it runs off the main thread
    val plain = if (iv != null) runCatching { val k = keyOf(); withContext(kotlinx.coroutines.Dispatchers.Default) { Crypto.open(k, Crypto.unb64(iv), raw) } }.getOrNull() ?: return null else raw
    withContext(kotlinx.coroutines.Dispatchers.IO) { File(dir, f.name + ".part").apply { writeBytes(plain) }.renameTo(f) }
    md.optInt("w").takeIf { it > 0 }?.let { w -> Photos.noteSize(f.path, w, md.optInt("h")) }
    return f.path
}

// ---- reading chats ----

fun Online.visible(m: JSONObject, other: String) = parseIso(m.optString("created_at")) > (clearMap[other] ?: 0)

// dmThread(): the newest 300 messages of a chat, oldest first
suspend fun Online.dmThread(other: String): List<JSONObject> {
    val me = uid ?: throw IllegalStateException("signed out")
    if (!UUID_RE.matches(other)) throw IllegalArgumentException("bad id")
    loadSocial(true)
    val r = Sb.get(Q("messages").select("id, sender_id, recipient_id, body, media, created_at, read_at")
        .or("and(sender_id.eq.$me,recipient_id.eq.$other),and(sender_id.eq.$other,recipient_id.eq.$me)").order("created_at", false).limit(300))
    if (!r.ok) throw IllegalStateException(r.error?.message ?: "load")
    return r.rows.reversed().filter { visible(it, other) }
}
suspend fun Online.dmThreadAfter(other: String, after: Long): List<JSONObject> {
    val me = uid ?: throw IllegalStateException("signed out")
    if (!UUID_RE.matches(other)) throw IllegalArgumentException("bad id")
    val r = Sb.get(Q("messages").select("id, sender_id, recipient_id, body, media, created_at, read_at")
        .or("and(sender_id.eq.$me,recipient_id.eq.$other),and(sender_id.eq.$other,recipient_id.eq.$me)").gt("id", after).order("id").limit(300))
    if (!r.ok) throw IllegalStateException(r.error?.message ?: "load")
    return r.rows.filter { visible(it, other) }
}

private fun Online.keptList(): List<String> = (Cache.read("kept:" + uid)?.v as? JSONArray)?.strings() ?: emptyList()
private fun Online.keptAdd(id: String) { val l = keptList(); if (id !in l) Cache.write("kept:" + uid, JSONArray(l + id)) }
private fun Online.keptDel(id: String) { Cache.write("kept:" + uid, JSONArray(keptList() - id)) }

// dmInbox(): the last message and the unread count of every chat, however long the history is
suspend fun Online.dmInbox(): List<Convo> {
    loadSocial(true)
    val r = Sb.rpc("dm_inbox")
    if (!r.ok) throw IllegalStateException(r.error?.message ?: "inbox")
    val convos = LinkedHashMap<String, Pair<JSONObject, Int>>()
    r.rows.forEach { m -> val o = m.optString("other_id"); if (visible(m, o)) convos[o] = m to m.optInt("unread") }
    val empties = keptList().filter { it !in convos }
    acctsFor(convos.keys + empties)
    val out = convos.map { (o, v) ->
        val a = acctCache[o]
        val l = v.first
        Convo(o, a?.optString("name") ?: "user", a?.optStr("avatar"), v.second, JSONObject().put("id", l.opt("id")).put("body", l.optString("body")).put("media", l.opt("media") ?: JSONArray()).put("created_at", l.optString("created_at")).put("sender_id", l.optString("sender_id")))
    } + empties.map { id -> val a = acctCache[id]; Convo(id, a?.optString("name") ?: "user", a?.optStr("avatar"), 0, null) }
    return out
}

suspend fun Online.warmInbox() {
    val c = dmInbox()
    Cache.write("inbox:" + uid, JSONArray(c.map { it.json() }))
    dm.inbox = c
}

fun Online.cachedInbox(): List<Convo>? = (Cache.read("inbox:" + uid)?.v as? JSONArray)?.objs()?.map { Convo.of(it) }

// dmGist(): what the chat list says about the last message
fun dmGist(text: String, media: JSONArray?, mine: Boolean): String {
    val n = media?.length() ?: 0
    val t = text.trim()
    val who = if (mine) "You sent" else "Sent"
    if (n > 0) {
        if ((0 until n).all { media!!.optJSONObject(it)?.optBoolean("post") == true }) return who + if (n == 1) " a post" else " $n posts"
        return who + if (n == 1) " an image" else " $n images"
    }
    if (Regex("^https?://\\S+$", RegexOption.IGNORE_CASE).matches(t)) return "$who a link"
    return if (t.isNotEmpty()) (if (mine) "You: " else "") + t else ""
}

fun Online.markRead(ids: List<Long>, other: String) {
    val me = uid ?: return
    if (ids.isEmpty()) return
    app.scope.launch {
        Sb.update(Q("messages").inList("id", ids).eq("recipient_id", me), JSONObject().put("read_at", isoNow()))
        refreshBadge(true)
        // the chat list shows no unread number for this person right away, like inboxStale() of the web app
        dm.inbox = dm.inbox?.map { if (it.other == other && it.unread > 0) Convo(it.other, it.name, it.avatar, 0, it.last) else it }
    }
}

// dmStatus(): messaging needs both people to follow each other and nobody to have blocked the other
suspend fun Online.dmLockText(other: String): String? {
    val me = uid ?: return null
    val a = Sb.get(Q("follows").select("followee_id").eq("follower_id", me).eq("followee_id", other))
    val b = Sb.get(Q("follows").select("follower_id").eq("follower_id", other).eq("followee_id", me))
    val c = Sb.get(Q("blocks").select("blocked_id").eq("blocker_id", me).eq("blocked_id", other))
    val d = Sb.get(Q("blocks").select("blocker_id").eq("blocker_id", other).eq("blocked_id", me))
    if (!a.ok || !b.ok || !c.ok || !d.ok) return null
    return when {
        c.rows.isNotEmpty() -> "You blocked this account"
        d.rows.isNotEmpty() -> "You can't message this account"
        a.rows.isEmpty() || b.rows.isEmpty() -> "You can only message people you follow each other with"
        else -> ""
    }
}

// ---- sending ----

// sendDm(): the pictures are sealed and stored first, then the sealed text goes in with them
suspend fun Online.sendDm(other: String, text: String, srcs: List<String> = emptyList(), posts: List<Boolean> = emptyList()): DmMsg {
    val me = uid ?: throw IllegalStateException("signed out")
    if (System.currentTimeMillis() - dm.okAt > 60_000) { if (runCatching { ensureE2E() }.isSuccess) dm.okAt = System.currentTimeMillis() }
    val media = JSONArray(); val paths = ArrayList<String>()
    val key = if (srcs.isNotEmpty()) sharedKey(other) else null
    if (srcs.isNotEmpty()) keyGate(other)
    try {
        srcs.forEachIndexed { i, src ->
            val b = withContext(kotlinx.coroutines.Dispatchers.IO) { Photos.bytesOf(src) } ?: throw IllegalStateException("photo")
            val iv = Crypto.random(12)
            val ct = Crypto.seal(key!!, iv, b)
            val path = "$me/" + uid() + ".bin"
            Sb.upload("dm-media", path, ct, "application/octet-stream")?.let { throw IllegalStateException(it.message) }
            paths.add(path)
            val d = withContext(kotlinx.coroutines.Dispatchers.IO) { Photos.size(src) }
            media.put(JSONObject().put("url", Sb.publicUrl("dm-media", path)).put("type", mimeOf(b)).put("w", d?.first ?: JSONObject.NULL).put("h", d?.second ?: JSONObject.NULL).put("iv", Crypto.b64(iv)).apply { if (posts.getOrNull(i) == true) put("post", true) })
        }
        val body = if (text.isNotEmpty()) sealFor(other, text) else ""
        val r = Sb.insert("messages", JSONObject().put("sender_id", me).put("recipient_id", other).put("body", body).put("media", media), select = "id, sender_id, recipient_id, body, media, created_at, read_at")
        val row = r.one ?: throw IllegalStateException(r.error?.message ?: "send")
        return DmMsg.of(row)
    } catch (e: Exception) {
        if (paths.isNotEmpty()) app.scope.launch { Sb.remove("dm-media", paths) }
        throw e
    }
}

fun Online.threadPush(other: String, m: JSONObject) {
    val k = "thread:$uid:$other"
    val arr = ((Cache.read(k)?.v as? JSONArray)?.objs() ?: emptyList()).filter { it.optLong("id") != m.optLong("id") } + m
    Cache.write(k, JSONArray(arr.takeLast(100)))
}
fun Online.threadDrop(other: String, id: Long) {
    val k = "thread:$uid:$other"
    (Cache.read(k)?.v as? JSONArray)?.let { a -> Cache.write(k, JSONArray(a.objs().filter { it.optLong("id") != id })) }
}
private fun Online.inboxDrop(other: String, id: Long) {
    val list = dm.inbox ?: cachedInbox() ?: return
    val rest = ((Cache.read("thread:$uid:$other")?.v as? JSONArray)?.objs() ?: emptyList()).filter { it.optLong("id") != id }
    val out = list.map { cv ->
        if (cv.other != other || cv.last?.optLong("id") != id) cv
        else if (rest.isEmpty()) { keptAdd(other); Convo(cv.other, cv.name, cv.avatar, 0, null) }
        else { val l = rest.last(); Convo(cv.other, cv.name, cv.avatar, cv.unread, JSONObject().put("id", l.opt("id")).put("body", l.optString("body")).put("media", l.opt("media")).put("created_at", l.optString("created_at")).put("sender_id", l.optString("sender_id"))) }
    }
    dm.inbox = out
    Cache.write("inbox:$uid", JSONArray(out.map { it.json() }))
}

fun Online.deleteDm(m: DmMsg, other: String) {
    val id = m.id ?: return
    val paths = (0 until m.media.length()).mapNotNull { Sb.pathOf(m.media.optJSONObject(it)?.optString("url"), "dm-media") }
    dm.live?.rows?.remove(m)
    app.scope.launch {
        val r = Sb.delete(Q("messages").eq("id", id), select = "id")
        if (!r.ok || r.rows.isEmpty()) { app.say(if (!r.ok) "Could not delete that message. " + plainErr(r.error?.message, "Try again") else "Could not delete that message"); dm.live?.let { if (it.id == other) refreshLive(it, full = true) }; return@launch }
        threadDrop(other, id); inboxDrop(other, id)
        if (paths.isNotEmpty()) Sb.remove("dm-media", paths)
    }
    // the opened copies of its photos do not stay on the phone
    Photos.cacheDir?.let { dir -> (0 until m.media.length()).forEach { i -> m.media.optJSONObject(i)?.optString("url")?.let { u -> runCatching { File(dir, "dm/" + Crypto.sha1Hex(u).lowercase()).delete() } } } }
}

// deleteDmMedia(): one photo of a message of mine goes; the message goes too when nothing is left in it
suspend fun Online.deleteDmMedia(m: DmMsg, i: Int, other: String): Boolean {
    val id = m.id ?: return false
    val path = Sb.pathOf(m.media.optJSONObject(i)?.optString("url"), "dm-media")
    val r = Sb.rpc("remove_dm_media", JSONObject().put("p_msg", id).put("p_idx", i))
    if (!r.ok) { app.say("Could not delete that photo"); return false }
    path?.let { app.scope.launch { Sb.remove("dm-media", listOf(it)) } }
    val d = r.data as? JSONObject
    if (d?.optBoolean("deleted") == true) { threadDrop(other, id); inboxDrop(other, id); dm.live?.rows?.remove(m) }
    else d?.optJSONArray("media")?.let { m.media = it }
    app.say("Photo deleted")
    return true
}

// ---- the open chat ----

fun Online.openDm(id: String) = app.go(Route.Dm(id))

// pull() / pullNew(): the full newest 300 now and then, otherwise only the rows after the newest one here
suspend fun Online.refreshLive(l: LiveDm, full: Boolean = false) {
    val me = uid ?: return
    val small = !full && l.fullAt > 0 && System.currentTimeMillis() - l.fullAt < 30_000
    val rows: List<JSONObject>
    var prune = false
    if (small) {
        val after = l.known.maxOfOrNull { it.optLong("id") } ?: 0
        val nw = runCatching { dmThreadAfter(l.id, after) }.getOrElse { return refreshLive(l, true) }
        val have = l.known.map { it.optLong("id") }.toSet()
        val add = nw.filter { it.optLong("id") !in have }
        if (add.isEmpty()) return
        l.known = (l.known + add).takeLast(300)
        rows = add
    } else {
        rows = try { dmThread(l.id) } catch (e: Exception) { if (l.rows.isEmpty()) l.failed = true; return }
        l.known = rows; l.fullAt = System.currentTimeMillis(); prune = true
    }
    if (dm.live !== l) return
    Cache.write("thread:$me:${l.id}", JSONArray(l.known.takeLast(100)))
    syncRows(l, rows, prune, initial = false)
}

// syncRows(): new rows go in, changed ones are opened again, and (on a full pull) rows the server no longer has fold away
suspend fun Online.syncRows(l: LiveDm, rows0: List<JSONObject>, prune: Boolean, initial: Boolean) {
    val me = uid ?: return
    val rows = rows0.filter { visible(it, l.id) }.map { DmMsg.of(it) }
    if (prune) { val ids = rows.mapNotNull { it.id }.toSet(); l.rows.removeAll { it.id != null && it.id !in ids && !it.tmp } }
    val have = l.rows.filter { it.id != null }.associateBy { it.id }
    val fresh = rows.filter { it.id !in have }
    val changed = rows.filter { r -> have[r.id]?.let { it.sig() != r.sig() } == true }
    signBatch(fresh.flatMap { m -> (0 until m.media.length()).mapNotNull { m.media.optJSONObject(it) } })
    openRows(fresh + changed, l.id)
    changed.forEach { r -> val old = have[r.id] ?: return@forEach; val at = l.rows.indexOf(old); if (at >= 0) l.rows[at] = r }
    fresh.forEach { m ->
        if (l.rows.any { it.id == m.id }) return@forEach
        if (m.sender != me && !initial) { m.fresh = true; l.typing = false }
        val at = l.rows.indexOfFirst { it.t > m.t && !it.tmp }
        if (at < 0) l.rows.add(m) else l.rows.add(at, m)
    }
    l.loaded = true; l.failed = false
    val unread = rows.filter { it.recipient == me && it.readAt == null }.mapNotNull { it.id }
    if (unread.isNotEmpty()) markRead(unread, l.id)
}

// dmV(): opening a chat shows what this phone has at once, then the newest from the server, and polls as a safety net
fun Online.openLive(other: String): LiveDm {
    val me = uid
    dm.live?.let { if (it.id == other) return it }
    val l = LiveDm(other)
    dm.live = l
    if (dm.locked) promptUnlock()
    app.scope.launch { runCatching { sharedKeyFast(other) } }
    app.scope.launch { acctsFor(listOf(other)); loadSocial() }
    app.scope.launch { l.locked = dmLockText(other) ?: "" }
    app.scope.launch {
        (Cache.read("thread:$me:$other")?.v as? JSONArray)?.objs()?.let { if (it.isNotEmpty()) syncRows(l, it, prune = false, initial = true) else l.loaded = true }
        refreshLive(l, full = true)
        Sb.update(Q("notifications").eq("user_id", me ?: "").eq("actor_id", other).eq("kind", "message").isNull("read_at"), JSONObject().put("read_at", isoNow()))
        refreshBadge(false)
        var statusAt = System.currentTimeMillis()
        while (dm.live === l) {
            delay(5000)
            if (dm.live !== l) break
            if (!app.foreground) continue
            runCatching { refreshLive(l) }
            if (System.currentTimeMillis() - statusAt > 60_000) { statusAt = System.currentTimeMillis(); l.locked = dmLockText(other) ?: l.locked }
        }
    }
    return l
}
fun Online.closeLive(l: LiveDm) { if (dm.live === l) { dm.live = null; sendTyping(l.id, false) } }

// doSend(): the bubble shows at once; a send whose answer was lost is checked before the text is given back
suspend fun Online.doSendDm(l: LiveDm, text: String, srcs: List<String>): Boolean {
    val me = uid ?: return false
    val tmp = DmMsg(null, me, l.id, text, JSONArray(srcs.map { JSONObject().put("url", it) }), isoNow(), null).apply { this.text = text; this.tmp = true; fresh = true }
    l.rows.add(tmp)
    sendTyping(l.id, false)
    return try {
        firstUrl(text)?.let { u -> if (s.previews[u]?.has("v") != true) kotlinx.coroutines.withTimeoutOrNull(4500) { getPreview(u) } }
        val saved = sendDm(l.id, text, srcs)
        if (isOwner() && text.contains("@zenith", true)) app.scope.launch { zenInDm(l, text, srcs) }
        landed(l, tmp, saved, text)
        true
    } catch (e: Exception) {
        if (srcs.isEmpty()) runCatching {
            val rows = dmThread(l.id)
            rows.filter { it.optString("sender_id") == me && System.currentTimeMillis() - parseIso(it.optString("created_at")) < 120_000 && l.rows.none { r -> r.id == it.optLong("id") } }.reversed().forEach { m ->
                if (openText(l.id, m.optString("body")) == text) { landed(l, tmp, DmMsg.of(m), text); return true }
            }
        }
        l.rows.remove(tmp)
        app.say("Could not send. " + plainErr(e.message, "Try again"))
        l.locked = dmLockText(l.id) ?: l.locked
        false
    }
}
private fun Online.landed(l: LiveDm, tmp: DmMsg, saved: DmMsg, text: String) {
    threadPush(l.id, saved.json())
    saved.text = text; saved.fresh = true
    // the bubble that is already on screen stays (with the photos as they were picked), now with the server's id
    if (tmp.media.length() > 0 && saved.media.length() == tmp.media.length()) {
        val dir = Photos.cacheDir?.let { File(it, "dm").apply { mkdirs() } }
        if (dir != null) for (i in 0 until tmp.media.length()) runCatching {
            File(tmp.media.getJSONObject(i).getString("url")).copyTo(File(dir, Crypto.sha1Hex(saved.media.getJSONObject(i).getString("url")).lowercase()), true)
        }
    }
    l.known = (l.known.filter { it.optLong("id") != saved.id } + saved.json()).takeLast(300)
    val at = l.rows.indexOf(tmp)
    l.rows.removeAll { it.id == saved.id }
    if (at >= 0 && at <= l.rows.size) { l.rows.remove(tmp); l.rows.add(minOf(at, l.rows.size), saved) } else l.rows.add(saved)
    app.scope.launch { runCatching { warmInbox() } }
}

// ---- typing ----

// sendTyping(): typing signals go on the other person's private channel, at most every 2 s
fun Online.sendTyping(other: String, on: Boolean) {
    val me = uid ?: return
    var o = dm.typeOut[other]
    if (o == null) {
        val ch = Rt.channel("tp-$other", private = true)
        o = ch to longArrayOf(0, 0, System.currentTimeMillis())
        dm.typeOut[other] = o
        ch.subscribe { st -> if (st != Rt.St.SUBSCRIBED) { if (dm.typeOut[other]?.first === ch) dm.typeOut.remove(other); Rt.remove(ch) } }
        if (dm.typeOut.size > 8) dm.typeOut.keys.first().let { k -> if (k != other) dm.typeOut.remove(k)?.let { Rt.remove(it.first) } }
    }
    val st = o.second
    st[2] = System.currentTimeMillis()
    val now = System.currentTimeMillis()
    if (on) { if (now - st[0] < 2000) return; st[0] = now; st[1] = 1 } else { if (st[1] == 0L) return; st[1] = 0; st[0] = 0 }
    o.first.send("typing", JSONObject().put("from", me).put("on", on))
}

// onTyping(): only people this person already chats with are believed, and a sender that floods is not shown
private val typeSeen = HashMap<String, Long>()
fun Online.onTyping(from: String?, on: Boolean?) {
    val me = uid ?: return
    if (from == null || from == me || !UUID_RE.matches(from)) return
    if ((dm.inbox ?: cachedInbox())?.any { it.other == from } != true) return
    val now = System.currentTimeMillis()
    if (now - (typeSeen[from] ?: 0) < 400) return
    typeSeen[from] = now
    if (dm.muteSet.containsKey(from) || from in dm.hideSet) return
    // an off signal hides the dots 1.6 s later, like the web app
    if (on == false) {
        if (dm.typingIn.containsKey(from)) { dm.typingIn[from] = now + 1600; app.scope.launch { delay(1650); typingExpire(from) } }
        return
    }
    dm.typingIn[from] = now + 4500; dm.typingFlag[from] = true
    dm.live?.let { if (it.id == from) it.typing = true }
    app.scope.launch { delay(4600); typingExpire(from) }
}
private fun Online.typingExpire(from: String) {
    val until = dm.typingIn[from] ?: return
    if (System.currentTimeMillis() >= until) { dm.typingIn.remove(from); dm.typingFlag.remove(from); dm.live?.let { if (it.id == from) it.typing = false } }
}
fun Online.isTyping(id: String): Boolean = (dm.typingIn[id] ?: 0) > System.currentTimeMillis()

// ---- muting, hiding, pinning, nicknames, deleting a chat ----

fun Online.dmMuted(id: String): Boolean { if (id in dm.hideSet) return true; val u = dm.muteSet[id] ?: return false; return u == 0L || u > System.currentTimeMillis() }

suspend fun Online.loadDmMutes(force: Boolean = false) {
    val me = uid ?: return
    if (dm.mutesAt == 0L) (Cache.read("dmmutes:$me")?.v as? JSONObject)?.let { c ->
        c.optJSONArray("m")?.let { a -> for (i in 0 until a.length()) a.optJSONArray(i)?.let { dm.muteSet[it.optString(0)] = it.optLong(1) } }
        c.optJSONArray("h")?.strings()?.let { dm.hideSet.addAll(it) }
    }
    if (!force && System.currentTimeMillis() - dm.mutesAt < 15_000) return
    dm.mutesAt = System.currentTimeMillis()
    val r = Sb.get(Q("dm_mutes").select("target_id, until_at, hidden").eq("owner_id", me))
    if (!r.ok) return
    dm.muteSet.clear(); dm.hideSet.clear()
    r.rows.forEach { x -> if (x.optBoolean("hidden")) dm.hideSet.add(x.optString("target_id")) else dm.muteSet[x.optString("target_id")] = x.optStr("until_at")?.let { parseIso(it) } ?: 0 }
    Cache.write("dmmutes:$me", JSONObject().put("m", JSONArray(dm.muteSet.map { JSONArray().put(it.key).put(it.value) })).put("h", JSONArray(dm.hideSet.toList())))
}

fun Online.dmMenu(other: String, name: String, inChat: Boolean) {
    val me = uid ?: return
    app.scope.launch {
        val blocked = kotlinx.coroutines.withTimeoutOrNull(3000) { Sb.get(Q("blocks").select("blocked_id").eq("blocker_id", me).eq("blocked_id", other)).one != null } ?: false
        val hidden = other in dm.hideSet
        val muted = !hidden && dmMuted(other)
        val pinned = other in s.dmPins
        val items = ArrayList<SheetItem>()
        items.add(SheetItem(if (pinned) "Unpin chat" else "Pin chat", "pin") {
            s.dmPins.remove(other); if (!pinned) s.dmPins.add(0, other)
            while (s.dmPins.size > 5) s.dmPins.removeAt(s.dmPins.lastIndex)
            app.persist(); app.say(if (pinned) "Unpinned" else "Pinned to the top")
        })
        items.add(SheetItem("Nickname", "edit") { app.panels.add(Panel.Nickname(other, name)) })
        if (hidden) items.add(SheetItem("Unhide chat", "eyeoff") {
            app.scope.launch { val r = Sb.delete(Q("dm_mutes").eq("owner_id", me).eq("target_id", other)); if (!r.ok) { app.say("Could not unhide chat"); return@launch }; dm.hideSet.remove(other); refreshBadge(false); app.say("Chat unhidden") }
        }) else items.add(SheetItem(if (muted) "Unmute messages" else "Mute messages", "bellOff") {
            if (muted) app.scope.launch {
                val r = Sb.delete(Q("dm_mutes").eq("owner_id", me).eq("target_id", other))
                if (!r.ok) { app.say("Could not update mute"); return@launch }
                dm.muteSet.remove(other); refreshBadge(false); app.say("Messages unmuted")
            } else {
                val h = 3_600_000L
                fun set(ms: Long, label: String) = app.scope.launch {
                    val r = Sb.upsert("dm_mutes", JSONObject().put("owner_id", me).put("target_id", other).put("until_at", if (ms > 0) isoOf(System.currentTimeMillis() + ms) else JSONObject.NULL).put("hidden", false), "owner_id,target_id")
                    if (!r.ok) { app.say("Could not update mute"); return@launch }
                    dm.muteSet[other] = if (ms > 0) System.currentTimeMillis() + ms else 0
                    refreshBadge(false); app.say("Messages muted $label")
                }
                app.open(listOf(
                    SheetItem("For 1 hour", "bellOff") { set(h, "for 1 hour") },
                    SheetItem("For 8 hours", "bellOff") { set(8 * h, "for 8 hours") },
                    SheetItem("For 1 day", "bellOff") { set(24 * h, "for 1 day") },
                    SheetItem("For 1 week", "bellOff") { set(168 * h, "for 1 week") },
                    SheetItem("Until I turn it back on", "bellOff") { set(0, "until you turn it back on") },
                    SheetItem("Cancel", cancel = true)), "Mute messages")
            }
        })
        if (!hidden) items.add(SheetItem("Hide chat", "eyeoff") {
            app.scope.launch {
                val r = Sb.upsert("dm_mutes", JSONObject().put("owner_id", me).put("target_id", other).put("until_at", JSONObject.NULL).put("hidden", true), "owner_id,target_id")
                if (!r.ok) { app.say("Could not hide chat"); return@launch }
                dm.hideSet.add(other); dm.muteSet.remove(other); refreshBadge(false)
                if (inChat) app.pop()
                app.say("Chat hidden. Unhide it in Settings")
            }
        })
        items.add(SheetItem("Delete chat", "trash", danger = true) { app.confirm("Delete this chat for you? The other person keeps theirs.", "Delete chat") { deleteChat(other, inChat) } })
        items.add(SheetItem(if (blocked) "Unblock" else "Block", "close", danger = !blocked) { app.scope.launch { app.say(if (setBlocked(other, !blocked)) (if (blocked) "Unblocked" else "Blocked") else "Could not update block") } })
        app.open(items, nickOf(other).ifEmpty { name })
    }
}

suspend fun Online.saveNickname(other: String, v0: String): Boolean {
    val me = uid ?: return false
    val v = v0.trim().take(30)
    val r = if (v.isNotEmpty()) Sb.upsert("nicknames", JSONObject().put("owner_id", me).put("target_id", other).put("nickname", v), "owner_id,target_id")
    else Sb.delete(Q("nicknames").eq("owner_id", me).eq("target_id", other))
    if (!r.ok) { app.say("Could not save nickname"); return false }
    if (v.isNotEmpty()) nickMap[other] = v else nickMap.remove(other)
    Cache.write("nicks:$me", JSONObject(nickMap as Map<*, *>)); nickVersion++
    app.say(if (v.isNotEmpty()) "Nickname saved" else "Nickname removed")
    return true
}

// deleteChat(): only this person's view is cleared; the messages stay for the other person
fun Online.deleteChat(other: String, inChat: Boolean) = app.scope.launch {
    val r = Sb.rpc("clear_chat", JSONObject().put("p_other", other))
    if (!r.ok) { app.say("Could not delete chat"); return@launch }
    loadSocial(true)
    Cache.remove("thread:$uid:$other")
    keptDel(other)
    dm.inbox = (dm.inbox ?: cachedInbox())?.filter { it.other != other }
    dm.inbox?.let { Cache.write("inbox:$uid", JSONArray(it.map { c -> c.json() })) }
    refreshBadge(false)
    if (inChat) app.pop()
    app.say("Chat deleted")
}

// ---- who a post or a link can be sent to (messageTargets) ----

class Target(val note: Boolean, val id: String, val name: String, val avatar: String?)
suspend fun Online.messageTargets(): List<Target> {
    val out = ArrayList<Target>()
    s.chats.filter { it.isNotes }.forEach { out.add(Target(true, it.id, it.name, null)) }
    val me = uid ?: return out
    // the follow and block lists are kept for a minute, so sharing again at once does not fetch them again
    if (dm.targetsUser != me || System.currentTimeMillis() - dm.targetsAt > 60_000) {
        val a = Sb.pageAll { Q("follows").select("followee_id").eq("follower_id", me).order("followee_id") }
        val b = Sb.pageAll { Q("follows").select("follower_id").eq("followee_id", me).order("follower_id") }
        val k1 = Sb.pageAll { Q("blocks").select("blocked_id").eq("blocker_id", me).order("blocked_id") }
        val k2 = Sb.pageAll { Q("blocks").select("blocker_id").eq("blocked_id", me).order("blocker_id") }
        val mineF = a.rows.map { it.optString("followee_id") }.toSet()
        val hidden = k1.rows.map { it.optString("blocked_id") }.toSet() + k2.rows.map { it.optString("blocker_id") }
        dm.targetIds = b.rows.map { it.optString("follower_id") }.filter { it in mineF && it !in hidden }
        if (a.ok && b.ok && k1.ok && k2.ok) { dm.targetsAt = System.currentTimeMillis(); dm.targetsUser = me }
    }
    val ids = dm.targetIds
    if (ids.isNotEmpty()) {
        loadSocial()
        val m = cachedAccounts(ids)
        ids.forEach { id -> val x = m.get(id); out.add(Target(false, id, nickOf(id).ifEmpty { x?.optString("display_name")?.ifEmpty { null } ?: x?.optString("username") ?: "user" }, x?.optStr("avatar"))) }
    }
    return out
}

fun Online.chooseTarget(targets: List<Target>, send: (Target) -> Unit) {
    app.open(targets.map { t -> SheetItem(if (t.note) t.name + " (notes)" else t.name, if (t.note) "edit" else null, av = if (t.note) null else Author(t.id, t.name, "", t.avatar)) { send(t) } } + SheetItem("Cancel", cancel = true), "Send to")
}

// the open message channels go when the account leaves
fun Online.stopRealtime() {
    Rt.removeAll()
    dm.rtChan = null; dm.delChan = null; dm.tpChan = null
    dm.typeOut.clear()
}

// startRealtime(): new messages, notifications, bans and mod notices arrive by themselves; deleted messages and typing
// come on private channels
fun Online.startRealtime() {
    val me = uid ?: return
    if (dm.rtChan != null) return
    dm.rtChan = Rt.channel("nook-$me")
        .onInsert("messages", "recipient_id=eq.$me") { onIncomingMsg(it) }
        .onInsert("notifications", "user_id=eq.$me") { onIncomingNote(it) }
        .onInsert("bans", "user_id=eq.$me") { showBanned(Sb.user?.email) }
        .onInsert("mod_notices", "user_id=eq.$me") { showModNotice(it) }
        .subscribe { st -> dm.rtOk = st == Rt.St.SUBSCRIBED }
    dm.delChan = Rt.channel("dmdel-$me", private = true).onBroadcast("del") { p -> onDeletedMsg(p.optLong("id")) }.subscribe()
    dm.tpChan = Rt.channel("tp-$me", private = true).onBroadcast("typing") { p -> onTyping(p.optStr("from"), if (p.has("on")) p.optBoolean("on") else null) }.subscribe()
}

private fun Online.onIncomingMsg(m: JSONObject) {
    val from = m.optString("sender_id")
    refreshBadge(false)
    app.scope.launch { runCatching { warmInbox() } }
    dm.live?.let { l -> if (l.id == from) { app.scope.launch { threadPush(from, m); l.known = (l.known + m).takeLast(300); syncRows(l, listOf(m), prune = false, initial = false) }; return } }
    if (dmMuted(from)) return
    app.scope.launch {
        acctsFor(listOf(from)); loadSocial()
        val a = acctCache[from]
        val t = zUn(openText(from, m.optString("body"), true))
        app.alert(nickOf(from).ifEmpty { a?.optString("name") ?: "user" }, dmGist(t, m.optJSONArray("media") ?: JSONArray(), false), "dm:$from")
    }
}

val NOTE_WHAT = mapOf("follow" to "followed you", "reply" to "replied to your post", "like" to "liked your post", "repost" to "reposted your post", "message" to "sent you a message", "post" to "posted something new")
private fun Online.onIncomingNote(n: JSONObject) {
    refreshBadge(true)
    if (n.optString("kind") == "message") return
    app.scope.launch {
        val actor = n.optString("actor_id")
        acctsFor(listOf(actor)); loadSocial()
        app.alert(nickOf(actor).ifEmpty { acctCache[actor]?.optString("name") ?: "user" }, NOTE_WHAT[n.optString("kind")] ?: "", "notifs")
    }
}

private fun Online.onDeletedMsg(id: Long) {
    if (id == 0L) return
    dm.live?.let { l -> l.rows.firstOrNull { it.id == id }?.let { m -> l.rows.remove(m); threadDrop(l.id, id) } }
    app.scope.launch { delay(300); refreshBadge(false); runCatching { warmInbox() } }
}

// ---- the bell and the chats number ----

private var badgeJob: kotlinx.coroutines.Job? = null
private var badgeNotifAt = 0L
private var badgeForce = false
fun Online.refreshBadge(force: Boolean) {
    if (force) badgeForce = true
    badgeJob?.cancel()
    badgeJob = app.scope.launch {
        delay(400)
        val me = uid ?: return@launch
        val f = badgeForce; badgeForce = false
        if (f || System.currentTimeMillis() - badgeNotifAt > 30_000) {
            badgeNotifAt = System.currentTimeMillis()
            val a = Sb.count(Q("notifications").select("id").eq("user_id", me).neq("kind", "message").isNull("read_at"))
            if (a.ok) unreadN = a.count ?: 0
        }
        loadDmMutes(f)
        val r = Sb.rpc("dm_inbox")
        if (!r.ok) return@launch
        unreadPeople = r.rows.filter { it.optInt("unread") > 0 }.map { it.optString("other_id") }.filter { !dmMuted(it) }.toSet().size
    }
}

// ---- notifications ----

class Note(val id: String, val actor: String, val kind: String, val post: String?, val created: String, val read: Boolean)
suspend fun Online.loadNotes(): List<Note>? {
    val me = uid ?: return null
    val r = Sb.get(Q("notifications").select("id, actor_id, kind, post_id, created_at, read_at").eq("user_id", me).neq("kind", "message").order("created_at", false).limit(100))
    loadSocial()
    if (!r.ok) return null
    val out = r.rows.map { Note(it.optString("id"), it.optString("actor_id"), it.optString("kind"), it.optStr("post_id"), it.optString("created_at"), !it.isNull("read_at")) }
    acctsFor(out.map { it.actor })
    app.scope.launch { Sb.update(Q("notifications").eq("user_id", me).neq("kind", "message").isNull("read_at"), JSONObject().put("read_at", isoNow())); refreshBadge(true) }
    return out
}
suspend fun Online.deleteNote(id: String): Boolean { val r = Sb.delete(Q("notifications").eq("id", id)); if (!r.ok) app.say("Could not delete"); return r.ok }
fun Online.openNote(n: Note) {
    if (n.kind == "message") { openDm(n.actor); return }
    val post = n.post
    if (post != null && n.kind != "follow") {
        openNotePost(post)
        return
    }
    app.go(Route.User(n.actor))
}

// a post this phone does not have yet (a reply of somebody, a new post of a person you follow) is fetched and opened
fun Online.openNotePost(id: String) {
    s.byRemote(id)?.let { app.go(Route.Thread(it.id)); return }
    app.scope.launch { runCatching { openSharedPost(id) }.onFailure { app.say("Could not open this post") } }
}

// ---- a shared post, opened from a chat ----

suspend fun Online.loadRPost(id: String, hint: String?): JSONObject? {
    if (dm.rp.containsKey(id)) return dm.rp[id]
    val r = Sb.get(Q("posts").select("id, user_id, body, media_url, created_at").eq("id", id))
    if (!r.ok) throw IllegalStateException("load")
    val d = r.one ?: run { dm.rp[id] = null; return null }
    val a = cachedAccounts(listOfNotNull(d.optString("user_id"), hint).distinct()).get(d.optString("user_id"))
    val out = JSONObject().put("text", d.optString("body")).put("t", parseIso(d.optString("created_at"))).put("imgs", JSONArray(parseMedia(d.opt("media_url")).take(4)))
        .put("name", a?.optString("display_name")?.ifEmpty { null } ?: a?.optString("username") ?: "user").put("handle", a?.optString("username") ?: "user").put("avatar", a?.optStr("avatar") ?: JSONObject.NULL)
    dm.rp[id] = out
    return out
}

// openSharedPost(): the real post, with its replies; a post this phone does not have yet is fetched first and kept for a day
suspend fun Online.openSharedPost(id: String) {
    var local = s.byRemote(id)
    if (local == null) {
        val cols = "id, user_id, body, media_url, created_at, parent_id"
        val pq = postsGet(cols) { Q("posts").select(it).eq("id", id) }
        val rq = postsGet(cols) { Q("posts").select(it).eq("parent_id", id).order("created_at").limit(100) }
        if (!pq.ok || !rq.ok) throw IllegalStateException("load")
        val top = pq.one ?: run { app.say("This post is not available"); return }
        val rows = listOf(top) + rq.rows
        val who = cachedAccounts(rows.map { it.optString("user_id") }.distinct())
        val have = s.posts.mapNotNull { it.remote }.toSet()
        val now = System.currentTimeMillis()
        rows.filter { it.optString("id") !in have }.forEach { r ->
            val a = who.get(r.optString("user_id")) ?: JSONObject().put("username", "user")
            s.posts.add(LPost("r" + r.optString("id"), r.optString("body"), parseIso(r.optString("created_at")), parseMedia(r.opt("media_url")), if (r.optString("id") == id) null else "r$id",
                remote = r.optString("id"), ra = Author(r.optString("user_id"), a.optString("display_name").ifEmpty { a.optString("username").ifEmpty { "user" } }, a.optString("username"), a.optStr("avatar"))).apply {
                rp = if (r.optString("id") == id) rows.size - 1 else 0; sharedAt = now; edited = r.optStr("edited_at") != null
            })
        }
        app.persist()
        local = s.byRemote(id)
    }
    if (local == null) { app.say("This post is not available"); return }
    app.go(Route.Thread(local.id))
}

// sharePost(): as a new post (a picture of it), to a person (as a reference to the post), into notes, or to another app
fun Online.sharePost(p: LPost) {
    app.scope.launch {
        val targets = runCatching { messageTargets() }.getOrDefault(emptyList())
        val items = ArrayList<SheetItem>()
        items.add(SheetItem("Post", "edit") { app.say("Making picture..."); app.sharePicture(p, true) })
        if (targets.isNotEmpty()) items.add(SheetItem("Message", "chat") {
            chooseTarget(targets) { t ->
                app.scope.launch {
                    val me = uid
                    when {
                        p.ai && !t.note -> try { val pu = zenPfpUrl(); sendDm(t.id, ZPOST + JSONObject().put("x", p.text).put("t", p.t).apply { if (pu != null) put("a", pu) }); app.say("Sent to " + t.name) } catch (e: Exception) { app.say("Could not send") }
                        p.remote != null && !t.note -> try { sendDm(t.id, RPOST + JSONObject().put("id", p.remote).put("u", p.ra?.id ?: me)); countShare(p); app.say("Sent to " + t.name) } catch (e: Exception) { app.say("Could not send. " + plainErr(e.message, "Try again")) }
                        t.note -> {
                            val chat = s.chats.firstOrNull { it.id == t.id } ?: return@launch
                            val m = when {
                                p.ai -> LMsg(uid(), "", System.currentTimeMillis(), emptyList(), zpost = ZPost(p.text.take(600), p.t, runCatching { zenPfpUrl() }.getOrNull()))
                                p.remote != null -> { countShare(p); LMsg(uid(), "", System.currentTimeMillis(), emptyList(), rpost = RPost(p.remote!!, p.ra?.id ?: me)) }
                                else -> LMsg(uid(), p.text, System.currentTimeMillis(), p.imgs)
                            }
                            chat.msgs.add(m); app.persist(); app.say("Saved in " + t.name)
                        }
                        else -> app.sharePictureTo(p) { f -> app.scope.launch { try { sendDm(t.id, "", listOf(f), listOf(true)); app.say("Sent to " + t.name) } catch (e: Exception) { app.say("Could not send") } } }
                    }
                }
            }
        })
        items.add(SheetItem("Another app", "share") { app.say("Making picture..."); app.sharePicture(p, false); countShare(p) })
        items.add(SheetItem("Cancel", cancel = true))
        app.open(items, "Share post")
    }
}
