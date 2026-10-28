package io.github.nookwebapp.native_ui

import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import org.junit.Rule
import org.junit.Test

// Renders every page and sheet to a picture (app/src/test/snapshots/images), so the native screens can be
// compared with screenshots of the web app without a phone. Run with ./g.sh :app:recordPaparazziDebug
class Shots {
    // the phone is in dark mode and the app follows the phone (System), like the web reference
    @get:Rule val paparazzi = Paparazzi(deviceConfig = DeviceConfig.PIXEL_5.copy(screenHeight = 2000, nightMode = com.android.resources.NightMode.NIGHT), showSystemUi = false, maxPercentDifference = 0.0)

    private fun shot(name: String, dark: Boolean = true, setup: AppState.() -> Unit) {
        val app = AppState().apply { theme = if (dark) ThemeMode.System else ThemeMode.Light; setup() }
        paparazzi.snapshot(name) { NookApp(app) }
    }

    @Test fun pages() {
        shot("10-home") {}
        shot("11-home-media") { homeTab = 1 }
        shot("13-drawer") { drawer = true }
        shot("15-thread") { go(Route.Thread(Sample.posts[5].id)) }
        shot("16-post-sheet") { postSheet(this, Sample.posts[0]) }
        shot("18-share-sheet") { go(Route.Thread(Sample.posts[0].id)); shareSheet(this, Sample.posts[0]) }
        shot("20-compose") { panel = Panel.Compose }
        shot("22-profile") { root(Route.Profile) }
        shot("23-edit-profile") { root(Route.Profile); panel = Panel.EditProfile }
        shot("25-saved") { root(Route.Saved) }
        shot("26-chats") { root(Route.Chats) }
        shot("27-notifs") { go(Route.Notifs) }
        shot("28-settings") { root(Route.Settings) }
        shot("29-lists") { root(Route.Lists) }
        shot("30-search") { root(Route.Search) }
        shot("32-confirm") { go(Route.User(Sample.p1.id)); confirm("Delete this post?", "Delete") {} }
        shot("48-user") { go(Route.User(Sample.p3.id)) }
        shot("49-other-more") { postSheet(this, Sample.posts[4]) }
        shot("51-report") { reportSheet(this, Sample.posts[4]) }
        shot("00-auth") { root(Route.Auth) }
        shot("55-light-home", dark = false) {}
        shot("56-light-drawer", dark = false) { drawer = true }
        shot("58-light-settings", dark = false) { root(Route.Settings) }
    }
}

// prints where the tagged elements of a page ended up (build/probes-<name>.txt), for comparing with the web app's numbers
class Layout {
    @get:Rule val paparazzi = Paparazzi(deviceConfig = DeviceConfig.PIXEL_5.copy(screenHeight = 2000), showSystemUi = false)
    private fun dump(name: String, setup: AppState.() -> Unit) {
        Probes.on = true; Probes.at.clear()
        val app = AppState().apply { theme = ThemeMode.Dark; setup() }
        paparazzi.snapshot("layout-$name") { NookApp(app) }
        java.io.File(System.getProperty("user.dir"), "build/probes-$name.txt").writeText(Probes.at.entries.joinToString("\n") { (k, r) -> "$k ${r.left} ${r.top} ${r.right} ${r.bottom}" })
        Probes.on = false
    }
    @Test fun home() = dump("home") {}
    @Test fun settings() = dump("settings") { root(Route.Settings) }
}
