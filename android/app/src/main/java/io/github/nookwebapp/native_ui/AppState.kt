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
    data object Blocked : Route
    data object Hidden : Route
    data class Thread(val id: String) : Route
    data class Conv(val id: String) : Route
    data class Tag(val q: String) : Route
    data class ListPage(val id: String) : Route
    data class Follows(val followers: Boolean) : Route
    data class Legal(val terms: Boolean) : Route
}

// one row of a sheet; cancel rows are drawn at the bottom as the bold Cancel button; keep rows leave the sheet open
data class SheetItem(
    val label: String, val icon: String? = null, val danger: Boolean = false, val on: Boolean = false,
    val cancel: Boolean = false, val left: Boolean = false, val keep: Boolean = false, val fn: () -> Unit = {},
)
data class SheetSpec(val items: List<SheetItem>, val title: String? = null, val onDone: (() -> Unit)? = null)

// full screen panels that slide up over everything (.ov), stacked: the cropper opens over the profile editor
sealed interface Panel {
    data class Compose(val parent: String? = null, val edit: String? = null, val pick: String? = null, val files: List<String> = emptyList(), val text: String = "") : Panel
    data object EditProfile : Panel
    data class ListForm(val list: LList?, val after: ((LList) -> Unit)? = null) : Panel
    data class RenameChat(val chat: LChat) : Panel
    data class Crop(val src: String, val round: Boolean, val w: Int, val h: Int, val title: String, val done: (String?) -> Unit) : Panel
}

data class Toast(val msg: String, val label: String? = null, val fn: (() -> Unit)? = null, val n: Long = System.nanoTime())
data class Viewer(val imgs: List<String>, val index: Int, val cap: String? = null, val del: ((Int) -> Unit)? = null)

enum class Dir { Fwd, Back, Root }

class AppState(val store: Store = Store(null), start: Route? = null) {
    val stack = mutableStateListOf(start ?: if (store.signedIn || store.posts.isNotEmpty()) Route.Home else Route.Auth)
    var dir by mutableStateOf(Dir.Root)
    var sheet by mutableStateOf<SheetSpec?>(null)
    var drawer by mutableStateOf(false)
    val panels = mutableStateListOf<Panel>()
    var toast by mutableStateOf<Toast?>(null)
    var viewer by mutableStateOf<Viewer?>(null)
    // the post that was just written slides in (.post.fresh)
    var fresh by mutableStateOf<String?>(null)
    var authUp by mutableStateOf(false)
    // one prompt per start, like PH_NOW
    var ph: String = PH[(Math.random() * PH.size).toInt().coerceIn(0, PH.size - 1)]
    // what the phone does for the app (set by the activity): copy text, share or post a picture of a post, back up
    var clipboard: (String) -> Unit = {}
    var sharePicture: (LPost, Boolean) -> Unit = { _, _ -> }
    var backup: () -> Unit = {}
    val settingsScroll = androidx.compose.foundation.ScrollState(0)
    // where each page on the stack was scrolled to, so going back lands on the same spot
    private val lists = mutableMapOf<Int, LazyListState>()
    fun listState(): LazyListState = lists.getOrPut(stack.size) { LazyListState() }

    val top: Route get() = stack.last()
    val rootRoute: Route get() = stack.first()
    val theme: ThemeMode get() = store.theme

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
            else -> return false
        }
        return true
    }
    // a panel's own back behaviour (keep the draft, or say no to the crop) is set by the panel while it is open
    val panelBackHooks = mutableMapOf<Panel, () -> Unit>()
    fun panelBack() { val p = panels.lastOrNull() ?: return; panelBackHooks.remove(p)?.invoke(); panels.remove(p) }
    fun closePanel(p: Panel) { panelBackHooks.remove(p); panels.remove(p) }
    fun open(items: List<SheetItem>, title: String? = null, onDone: (() -> Unit)? = null) { sheet = SheetSpec(items, title, onDone) }
    fun closeSheet() { val s = sheet; sheet = null; s?.onDone?.invoke() }
    fun confirm(msg: String, label: String, fn: () -> Unit) = open(listOf(SheetItem(label, danger = true, fn = fn), SheetItem("Cancel", cancel = true)), msg)
    fun say(msg: String, label: String? = null, fn: (() -> Unit)? = null) { toast = Toast(msg, label, fn) }

    // saving runs a moment after the last change, off the main thread, so many quick taps make one write
    private val io = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var saveJob: Job? = null
    fun persist() {
        saveJob?.cancel()
        saveJob = io.launch { delay(150); store.save() }
    }

    // ---- what the web app's post functions do, on this phone only ----
    val s get() = store

    fun newPost(text: String, imgs: List<String>, parent: String?) {
        val p = LPost(uid(), text, System.currentTimeMillis(), imgs, parent)
        store.posts.add(p)
        if (parent == null) store.draft = null
        fresh = p.id
        persist()
        say(if (parent != null) "Reply sent" else "Posted")
    }
    fun saveEdit(p: LPost, text: String, imgs: List<String>) { p.text = text; p.imgs = imgs; p.edited = true; persist(); say("Saved") }

    fun toggleLike(p: LPost) { p.liked = !p.liked; persist() }
    fun toggleRepost(p: LPost) { p.reposted = !p.reposted; p.rpAt = if (p.reposted) System.currentTimeMillis() else 0; persist() }
    fun toggleSave(p: LPost) { p.saved = !p.saved; persist(); say(if (p.saved) "Saved" else "Removed from saved") }
    fun togglePin(p: LPost) {
        val was = p.pinned
        store.posts.forEach { it.pinned = false }
        p.pinned = !was
        persist(); say(if (p.pinned) "Pinned to your profile" else "Unpinned")
    }

    // a post goes with all the replies under it; Undo puts everything back as it was, lists included
    fun deletePost(p: LPost) {
        if (store.posts.none { it.id == p.id }) return
        val gone = (listOf(p.id) + store.flat(p.id).map { it.first.id }).toSet()
        val removed = store.posts.filter { it.id in gone }
        val listSnap = store.lists.map { it to it.ids.toList() }
        store.posts.removeAll { it.id in gone }
        store.lists.forEach { l -> l.ids.removeAll { it in gone } }
        while (stack.size > 1 && (stack.last() as? Route.Thread)?.id in gone) pop()
        persist()
        say("Post deleted", "Undo") {
            removed.forEach { x -> if (store.posts.none { it.id == x.id }) store.posts.add(x) }
            listSnap.forEach { (l, ids) -> if (l in store.lists) { l.ids.clear(); l.ids.addAll(ids) } }
            persist()
        }
    }

    // "less like this": the words go down a little and the post goes away now
    fun lessLikeThis(p: LPost) {
        wordsOf(p.text).forEach { w -> store.lessWords[w] = minOf(3, (store.lessWords[w] ?: 0) + 1) }
        if (store.lessWords.size > 300) store.lessWords.entries.sortedBy { it.value }.take(store.lessWords.size - 300).forEach { store.lessWords.remove(it.key) }
        store.hidden.add(p.id); while (store.hidden.size > 300) store.hidden.removeAt(0)
        persist(); say("You will see less like this")
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
}

val LocalApp = staticCompositionLocalOf<AppState> { error("no app state") }

private val STOP = setOf("this", "that", "with", "have", "from", "they", "were", "what", "your", "about", "just", "will", "would", "there", "their", "been", "than", "then", "them", "into", "some", "when", "like", "more", "very", "also", "only", "over", "dont", "cant")
fun wordsOf(text: String): List<String> = Regex("[\\p{L}\\p{N}]{4,}").findAll(text.lowercase()).map { it.value }.filter { it !in STOP }.distinct().take(12).toList()
