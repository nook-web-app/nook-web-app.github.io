package io.github.nookwebapp.native_ui

import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import org.junit.Rule
import org.junit.Test

// Pictures of the call screen with Zenith in each phase (the screen is frozen with Panel.Call(still)), so it can be looked at without a phone.
// Run with: gradle :app:recordPaparazziDebug --tests "*CallShots*"
class CallShots {
    @get:Rule val paparazzi = Paparazzi(
        deviceConfig = DeviceConfig.PIXEL_5.copy(screenHeight = 2000, nightMode = com.android.resources.NightMode.NIGHT),
        showSystemUi = false, maxPercentDifference = 0.0,
    )

    private fun shot(name: String, still: String) {
        val app = fixtureApp(true, Route.Home) { panels.add(Panel.Call(still)) }
        paparazzi.snapshot(name) { NookApp(app) }
    }

    @Test fun call() {
        shot("60-call-connecting", "connecting")
        shot("61-call-listening", "listening")
        shot("62-call-speaking", "speaking")
        shot("63-call-searching", "searching")
    }
}
