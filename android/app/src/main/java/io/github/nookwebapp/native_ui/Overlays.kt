package io.github.nookwebapp.native_ui

import androidx.compose.animation.*
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.clickable
import androidx.compose.material3.LocalTextStyle
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

// cubic-bezier(.2,.8,.2,1), the easing every slide in the web app uses
val Snappy = CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f)

@Composable
private fun Scrim(visible: Boolean, onTap: () -> Unit) {
    val c = LocalNook.current
    AnimatedVisibility(visible, enter = fadeIn(tween(160)), exit = fadeOut(tween(160))) {
        Box(Modifier.fillMaxSize().background(c.scrim).clickable(remember { MutableInteractionSource() }, null, onClick = onTap))
    }
}

// .sheet: slides up from the bottom, 8dp from the edges, with the grab handle, an optional title, the rows and Cancel.
// What a row does runs after the sheet has closed, like in the web app.
@Composable
fun SheetHost(app: AppState) {
    val c = LocalNook.current
    var shown by remember { mutableStateOf<SheetSpec?>(null) }
    if (app.sheet != null) shown = app.sheet
    val maxH = LocalConfiguration.current.screenHeightDp.dp * 0.52f
    Scrim(app.sheet != null) { app.sheet = null }
    Box(Modifier.fillMaxSize().navigationBarsPadding(), contentAlignment = Alignment.BottomCenter) {
        AnimatedVisibility(
            app.sheet != null,
            enter = slideInVertically(tween(220, easing = Snappy)) { it },
            exit = slideOutVertically(tween(160)) { it },
        ) {
            val spec = shown ?: return@AnimatedVisibility
            var drag by remember(spec) { mutableFloatStateOf(0f) }
            val close: (() -> Unit) -> Unit = { then -> app.sheet = null; then() }
            Column(
                Modifier.padding(8.dp).widthIn(max = 584.dp).fillMaxWidth().offset { IntOffset(0, drag.toInt()) }
                    .clip(RoundedCornerShape(Rad.sheet)).background(c.bg).border(1.dp, c.line, RoundedCornerShape(Rad.sheet))
                    .clickable(remember { MutableInteractionSource() }, null) {}
                    .padding(start = 10.dp, end = 10.dp, bottom = 10.dp),
            ) {
                // .grab: dragging it down more than 70dp closes the sheet
                Box(
                    Modifier.fillMaxWidth().pointerInput(spec) {
                        detectVerticalDragGestures(onDragEnd = { if (drag > 70.dp.toPx()) app.sheet = null else drag = 0f }) { _, dy -> drag = (drag + dy).coerceAtLeast(0f) }
                    }.padding(top = 10.dp, bottom = 12.dp),
                    contentAlignment = Alignment.Center,
                ) { Box(Modifier.size(38.dp, 4.dp).clip(RoundedCornerShape(Rad.xs)).background(c.line)) }
                if (spec.title != null) T(spec.title, Fs.md, color = c.muted, align = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, bottom = 12.dp))
                Column(Modifier.heightIn(max = maxH).verticalScroll(rememberScrollState())) {
                    spec.items.filter { !it.cancel }.forEach { i -> SheetRow(i) { close(i.fn) } }
                }
                spec.items.filter { it.cancel }.forEach { i ->
                    Box(Modifier.fillMaxWidth().tap(RoundedCornerShape(Rad.m)) { close(i.fn) }.padding(15.dp), contentAlignment = Alignment.Center) {
                        T(i.label, Fs.lg, FontWeight.Bold)
                    }
                }
            }
        }
    }
}

// .si: an icon in the accent color and the label; without an icon the label is centered (.plain)
@Composable
private fun SheetRow(i: SheetItem, onClick: () -> Unit) {
    val c = LocalNook.current
    val col = if (i.danger) c.danger else c.fg
    val plain = i.icon == null && i.person == null
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(Rad.m)).background(if (i.on) c.bg2 else Color.Transparent).tap(RoundedCornerShape(Rad.m), onClick = onClick)
            .padding(horizontal = 14.dp, vertical = if (plain) 15.dp else 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = if (plain) Arrangement.Center else Arrangement.spacedBy(14.dp),
    ) {
        if (i.person != null) Box(Modifier.size(36.dp), contentAlignment = Alignment.Center) { Avatar(i.person, 32.dp) }
        else if (i.icon != null) Box(Modifier.size(36.dp), contentAlignment = Alignment.Center) { NIcon(i.icon, 20.dp, if (i.danger) c.danger else c.accent) }
        T(i.label, Fs.lg, if (plain) FontWeight.SemiBold else if (i.on) FontWeight.Bold else FontWeight.Medium, col)
        if (i.on) { Spacer(Modifier.weight(1f)); NIcon("check", 20.dp, c.accent) }
    }
}

// .drawer: the menu that slides in from the left
@Composable
fun DrawerHost(app: AppState) {
    val c = LocalNook.current
    val w = minOf(LocalConfiguration.current.screenWidthDp * 0.86f, 330f).dp
    Scrim(app.drawer) { app.drawer = false }
    AnimatedVisibility(app.drawer, enter = slideInHorizontally(tween(260, easing = Snappy)) { -it }, exit = slideOutHorizontally(tween(200)) { -it }) {
        val item: @Composable (String, String, Route) -> Unit = { icon, label, r ->
            Row(Modifier.fillMaxWidth().tap(RoundedCornerShape(Rad.m)) { app.drawer = false; app.root(r) }.padding(vertical = 13.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                NIcon(icon, 28.dp, c.fg); T(label, Fs.x2)
            }
        }
        Column(
            Modifier.fillMaxHeight().width(w).background(c.bg).lineRight(c.line).clickable(remember { MutableInteractionSource() }, null) {}
                .statusBarsPadding().padding(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 20.dp),
        ) {
            Avatar(Sample.me, 56.dp)
            T(Sample.me.name, Fs.x2, FontWeight.Bold, modifier = Modifier.padding(top = 12.dp))
            T("@" + Sample.me.handle, color = c.muted)
            Spacer(Modifier.height(18.dp))
            item("search", "Search", Route.Search)
            item("list", "Lists", Route.Lists)
            item("sliders", "Settings", Route.Settings)
        }
    }
}

fun Modifier.lineRight(color: Color) = this.then(Modifier.drawBehind {
    val w = 1.dp.toPx(); drawRect(color, androidx.compose.ui.geometry.Offset(size.width - w, 0f), androidx.compose.ui.geometry.Size(w, size.height))
}.padding(end = 1.dp))

// #toast: a small note above the bottom bar for two seconds
@Composable
fun ToastHost(app: AppState) {
    val c = LocalNook.current
    var shown by remember { mutableStateOf("") }
    val msg = app.toast
    if (msg != null) shown = msg
    LaunchedEffect(msg) { if (msg != null) { delay(1900); if (app.toast == msg) app.toast = null } }
    Box(Modifier.fillMaxSize().navigationBarsPadding().padding(bottom = 72.dp), contentAlignment = Alignment.BottomCenter) {
        AnimatedVisibility(msg != null, enter = fadeIn(tween(180)) + slideInVertically(tween(180)) { 8 }, exit = fadeOut(tween(180)) + slideOutVertically(tween(180)) { 8 }) {
            Box(
                Modifier.widthIn(max = 340.dp).shadow(16.dp, RoundedCornerShape(Rad.m), ambientColor = Color(0x38000000), spotColor = Color(0x38000000))
                    .clip(RoundedCornerShape(Rad.m)).background(c.bg2).border(1.dp, c.line, RoundedCornerShape(Rad.m)).padding(horizontal = 14.dp, vertical = 9.dp),
            ) { T(shown, Fs.sm, FontWeight.Medium, lineHeight = (13 * 1.3).sp) }
        }
    }
}

// .ov panels: compose a post and edit the profile slide up over the whole screen
@Composable
fun PanelHost(app: AppState) {
    var shown by remember { mutableStateOf<Panel?>(null) }
    if (app.panel != null) shown = app.panel
    AnimatedVisibility(app.panel != null, enter = slideInVertically(tween(280, easing = Snappy)) { it }, exit = slideOutVertically(tween(220)) { it }) {
        val c = LocalNook.current
        Box(Modifier.fillMaxSize().background(c.bg).clickable(remember { MutableInteractionSource() }, null) {}.statusBarsPadding().navigationBarsPadding().imePadding()) {
            when (shown) {
                Panel.Compose -> ComposePanel(app)
                Panel.EditProfile -> EditProfilePanel(app)
                null -> {}
            }
        }
    }
}

// .mbar: Cancel on the left, the title in the middle, the main action on the right
@Composable
private fun MBar(title: String, action: String, enabled: Boolean, onCancel: () -> Unit, onAction: () -> Unit) {
    val c = LocalNook.current
    Row(Modifier.fillMaxWidth().height(54.dp).lineBelow(c.line).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f)) { Box(Modifier.tap(onClick = onCancel).padding(vertical = 8.dp)) { T("Cancel", Fs.base) } }
        T(title, Fs.xl, FontWeight.Bold)
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) { Pill(action, Btn.Pri, enabled = enabled, onClick = onAction) }
    }
}

@Composable
private fun ComposePanel(app: AppState) {
    val c = LocalNook.current
    var text by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize()) {
        MBar("", "Post", text.isNotBlank(), { app.panel = null }) { app.panel = null; app.say("Posted") }
        Row(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Avatar(Sample.me, 40.dp)
            BasicTextField(
                text, { text = it }, Modifier.weight(1f).heightIn(min = 130.dp).padding(vertical = 6.dp),
                textStyle = LocalTextStyle.current.copy(color = c.fg, fontSize = Fs.xl, lineHeight = (17 * 1.4).sp), cursorBrush = SolidColor(c.accent),
                decorationBox = { inner -> Box { if (text.isEmpty()) T(Sample.placeholder, Fs.xl, color = c.muted); inner() } },
            )
        }
        // .cfoot: the camera and gallery buttons in the accent color
        Row(Modifier.fillMaxWidth().lineAbove(c.line).padding(horizontal = 16.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            IB("camera", tint = c.accent); IB("image", tint = c.accent)
        }
    }
}

@Composable
private fun EditProfilePanel(app: AppState) {
    val c = LocalNook.current
    var name by remember { mutableStateOf(Sample.me.name) }
    var handle by remember { mutableStateOf(Sample.me.handle) }
    var bio by remember { mutableStateOf(Sample.me.bio) }
    var style by remember { mutableIntStateOf(0) }
    Column(Modifier.fillMaxSize()) {
        MBar("Edit profile", "Save", true, { app.panel = null }) { app.panel = null; app.say("Saved") }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp)) {
            // .ebanner with its photo button, then the picture overlapping it (.eav)
            Box(Modifier.fillMaxWidth().aspectRatio(1000f / 330f).clip(RoundedCornerShape(Rad.m)).background(Brush.linearGradient(listOf(c.b1, c.b2)))) {
                PickBtn(Modifier.align(Alignment.BottomEnd).padding(8.dp))
            }
            Box(Modifier.padding(start = 12.dp).offset(y = (-44).dp).width(88.dp)) {
                Avatar(Sample.me, 88.dp, ring = c.bg)
                PickBtn(Modifier.align(Alignment.BottomEnd).offset(x = 6.dp, y = (-2).dp))
            }
            Column(Modifier.offset(y = (-44).dp)) {
                FldLabel("Banner style")
                Seg(listOf("Default", "Blurred photo"), style, Modifier.padding(start = 16.dp, end = 16.dp, top = 6.dp)) { style = it }
                FldLabel("Display name", top = 34.dp); Field(name, { name = it }, "Display name", Modifier.padding(top = 6.dp))
                FldLabel("Handle", top = 18.dp); Field(handle, { handle = it }, "Handle", Modifier.padding(top = 6.dp))
                FldLabel("Bio", top = 18.dp); Field(bio, { bio = it }, "", Modifier.padding(top = 6.dp), lines = 3)
            }
        }
    }
}

@Composable
private fun FldLabel(t: String, top: androidx.compose.ui.unit.Dp = 8.dp) = T(t, Fs.sm, FontWeight.SemiBold, LocalNook.current.muted, Modifier.padding(top = top))

// .pick: the small dark round photo button
@Composable
private fun PickBtn(modifier: Modifier) {
    Box(modifier.size(32.dp).clip(CircleShape).background(Color(0xA6000000)).tap(CircleShape) {}, contentAlignment = Alignment.Center) { NIcon("camera", 18.dp, Color.White) }
}
