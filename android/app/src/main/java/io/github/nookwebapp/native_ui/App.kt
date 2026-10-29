package io.github.nookwebapp.native_ui

import androidx.activity.compose.BackHandler
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

// The whole app: the page on top of the stack, the bottom bar, and the layers over them in the web app's order
// (panels, the menu, the photo viewer, sheets, notices, the toast).
@Composable
fun NookApp(app: AppState) {
    NookTheme(app.theme) {
        CompositionLocalProvider(LocalApp provides app) {
            val c = LocalNook.current
            // the status and navigation bar icons follow the app's own theme, not only the phone's
            val activity = androidx.compose.ui.platform.LocalContext.current as? androidx.activity.ComponentActivity
            SideEffect {
                val bars = if (c.dark) androidx.activity.SystemBarStyle.dark(android.graphics.Color.TRANSPARENT)
                else androidx.activity.SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT)
                activity?.enableEdgeToEdge(bars, bars)
            }
            // screenshots and screen recordings are blocked only inside a chat with another person; one's own chats on this
            // phone (notes, also the ones Zenith answers in) and every other page stay free to capture
            val top = app.top
            val secure = top is Route.Dm
            LaunchedEffect(secure) {
                val w = activity?.window ?: return@LaunchedEffect
                if (secure) w.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE) else w.clearFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)
            }
            BackHandler(app.viewer != null || app.sheet != null || app.drawer || app.panels.isNotEmpty() || app.stack.size > 1 || app.zcard != null) { if (app.zcard != null) app.zcard = null else app.back() }
            Box(Modifier.fillMaxSize().background(c.bg)) {
                Column(Modifier.fillMaxSize().statusBarsPadding().imePadding()) {
                    val slide = with(LocalDensity.current) { 14.dp.roundToPx() }
                    AnimatedContent(
                        app.top to app.stack.size, Modifier.weight(1f), label = "page",
                        // the page slides 14dp and fades in, like go-fwd / go-back / go-root in style.css
                        transitionSpec = {
                            when (app.dir) {
                                Dir.Fwd -> (fadeIn(tween(180)) + slideInHorizontally(tween(180)) { slide }) togetherWith fadeOut(tween(0))
                                Dir.Back -> (fadeIn(tween(180)) + slideInHorizontally(tween(180)) { -slide }) togetherWith fadeOut(tween(0))
                                Dir.Root -> fadeIn(tween(140)) togetherWith fadeOut(tween(0))
                            }
                        },
                    ) { (r, n) -> CompositionLocalProvider(LocalPage provides n) { PageFor(r) } }
                    // the bottom bar goes away on the sign in, banned and age pages, inside a chat, and on the legal pages before signing in
                    if (top != Route.Auth && top != Route.Banned && top != Route.Age && top !is Route.Conv && top !is Route.Dm && !(top is Route.Legal && !app.signedIn)) NavBar(app)
                }
                PanelHost(app)
                DrawerHost(app)
                ZCardHost(app)
                ViewerHost(app)
                SheetHost(app)
                WarnHost(app)
                PostLockedHost(app)
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
    Route.Banned -> BannedScreen()
    Route.Age -> AgeScreen()
    Route.Zen -> ZenScreen()
    is Route.Thread -> ThreadScreen(r.id)
    is Route.Conv -> ConvScreen(r.id)
    is Route.Dm -> DmScreen(r.id)
    is Route.User -> UserScreen(r.id)
    is Route.Tag -> TagScreen(r.q)
    is Route.ListPage -> ListScreen(r.id)
    is Route.Follows -> FollowsScreen(r)
    is Route.Legal -> LegalScreen(r.terms)
}

// #nav: home, chats (with the number of people who wrote), saved, and the own picture for the profile; the page the stack
// started from is lit, a tap on the lit one at its top scrolls back up, and two quick taps on the picture switch accounts
@Composable
private fun NavBar(app: AppState) {
    val c = LocalNook.current
    val first = app.rootRoute
    val scope = rememberCoroutineScope()
    var lastProfileTap by remember { mutableLongStateOf(0L) }
    Row(Modifier.fillMaxWidth().background(c.bg).lineAbove(c.line).navigationBarsPadding().height(54.dp)) {
        listOf(Route.Home to "home", Route.Chats to "chat", Route.Saved to "bookmark", Route.Profile to "user").forEach { (r, icon) ->
            val on = first == r
            Box(Modifier.weight(1f).fillMaxHeight().pressTap {
                if (r == Route.Profile && System.currentTimeMillis() - lastProfileTap < 350) { lastProfileTap = 0; app.on.quickSwitch(); return@pressTap }
                if (r == Route.Profile) lastProfileTap = System.currentTimeMillis()
                if (on && app.stack.size == 1) scope.launch { app.listStateFor(1).animateScrollToItem(0) } else app.root(r)
            }, contentAlignment = Alignment.Center) {
                // the lit picture gets a 2dp ring outside it (box-shadow: 0 0 0 2px)
                if (r == Route.Profile) Box(Modifier.size(32.dp).then(if (on) Modifier.border(2.dp, c.fg, CircleShape) else Modifier), contentAlignment = Alignment.Center) { MyAvatar(28.dp) }
                else NIcon(icon, 26.dp, if (on) c.fg else c.muted, fill = on)
                if (r == Route.Chats && app.on.unreadPeople > 0) Badge(app.on.unreadPeople, Modifier.align(Alignment.TopCenter).padding(top = 4.dp).offset(x = 16.dp))
            }
        }
    }
}
