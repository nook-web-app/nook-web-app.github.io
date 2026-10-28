package io.github.nookwebapp.native_ui

import androidx.compose.runtime.*

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
    data class User(val id: String) : Route
    data class ListPage(val id: String) : Route
    data class Follows(val who: String, val followers: Boolean) : Route
    data class Legal(val terms: Boolean) : Route
}

// one row of a sheet; cancel rows are drawn at the bottom as the bold Cancel button
data class SheetItem(
    val label: String, val icon: String? = null, val danger: Boolean = false, val on: Boolean = false,
    val cancel: Boolean = false, val person: Person? = null, val fn: () -> Unit = {},
)
data class SheetSpec(val items: List<SheetItem>, val title: String? = null)

// full screen panels that slide up over everything (.ov)
sealed interface Panel {
    data object Compose : Panel
    data object EditProfile : Panel
}

enum class Dir { Fwd, Back, Root }

class AppState(start: Route = Route.Home) {
    val stack = mutableStateListOf(start)
    var dir by mutableStateOf(Dir.Root)
    var sheet by mutableStateOf<SheetSpec?>(null)
    var drawer by mutableStateOf(false)
    var panel by mutableStateOf<Panel?>(null)
    var toast by mutableStateOf<String?>(null)
    var theme by mutableStateOf(ThemeMode.System)
    var homeTab by mutableIntStateOf(0)
    var profileTab by mutableIntStateOf(0)
    // chats and lists start empty until the app is connected
    val chats = mutableStateListOf<ChatRow>()
    val lists = mutableStateListOf<NookList>()
    val suggested = mutableStateListOf<Person>()
    val unreadPeople: Int get() = chats.count { it.unread > 0 }

    val top: Route get() = stack.last()
    val rootRoute: Route get() = stack.first()

    fun go(r: Route) { dir = Dir.Fwd; stack.add(r) }
    fun root(r: Route) { dir = Dir.Root; stack.clear(); stack.add(r) }
    // the back button closes what is on top first: a sheet, the menu, a panel, then the page
    fun back(): Boolean {
        when {
            sheet != null -> sheet = null
            drawer -> drawer = false
            panel != null -> panel = null
            stack.size > 1 -> { dir = Dir.Back; stack.removeAt(stack.lastIndex) }
            else -> return false
        }
        return true
    }
    fun open(items: List<SheetItem>, title: String? = null) { sheet = SheetSpec(items, title) }
    fun confirm(msg: String, label: String, fn: () -> Unit) = open(listOf(SheetItem(label, danger = true, fn = fn), SheetItem("Cancel", cancel = true)), msg)
    fun say(msg: String) { toast = msg }

    fun post(id: String) = Sample.posts.firstOrNull { it.id == id }
    fun person(id: String) = (Sample.people + Sample.me).firstOrNull { it.id == id }
    fun isZenith(p: Person) = p.handle.equals("zenith", ignoreCase = true)
}

val LocalApp = staticCompositionLocalOf<AppState> { error("no app state") }
