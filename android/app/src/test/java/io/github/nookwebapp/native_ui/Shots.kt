package io.github.nookwebapp.native_ui

import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import org.junit.Rule
import org.junit.Test

// Renders every page and sheet to a picture (app/src/test/snapshots/images), so the native screens can be compared
// with screenshots of the web app (tools/refweb.js) without a phone. Run with ./g.sh :app:recordPaparazziDebug
// Both sides draw the same fixture at the same frozen time, in UTC, in a Pixel 5 sized window.
private val DEVICE = DeviceConfig.PIXEL_5.copy(screenHeight = 2000, nightMode = com.android.resources.NightMode.NIGHT)

fun fixtureApp(dark: Boolean = true, start: Route = Route.Home, setup: AppState.() -> Unit = {}): AppState {
    Clock.now = { Sample.NOW }
    Photos.sync = true
    java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone("UTC"))
    java.util.Locale.setDefault(java.util.Locale.US)
    val st = Store(null).also { Sample.seed(it); it.theme = if (dark) ThemeMode.System else ThemeMode.Light }
    return AppState(st, start).apply { ph = Sample.placeholder; setup() }
}

class Shots {
    @get:Rule val paparazzi = Paparazzi(deviceConfig = DEVICE, showSystemUi = false, maxPercentDifference = 0.0)

    private fun shot(name: String, dark: Boolean = true, start: Route = Route.Home, setup: AppState.() -> Unit = {}) {
        val app = fixtureApp(dark, start, setup)
        paparazzi.snapshot(name) { NookApp(app) }
    }
    private fun AppState.post(i: Int) = store.posts[i]
    // posts of other people the way the feed brings them in (ra), with counts and a repost by somebody followed
    private fun others(app: AppState) {
        val a = Author("00000000-0000-4000-8000-0000000000b1", "Mika", "mika.k", null)
        app.store.posts.add(LPost("r00000000-0000-4000-8000-0000000000a1", "the moon looks unreal tonight, go outside https://example.com/moon", Sample.NOW - 5 * 60000, emptyList(), null, remote = "00000000-0000-4000-8000-0000000000a1", ra = a).apply { lc = 3; rpc = 1; svc = 2; shc = 1; rp = 1; liked = true })
        app.store.posts.add(LPost("r00000000-0000-4000-8000-0000000000a2", "replying :3", Sample.NOW - 4 * 60000, emptyList(), "r00000000-0000-4000-8000-0000000000a1", remote = "00000000-0000-4000-8000-0000000000a2", ra = Author("00000000-0000-4000-8000-0000000000b2", "", "zed", null)))
        app.store.posts.add(LPost("r00000000-0000-4000-8000-0000000000a3", "reposted by mika", Sample.NOW - 600 * 60000, emptyList(), null, remote = "00000000-0000-4000-8000-0000000000a3", ra = Author("00000000-0000-4000-8000-0000000000b3", "Rae", "rae", null)).apply { rpBy = RpBy(a.id, "Mika", Sample.NOW - 2 * 60000) })
        app.store.previews["https://example.com/moon"] = org.json.JSONObject().put("t", "The moon tonight").put("d", "A full moon over the city").put("i", "").put("s", "example.com").put("v", 2)
    }

    @Test fun pages() {
        shot("00-auth", start = Route.Auth)
        shot("01-auth-signup", start = Route.Auth) { authUp = true }
        shot("10-home")
        shot("11-home-media") { store.homeTab = "photos" }
        shot("13-drawer") { drawer = true }
        shot("15-thread") { go(Route.Thread(post(5).id)) }
        shot("16-post-sheet") { postSheet(this, post(0)) }
        shot("18-share-sheet") { go(Route.Thread(post(0).id)); shareSheet(this, post(0)) }
        shot("20-compose") { panels.add(Panel.Compose()) }
        shot("22-profile") { root(Route.Profile) }
        shot("23-edit-profile") { root(Route.Profile); panels.add(Panel.EditProfile) }
        shot("25-saved") { root(Route.Saved) }
        shot("26-chats") { root(Route.Chats) }
        shot("27-notifs") { go(Route.Notifs) }
        shot("28-settings") { root(Route.Settings) }
        shot("29-lists") { root(Route.Lists) }
        shot("30-search") { root(Route.Search) }
        shot("32-confirm") { confirm("Delete this post?", "Delete") {} }
        shot("34-followers") { root(Route.Profile); go(Route.Follows("me", true)) }
        shot("35-blocked") { root(Route.Settings); go(Route.Blocked) }
        shot("36-list-form") { root(Route.Lists); panels.add(Panel.ListForm(null)) }
        shot("37-conv") { root(Route.Chats); newChat() }
        shot("38-terms") { root(Route.Settings); go(Route.Legal(true)) }
        shot("39-reply") { panels.add(Panel.Compose(parent = post(0).id)) }
        shot("40-feed-others") { others(this) }
        shot("41-thread-other") { others(this); go(Route.Thread("r00000000-0000-4000-8000-0000000000a1")) }
        shot("42-other-sheet") { others(this); otherSheet(this, store.byId("r00000000-0000-4000-8000-0000000000a1")!!) }
        shot("43-warn") { warns.add(Warn("Post removed", "Reason: text that is not allowed.")) }
        shot("44-banned", start = Route.Banned)
        shot("45-age", start = Route.Age)
        shot("46-add-account") { root(Route.Settings); panels.add(Panel.AddAccount) }
        shot("47-totp") { root(Route.Settings); panels.add(Panel.TotpSetup) }
        shot("55-light-home", dark = false)
        shot("56-light-drawer", dark = false) { drawer = true }
        shot("58-light-settings", dark = false) { root(Route.Settings) }
    }
}

// prints where the tagged elements of a page ended up (build/probes-<name>.txt), for comparing with the web app's numbers
class Layout {
    @get:Rule val paparazzi = Paparazzi(deviceConfig = DEVICE, showSystemUi = false)
    private fun dump(name: String, setup: AppState.() -> Unit) {
        Probes.on = true; Probes.at.clear()
        val app = fixtureApp(setup = setup)
        paparazzi.snapshot("layout-$name") { NookApp(app) }
        java.io.File(System.getProperty("user.dir"), "build/probes-$name.txt").writeText(Probes.at.entries.joinToString("\n") { (k, r) -> "$k ${r.left} ${r.top} ${r.right} ${r.bottom}" })
        Probes.on = false
    }
    @Test fun home() = dump("home") {}
    @Test fun settings() = dump("settings") { root(Route.Settings) }
}
