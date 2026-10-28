package io.github.nookwebapp.native_ui

import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import org.junit.Rule
import org.junit.Test

// Renders every page and sheet to a picture (app/src/test/snapshots/images), so the native screens can be
// compared with screenshots of the web app without a phone. Run with ./g.sh :app:recordPaparazziDebug
class Shots {
    @get:Rule val paparazzi = Paparazzi(deviceConfig = DeviceConfig.PIXEL_5.copy(screenHeight = 2000), showSystemUi = false, maxPercentDifference = 0.0)

    private fun shot(name: String, dark: Boolean = true, setup: AppState.() -> Unit) {
        val app = AppState().apply { theme = if (dark) ThemeMode.Dark else ThemeMode.Light; setup() }
        paparazzi.snapshot(name) { NookApp(app) }
    }

    @Test fun pages() {
        shot("10-home") {}
        shot("11-home-media") { homeTab = 1 }
        shot("13-drawer") { drawer = true }
        shot("15-thread") { go(Route.Thread("p6")) }
        shot("16-post-sheet") { postSheet(this, Sample.posts[0]) }
        shot("18-share-sheet") { go(Route.Thread("p1")); shareSheet(this, Sample.posts[0]) }
        shot("20-compose") { panel = Panel.Compose }
        shot("22-profile") { root(Route.Profile) }
        shot("23-edit-profile") { root(Route.Profile); panel = Panel.EditProfile }
        shot("25-saved") { root(Route.Saved) }
        shot("26-chats") { root(Route.Chats) }
        shot("27-notifs") { go(Route.Notifs) }
        shot("28-settings") { root(Route.Settings) }
        shot("29-lists") { root(Route.Lists) }
        shot("30-search") { root(Route.Search) }
        shot("32-confirm") { root(Route.User("zen")); confirm("Delete this post?", "Delete") {} }
        shot("48-user") { go(Route.User("u1")) }
        shot("49-other-more") { postSheet(this, Sample.posts[4]) }
        shot("51-report") { reportSheet(this, Sample.posts[3]) }
        shot("00-auth") { root(Route.Auth) }
        shot("55-light-home", dark = false) {}
        shot("56-light-drawer", dark = false) { drawer = true }
        shot("58-light-settings", dark = false) { root(Route.Settings) }
    }
}
