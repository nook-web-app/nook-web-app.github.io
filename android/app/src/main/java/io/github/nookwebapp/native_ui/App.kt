package io.github.nookwebapp.native_ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.border
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp

// The whole app: the page on top of the stack, the bottom bar, and the layers over them (menu, panels, sheets, toast).
@Composable
fun NookApp(app: AppState = remember { AppState() }) {
    NookTheme(app.theme) {
        CompositionLocalProvider(LocalApp provides app) {
            val c = LocalNook.current
            BackHandler(app.sheet != null || app.drawer || app.panel != null || app.stack.size > 1) { app.back() }
            Box(Modifier.fillMaxSize().background(c.bg)) {
                Column(Modifier.fillMaxSize().statusBarsPadding()) {
                    val slide = with(LocalDensity.current) { 14.dp.roundToPx() }
                    AnimatedContent(
                        app.top, Modifier.weight(1f), label = "page",
                        // the page slides 14dp and fades in, like go-fwd / go-back / go-root in style.css
                        transitionSpec = {
                            when (app.dir) {
                                Dir.Fwd -> (fadeIn(tween(180)) + slideInHorizontally(tween(180)) { slide }) togetherWith fadeOut(tween(0))
                                Dir.Back -> (fadeIn(tween(180)) + slideInHorizontally(tween(180)) { -slide }) togetherWith fadeOut(tween(0))
                                Dir.Root -> fadeIn(tween(140)) togetherWith fadeOut(tween(0))
                            }
                        },
                    ) { r -> PageFor(r) }
                    if (app.top != Route.Auth) NavBar(app)
                }
                DrawerHost(app)
                PanelHost(app)
                SheetHost(app)
                ToastHost(app)
            }
        }
    }
}

@Composable
private fun PageFor(r: Route) = when (r) {
    Route.Auth -> AuthScreen()
    Route.Home -> HomeScreen()
    Route.Chats -> ChatsScreen()
    Route.Saved -> SavedScreen()
    Route.Profile -> ProfileScreen()
    Route.Settings -> SettingsScreen()
    Route.Lists -> ListsScreen()
    Route.Search -> SearchScreen()
    Route.Notifs -> NotifsScreen()
    Route.Blocked -> BlockedScreen()
    Route.Hidden -> HiddenScreen()
    is Route.Thread -> ThreadScreen(r.id)
    is Route.User -> UserScreen(r.id)
    is Route.ListPage -> ListScreen(r.id)
    is Route.Follows -> FollowsScreen(r)
    is Route.Legal -> LegalScreen(r.terms)
}

// #nav: home, chats, saved, and the own picture for the profile; the page the stack started from is lit
@Composable
private fun NavBar(app: AppState) {
    val c = LocalNook.current
    val first = app.rootRoute
    Row(Modifier.fillMaxWidth().background(c.bg).lineAbove(c.line).navigationBarsPadding().height(54.dp)) {
        listOf(Route.Home to "home", Route.Chats to "chat", Route.Saved to "bookmark", Route.Profile to "user").forEach { (r, icon) ->
            val on = first == r
            Box(Modifier.weight(1f).fillMaxHeight().tap { if (!(on && app.stack.size == 1)) app.root(r) }, contentAlignment = Alignment.Center) {
                if (r == Route.Profile) Avatar(Sample.me, 28.dp, modifier = if (on) Modifier.border(2.dp, c.fg, CircleShape).padding(0.dp) else Modifier)
                else NIcon(icon, 26.dp, if (on) c.fg else c.muted, fill = on)
                if (r == Route.Chats) {
                    val unread = Sample.chats.count { it.unread > 0 }
                    if (unread > 0) Badge(unread, Modifier.align(Alignment.TopCenter).offset(x = 16.dp, y = 4.dp))
                }
            }
        }
    }
}
