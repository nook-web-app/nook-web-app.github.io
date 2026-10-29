package io.github.nookwebapp.native_ui

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

// #offline of the web app: a full page that is only on screen while the phone has no connection. Nothing under it can be
// touched.
@Composable
fun OfflineHost(app: AppState) {
    if (!app.offline) return
    val c = LocalNook.current
    Column(
        Modifier.fillMaxSize().background(c.bg).pointerInput(Unit) { detectTapGestures { } }.statusBarsPadding().navigationBarsPadding().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
    ) {
        T("You are offline", Fs.x3, FontWeight.Bold, align = TextAlign.Center)
        Pill("Try again") {
            if (!app.online) app.say("Still offline")
            else if (app.bootOffline) { app.bootOffline = false; app.scope.launch { app.on.boot() } }
        }
    }
}
