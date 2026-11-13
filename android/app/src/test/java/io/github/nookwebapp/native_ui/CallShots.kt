package io.github.nookwebapp.native_ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.layout.statusBarsPadding
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import org.junit.Rule
import org.junit.Test

// Pictures of the call screen with Zenith in each phase (the screen is frozen with Panel.Call(still)), and of the card, so they can be looked at
// without a phone. Run with: gradle :app:recordPaparazziDebug --tests "*CallShots*"
class CallShots {
    @get:Rule val paparazzi = Paparazzi(
        deviceConfig = DeviceConfig.PIXEL_5.copy(screenHeight = 2000, nightMode = com.android.resources.NightMode.NIGHT),
        showSystemUi = false, maxPercentDifference = 0.0,
    )

    private fun shot(name: String, still: String) {
        val app = fixtureApp(true, Route.Home) { panels.add(Panel.Call(still)) }
        paparazzi.snapshot(name) { NookApp(app) }
    }

    // a picture of his that the card can use as its background
    private fun pfp(): String {
        val bm = android.graphics.Bitmap.createBitmap(256, 256, android.graphics.Bitmap.Config.ARGB_8888)
        val c = android.graphics.Canvas(bm)
        val p = android.graphics.Paint().apply { shader = android.graphics.LinearGradient(0f, 0f, 256f, 256f, 0xFFE0F2FF.toInt(), 0xFF2D6CDF.toInt(), android.graphics.Shader.TileMode.CLAMP) }
        c.drawRect(0f, 0f, 256f, 256f, p)
        val o = android.graphics.Paint().apply { color = 0xFF1B1F2A.toInt() }
        c.drawCircle(128f, 110f, 56f, o); c.drawRect(60f, 170f, 196f, 256f, o)
        val out = java.io.ByteArrayOutputStream(); bm.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, out)
        return "data:image/png;base64," + java.util.Base64.getEncoder().encodeToString(out.toByteArray())
    }

    @Test fun call() {
        shot("60-call-connecting", "connecting")
        shot("61-call-listening", "listening")
        shot("62-call-speaking", "speaking")
        shot("63-call-searching", "searching")
        shot("64-call-ending", "ending")
        shot("65-call-off", "off")
    }

    @Test fun card() {
        val app = fixtureApp(true, Route.Home) { store.zen.put("pfp", pfp()) }
        val s = CallSession.still("speaking")
        paparazzi.snapshot("66-call-card") {
            CompositionLocalProvider(LocalApp provides app, LocalNook provides DarkColors) {
                Box(Modifier.fillMaxSize().background(Color(0xFF202020))) {
                    CallCard(app, s, onOpen = {}, onEnd = {}, modifier = Modifier.align(Alignment.TopCenter).statusBarsPadding())
                }
            }
        }
    }

    @Test fun ring() {
        val app = fixtureApp(true, Route.Home) { store.zen.put("pfp", pfp()) }
        paparazzi.snapshot("67-call-ring") {
            CompositionLocalProvider(LocalApp provides app, LocalNook provides DarkColors) { RingScreen(true, {}, {}, still = true) }
        }
    }
}
