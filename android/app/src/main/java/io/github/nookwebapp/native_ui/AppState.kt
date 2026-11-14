package io.github.nookwebapp.native_ui

import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.SupervisorJob

// Every page the web app has (its VIEWS table), as routes on a stack like the web app's stack[].
sealed interface Route {
    data object Auth : Route
    data object Home : Route
    data object Chats : Route
    data object Saved : Route
    data object Profile : Route
    data object Settings : Route
    data object Lists : Route
    data object Search : Route
    data object Notifs : Route
    data object AccountInfo : Route
    data object Blocked : Route
    data object Hidden : Route
    data object Banned : Route
    data object Age : Route
    // Zenith's own page, opened from the menu (his profile, as a first page)
    data object Zen : Route
    data class Thread(val id: String) : Route
    data class Conv(val id: String) : Route
    data class Dm(val id: String) : Route
    data class User(val id: String) : Route
    data class Tag(val q: String) : Route
    data class ListPage(val id: String) : Route
    data class Follows(val id: String, val followers: Boolean) : Route
    data class Legal(val terms: Boolean) : Route
}

// one row of a sheet; cancel rows are drawn at the bottom as the bold Cancel button; keep rows leave the sheet open.
// av puts a person's round picture in front instead of an icon, trail an icon at the end (the lock of a linked account)
data class SheetItem(
    val label: String, val icon: String? = null, val danger: Boolean = false, val on: Boolean = false,
    val cancel: Boolean = false, val left: Boolean = false, val keep: Boolean = false, val av: Author? = null, val trail: String? = null, val fn: () -> Unit = {},
)
data class SheetSpec(val items: List<SheetItem>, val title: String? = null, val onDone: (() -> Unit)? = null)

// full screen panels that slide up over everything (.ov), stacked: the cropper opens over the profile editor
sealed interface Panel {
    data class Compose(val parent: String? = null, val edit: String? = null, val pick: String? = null, val files: List<String> = emptyList(), val text: String = "") : Panel
    data object EditProfile : Panel
    data class ListForm(val list: LList?, val after: ((LList) -> Unit)? = null) : Panel
    data class RenameChat(val chat: LChat) : Panel
    data class Crop(val src: String, val round: Boolean, val w: Int, val h: Int, val title: String, val done: (String?) -> Unit) : Panel
    data object AddAccount : Panel
    data object NewAccount : Panel
    data class LinkedLogin(val x: SavedAcct) : Panel
    data object NewPassword : Panel
    // the call with Zenith (owner only); still is only used by the screenshot tests, a phase name that freezes the screen
    data class Call(val still: String? = null) : Panel
    data class Recover(val prefill: String) : Panel
    data class RecoverCode(val prefill: String) : Panel
    data object ChangePassword : Panel
    data object ChangeEmail : Panel
    data object Deactivate : Panel
    data object TotpSetup : Panel
    data object TotpOff : Panel
    data object WaitApproval : Panel
    data class RestoreKeys(val login: Boolean) : Panel
    data class ApproveLink(val id: String, val pub: String) : Panel
    data class BackupSetup(val changing: Boolean) : Panel
    data object StartSaving : Panel
    data class Nickname(val other: String, val name: String) : Panel
    data object DeleteAccount : Panel
    data object BanDownload : Panel
    data object ZenEdit : Panel
}

// .sheet.warn: a notice that has to be read (a post taken down, posting paused, an email in a public post)
class Warn(val title: String, val body: String, val mail: String? = null, val wait: Int = 0, val onDone: () -> Unit = {}) {
    var extra by mutableStateOf("")
}

data class Toast(val msg: String, val label: String? = null, val fn: (() -> Unit)? = null, val n: Long = System.nanoTime())
data class Viewer(val imgs: List<String>, val index: Int, val cap: String? = null, val del: (suspend (Int) -> Boolean)? = null)

enum class Dir { Fwd, Back, Root }

class AppState(val store: Store = Store(null), start: Route? = null) {
    val stack = mutableStateListOf(start ?: if (store.signedIn) Route.Home else Route.Auth)
    var dir by mutableStateOf(Dir.Root)
    var sheet by mutableStateOf<SheetSpec?>(null)
    var drawer by mutableStateOf(false)
    val panels = mutableStateListOf<Panel>()
    var toast by mutableStateOf<Toast?>(null)
    // when the "/claude" mascots started (0 when they are not here), see ClaudeFx
    var fxAt by mutableLongStateOf(0L)
    var viewer by mutableStateOf<Viewer?>(null)
    val warns = mutableStateListOf<Warn>()
    // a post of Zenith opened from a chat
    var zcard by mutableStateOf<ZPost?>(null)
    // the post that was just written slides in (.post.fresh)
    var fresh by mutableStateOf<String?>(null)
    var authUp by mutableStateOf(false)
    // a line the sign in page shows once (the web app's nook-notice), and the email of a banned account for its download
    var notice by mutableStateOf<String?>(null)
    // "/media" cards: the download state of each
    val mdl = MediaDl.shared
    // the offline page: shown while the phone has no connection, or when the start could not be made for lack of one
    var online by mutableStateOf(true)
    var bootOffline by mutableStateOf(false)
    val offline get() = !online || bootOffline
    var banEmail by mutableStateOf("")
    // posting is paused: the sheet that says so
    var postLocked by mutableStateOf(false)
    // one prompt per start, like PH_NOW
    var ph: String = PH[(Math.random() * PH.size).toInt().coerceIn(0, PH.size - 1)]
    // what the phone does for the app (set by the activity): copy text, share or post a picture of a post, back up
    var clipboard: (String) -> Unit = {}
    var sharePicture: (LPost, Boolean) -> Unit = { _, _ -> }
    var sharePictureTo: (LPost, (String) -> Unit) -> Unit = { _, _ -> }
    var backup: () -> Unit = {}
    var checkUpdate: (Boolean) -> Unit = {}
    // the download of an update that was asked for by hand: 0..1, -1 when the size is not known, null when none runs
    var updProgress by mutableStateOf<Float?>(null)
    // true from the tap on "Check for updates" until the check has answered (a second tap in that time does nothing)
    var updBusy by mutableStateOf(false)
    // what the bar says while it fills: the download first, then the install
    var updPhase by mutableStateOf("Downloading the update")
    // messages of Zenith that were typed out on the screen: they land in the list without their entrance animation
    val zenNoAnim = HashSet<String>()
    var askNotifs: () -> Unit = {}
    var shareFile: (java.io.File, String) -> Unit = { _, _ -> }
    var ctx: android.content.Context? = null
    // the activity on screen (the fingerprint window needs one); weak, so a closed activity is never kept
    var activity: java.lang.ref.WeakReference<android.app.Activity>? = null
    // starts a window of Google Play services (the fingerprint) and hands back its answer; set by the activity
    var startForResult: (suspend (android.app.PendingIntent) -> androidx.activity.result.ActivityResult?)? = null
    var foreground: Boolean
        get() = fg
        set(v) { fg = v; if (v) ctx?.let { Notify.clearAll(it) } }
    private var fg by mutableStateOf(true)
    // bumped when notes or Zenith's chats changed from another phone, so the open pages draw again
    var notesVersion by mutableIntStateOf(0)
    var zenVersion by mutableIntStateOf(0)
    // the answer of Zenith that is being typed out, per chat
    val zenTyping = mutableStateMapOf<String, LMsg>()
    val settingsScroll = androidx.compose.foundation.ScrollState(0)
    // where each page on the stack was scrolled to, so going back lands on the same spot
    private val lists = mutableMapOf<Int, LazyListState>()
    // each open page keeps its own list state, found by the page's own place on the stack (never by whatever the stack is
    // at the moment of drawing: a page that is leaving would otherwise take the state of the page that is coming)
    fun listStateFor(page: Int): LazyListState = lists.getOrPut(page) { LazyListState() }
    fun listState(): LazyListState = lists.getOrPut(stack.size) { LazyListState() }

    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    var dm by mutableStateOf(DmState())
    val on = Online(this)

    val top: Route get() = stack.last()
    val rootRoute: Route get() = stack.first()
    val theme: ThemeMode get() = store.theme
    val signedIn: Boolean get() = on.me != null

    // a post and one reply opened from it is as deep as it goes (MAX_OPEN_POSTS)
    fun go(r: Route) {
        if (r is Route.Thread && stack.count { it is Route.Thread } >= 2) return
        dir = Dir.Fwd; stack.add(r); lists.remove(stack.size)
    }
    fun root(r: Route) { dir = Dir.Root; stack.clear(); stack.add(r); lists.clear() }
    fun pop() { if (stack.size > 1) { dir = Dir.Back; lists.remove(stack.size); stack.removeAt(stack.lastIndex) } }
    // the back button closes what is on top first: the viewer, a sheet, the menu, a panel, then the page
    fun back(): Boolean {
        when {
            viewer != null -> viewer = null
            sheet != null -> closeSheet()
            drawer -> drawer = false
            panels.isNotEmpty() -> panelBack()
            stack.size > 1 -> pop()
            // a page opened from the menu (settings, search, lists) or a tab is a page of its own: back goes home first
            signedIn && rootRoute != Route.Home && rootRoute != Route.Auth && rootRoute != Route.Banned && rootRoute != Route.Age -> root(Route.Home)
            else -> return false
        }
        return true
    }
    // a panel's own back behaviour (keep the draft, or say no to the crop) is set by the panel while it is open
    val panelBackHooks = mutableMapOf<Panel, () -> Unit>()
    fun panelBack() { val p = panels.lastOrNull() ?: return; panelBackHooks.remove(p)?.invoke(); panels.remove(p) }
    fun closePanel(p: Panel) { panelBackHooks.remove(p); panels.remove(p) }
    // the call with Zenith (owner only): it lives here, so closing the call screen does not end it
    var call by mutableStateOf<CallSession?>(null)
    // the card of the call is open over the app
    var callCard by mutableStateOf(false)
    // the chat the call was started from: its log is saved there when the call ends
    var callChatId: String? = null
    // asks for the microphone and answers whether it was given; set by the activity
    var askMic: ((Boolean) -> Unit) -> Unit = { it(false) }
    fun openCall() { callCard = false; if (panels.none { it is Panel.Call }) panels.add(Panel.Call()) }
    // Zenith is calling: the call is made ready while the phone rings, so Answer is heard at once
    fun prewarmCall(reason: String) {
        if (call != null) return
        val s = CallSession(scope, { updateCallNote() }, reason)
        s.ringing = true
        call = s
        s.startLive(this, hold = true)
        // the ringing lasts 30 seconds, a moment longer is waited for
        scope.launch { kotlinx.coroutines.delay(35_000); if (call === s && s.ringing) declineCall() }
    }
    fun declineCall() {
        val c = call ?: return
        if (!c.ringing) return
        c.stop(); call = null
        ctx?.let { IncomingCall.clear(it) }
        leave()
    }
    // set by the screen when the app was opened only to ring: after a decline it goes back to where the phone was
    var leave: () -> Unit = {}
    // reason: set when Zenith called (he says why he called); null when the owner called him
    fun startCall(reason: String? = null) {
        val ringing = call?.takeIf { it.ringing }
        if (call != null && ringing == null) { openCall(); return }
        val c = ctx ?: return
        if (androidx.core.content.ContextCompat.checkSelfPermission(c, android.Manifest.permission.RECORD_AUDIO) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            askMic { ok -> if (ok) startCall(reason) else say("Allow the microphone to call Zenith") }
            return
        }
        if (ringing != null) ringing.answer()
        else call = CallSession(scope, { updateCallNote() }, reason).also { it.startLive(this) }
        runCatching { androidx.core.content.ContextCompat.startForegroundService(c, android.content.Intent(c, CallService::class.java)) }
        // his picture goes into the notification as soon as it is read
        scope.launch(kotlinx.coroutines.Dispatchers.IO) { CallNote.loadAvatar(this@AppState); updateCallNote() }
        openCall()
    }
    // End: the sound stops at once, the screen plays its goodbye, then the call is gone
    fun endCall(animated: Boolean = true) {
        val c = call ?: return
        c.stop()
        saveCallLog(c)
        ctx?.let { x -> runCatching { x.stopService(android.content.Intent(x, CallService::class.java)) } }
        callCard = false
        if (!animated || c.ending || panels.none { it is Panel.Call }) { call = null; panels.removeAll { it is Panel.Call }; return }
        c.ending = true
        scope.launch { kotlinx.coroutines.delay(520); if (call === c) { call = null; panels.removeAll { it is Panel.Call } } }
    }
    // what was said is kept in the chat as a call message (only calls that really connected and had words in them)
    private fun saveCallLog(c: CallSession) {
        if (c.ringing || c.connectedAt == null || c.log.none { it.text.isNotBlank() }) { callChatId = null; return }
        runCatching {
            val chat = zenChat()
            val t = System.currentTimeMillis()
            val m = LMsg(uid(), callLogText(c.seconds, c.log), t, emptyList())
            chat.msgs.add(m)
            // he remembers the call too
            scope.launch(kotlinx.coroutines.Dispatchers.IO) { runCatching { Sb.fn("zenith", org.json.JSONObject().put("action", "log").put("entries", org.json.JSONArray().put(entryOf(m)))) } }
            chat.t = maxOf(chat.t, t)
            persist()
            on.zenSyncSoon()
            zenVersion++
        }
        callChatId = null
    }
    // the notification gets its timer when the call is picked up
    fun updateCallNote() {
        val c = ctx ?: return
        val s = call ?: return
        runCatching { androidx.core.app.NotificationManagerCompat.from(c).notify(CallNote.ID, CallNote.build(c, s.connectedAt)) }
    }
    // a page can set its own work for the pull down to refresh; without one the feed, the bell and the notes are read again
    var pullHook: (suspend () -> Unit)? = null
    suspend fun pullRefresh() {
        Sb.dropConnections()
        pullHook?.let { it(); return }
        on.feedTries = 0
        on.loadFeed()
        scope.launch { on.refreshBadge(true); on.notesSync() }
        // loadFeed runs by itself: the spinner stays until the feed answered (or a few seconds passed)
        val t0 = System.currentTimeMillis()
        kotlinx.coroutines.delay(600)
        while (on.feedLoading && System.currentTimeMillis() - t0 < 7000) kotlinx.coroutines.delay(150)
    }
    fun open(items: List<SheetItem>, title: String? = null, onDone: (() -> Unit)? = null) { sheet = SheetSpec(items, title, onDone) }
    fun closeSheet() { val s = sheet; sheet = null; s?.onDone?.invoke() }
    fun confirm(msg: String, label: String, fn: () -> Unit) = open(listOf(SheetItem(label, danger = true, fn = fn), SheetItem("Cancel", cancel = true)), msg)
    // the phone's short tick for a hold (a long press that opens something)
    fun buzz() { runCatching { activity?.get()?.window?.decorView?.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS) } }
    fun say(msg: String, label: String? = null, fn: (() -> Unit)? = null) { toast = Toast(msg, label, fn) }

    // alertMe(): a phone notification while the app is in the background, a toast while it is open
    fun alert(title: String, body: String, open: String) {
        val c = ctx
        if (!foreground && c != null) Notify.show(c, title, body, open) else say("$title: $body")
    }
    // what the app does once somebody is signed in (set by the activity: notifications, the update check)
    var onSignedIn: () -> Unit = {}

    // saving runs a moment after the last change, off the main thread, so many quick taps make one write
    private val io = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    // one save at a time, in order, so two saves never write the file at once
    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    private val saveIo = CoroutineScope(SupervisorJob() + Dispatchers.IO.limitedParallelism(1))
    private var saveJob: Job? = null
    fun persist() {
        saveJob?.cancel()
        // the copy is made on the main thread, where everything it reads is changed (so it can never meet a change half
        // way), a moment after the last change; only writing the file happens on a background thread
        saveJob = scope.launch {
            delay(150)
            writeState()
        }
        if (on.me != null) { on.notesSoon(); on.zenSyncSoon() }
    }
    // the same copy at once (the app goes to the background)
    fun saveNow() { saveJob?.cancel(); writeState() }
    private fun writeState() {
        val txt = runCatching { store.toJson().toString() }.getOrNull() ?: return
        saveIo.launch { store.filesDir?.let { d -> java.io.File(d, "state.json.tmp").apply { writeText(txt) }.renameTo(java.io.File(d, "state.json")) } }
    }

    // ---- what the web app's post functions do ----
    val s get() = store

    fun canPost(): Boolean {
        if (on.me != null && on.lockLeft() > 0) { postLocked = true; return false }
        return true
    }

    fun newPost(text: String, imgs: List<String>, parent: String?) {
        val p = LPost(uid(), text, System.currentTimeMillis(), imgs, parent)
        store.posts.add(p)
        on.pushPost(p)
        if (parent == null) store.draft = null
        fresh = p.id
        persist()
        say(if (parent != null) "Reply sent" else "Posted")
    }
    // shown at once, and put back if the server refuses it
    fun saveEdit(p: LPost, text: String, imgs: List<String>) {
        val was = Triple(p.text, p.imgs, p.edited)
        val origin = p.imgs
        // only a change of the words marks it as edited (removing or adding a photo does not)
        p.edited = p.edited || text != was.first
        p.text = text; p.imgs = imgs; persist(); say("Saved")
        scope.launch { if (!on.syncEdit(p, text, origin, imgs) && p.text == text && p.imgs == imgs) { p.text = was.first; p.imgs = was.second; p.edited = was.third; persist() } }
    }

    fun toggleLike(p: LPost) { if (p.remote != null) on.toggleLike(p) else { p.liked = !p.liked; persist() } }
    fun toggleRepost(p: LPost) { if (p.remote != null) on.toggleRepost(p) else { p.reposted = !p.reposted; p.rpAt = if (p.reposted) System.currentTimeMillis() else 0; persist() } }
    fun toggleSave(p: LPost) { on.setSaved(p, !p.saved); persist(); say(if (p.saved) "Saved" else "Removed from saved") }
    fun togglePin(p: LPost) {
        if (on.me != null) { on.togglePin(p); return }
        val was = p.pinned
        store.posts.forEach { it.pinned = false }
        p.pinned = !was
        persist(); say(if (p.pinned) "Pinned to your profile" else "Unpinned")
    }

    // a post goes with all the replies under it; Undo puts everything back as it was, lists included; the server copy
    // goes six seconds later unless Undo was tapped
    fun deletePost(p: LPost) {
        if (store.posts.none { it.id == p.id }) return
        val gone = (listOf(p.id) + store.flat(p.id).map { it.first.id }).toSet()
        val removed = store.posts.filter { it.id in gone }
        val rids = removed.filter { it.remote != null && it.mine }.map { it.remote!! }
        store.pendDel.addAll(rids)
        val zids = removed.filter { it.ai }.map { it.id }
        if (zids.isNotEmpty()) store.zen.put("gone", org.json.JSONArray(((store.zen.optJSONArray("gone")?.strings() ?: emptyList()) + zids).takeLast(500)))
        val listSnap = store.lists.map { it to it.ids.toList() }
        store.posts.removeAll { it.id in gone }
        store.lists.forEach { l -> l.ids.removeAll { it in gone } }
        while (stack.size > 1 && (stack.last() as? Route.Thread)?.id in gone) pop()
        persist()
        var undone = false
        say("Post deleted", "Undo") {
            undone = true
            removed.forEach { x -> if (store.posts.none { it.id == x.id }) store.posts.add(x) }
            store.pendDel.removeAll { it in rids }
            if (zids.isNotEmpty()) store.zen.put("gone", org.json.JSONArray((store.zen.optJSONArray("gone")?.strings() ?: emptyList()).filter { it !in zids }))
            listSnap.forEach { (l, ids) -> if (l in store.lists) { l.ids.clear(); l.ids.addAll(ids) } }
            persist()
        }
        scope.launch { delay(6000); if (!undone) { on.serverDelete(removed) } }
    }

    // "less like this": the person goes down a lot, the words a little, and the post goes away now
    fun lessLikeThis(p: LPost) {
        val who = whoOf(p)
        if (who != "me") store.lessA[who] = minOf(2, (store.lessA[who] ?: 0) + 1)
        wordsOf(p.text).forEach { w -> store.lessWords[w] = minOf(3, (store.lessWords[w] ?: 0) + 1) }
        if (store.lessWords.size > 300) store.lessWords.entries.sortedBy { it.value }.take(store.lessWords.size - 300).forEach { store.lessWords.remove(it.key) }
        store.hidden.add(p.id); while (store.hidden.size > 300) store.hidden.removeAt(0)
        persist(); say("You will see less like this")
    }

    // a message that is deleted folds away (its height goes to nothing while it fades, as foldAway of the web app) and then leaves the list
    fun <T> foldOut(list: MutableList<T>?, item: T, leave: (Boolean) -> Unit) {
        list ?: return
        leave(true)
        scope.launch { kotlinx.coroutines.delay(280); list.remove(item); persist() }
    }

    fun newChat() {
        val c = LChat(uid(), if (store.chats.isNotEmpty()) "Chat " + (store.chats.size + 1) else "Notes to self", System.currentTimeMillis())
        store.chats.add(c); persist(); go(Route.Conv(c.id))
    }

    fun listSheet(p: LPost) {
        val items = store.lists.map { l ->
            SheetItem(l.name, if (p.id in l.ids) "check" else "list") {
                if (p.id in l.ids) { l.ids.remove(p.id); say("Removed from " + l.name) } else { l.ids.add(p.id); say("Added to " + l.name) }
                persist()
            }
        } + SheetItem("New list", "plus") { panels.add(Panel.ListForm(null) { l -> l.ids.add(p.id); persist(); say("Added to " + l.name) }) }
        open(items, "Add to list")
    }

    companion object { @Volatile var current: AppState? = null }
}

val LocalApp = staticCompositionLocalOf<AppState> { error("no app state") }

private val STOP = setOf("this", "that", "with", "have", "from", "they", "were", "what", "your", "about", "just", "will", "would", "there", "their", "been", "than", "then", "them", "into", "some", "when", "like", "more", "very", "also", "only", "over", "dont", "cant")
// (the pattern is built once: it used to be compiled again for every post each time the feed was ranked)
private val WORDS_RE = Regex("[\\p{L}\\p{N}]{4,}")
fun wordsOf(text: String): List<String> = WORDS_RE.findAll(text.lowercase()).map { it.value }.filter { it !in STOP }.distinct().take(12).toList()

// the place on the stack of the page being drawn (1 for the first page)
val LocalPage = androidx.compose.runtime.compositionLocalOf { 1 }
