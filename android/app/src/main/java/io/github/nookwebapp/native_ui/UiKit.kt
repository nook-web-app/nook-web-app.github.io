package io.github.nookwebapp.native_ui

import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.ui.composed
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.runtime.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.collectLatest
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.animation.core.animateFloat
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.offset
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt

// Small building blocks that match the web app's CSS classes one to one (the class name is in each comment).

@Composable
fun T(
    text: String, size: TextUnit = Fs.base, weight: FontWeight = FontWeight.Normal, color: Color = LocalContentColor.current,
    modifier: Modifier = Modifier, lineHeight: TextUnit = TextUnit.Unspecified, align: TextAlign? = null, maxLines: Int = Int.MAX_VALUE,
    letterSpacing: TextUnit = TextUnit.Unspecified,
) {
    val lh = if (lineHeight == TextUnit.Unspecified) (size.value * 1.4f).sp else lineHeight
    // a text box is as tall as its lines (rounded to the nearest pixel) instead of always rounded up, like the browser's
    // fractional layout; otherwise every line of text pushes what follows down by up to a pixel
    val lhPx = with(androidx.compose.ui.platform.LocalDensity.current) { lh.toPx() }
    var lines = 1
    Text(
        text, modifier.layout { m, c ->
            val p = m.measure(c)
            val h = (lines * lhPx).roundToInt().coerceIn(minOf(c.minHeight, p.height), p.height)
            layout(p.width, h) { p.place(0, 0) }
        }, color = color, style = LocalTextStyle.current.copy(fontSize = size, fontWeight = weight, lineHeight = lh, letterSpacing = letterSpacing),
        textAlign = align, maxLines = maxLines, overflow = if (maxLines == Int.MAX_VALUE) TextOverflow.Clip else TextOverflow.Ellipsis,
        onTextLayout = { lines = it.lineCount },
    )
}

// a tap target with no highlight of its own, like the web app (which turns off the tap highlight everywhere)
// (no composed{} here and one shared source: nothing listens to a tap target, and a post has a dozen of them, so each
// one saves a composition scope and a remembered source every time a post scrolls into view)
private val TapSource = MutableInteractionSource()
fun Modifier.tap(shape: androidx.compose.ui.graphics.Shape? = null, enabled: Boolean = true, onClick: () -> Unit): Modifier =
    (if (shape != null) this.clip(shape) else this).clickable(TapSource, null, enabled = enabled, onClick = onClick)

// .ib, .pri, .ghost, .fab and the bottom bar buttons shrink to 92% while held (transform .12s)
fun Modifier.pressTap(shape: androidx.compose.ui.graphics.Shape? = null, enabled: Boolean = true, onClick: () -> Unit): Modifier = composed {
    val src = remember { MutableInteractionSource() }
    val down by src.collectIsPressedAsState()
    val k by androidx.compose.animation.core.animateFloatAsState(if (down) 0.92f else 1f, androidx.compose.animation.core.tween(120), label = "press")
    val m = this.graphicsLayer { scaleX = k; scaleY = k }.let { if (shape != null) it.clip(shape) else it }
    m.clickable(src, null, enabled = enabled, onClick = onClick)
}

// .si and .sx get --bg2 behind them while held (background-color .15s)
fun Modifier.pressBg(shape: androidx.compose.ui.graphics.Shape, on: Boolean = false, onClick: () -> Unit): Modifier = composed {
    val src = remember { MutableInteractionSource() }
    val down by src.collectIsPressedAsState()
    val c = LocalNook.current
    val bg by androidx.compose.animation.animateColorAsState(if (down || on) c.bg2 else c.bg2.copy(alpha = 0f), androidx.compose.animation.core.tween(150), label = "pressbg")
    this.clip(shape).drawBehind { drawRect(bg) }.clickable(src, null, onClick = onClick)
}

// Layout probes for the screenshot tests: when on, tagged elements record where they ended up (in dp from the top left),
// so their places can be compared with the same elements of the web app number by number.
object Probes { var on = false; val at = linkedMapOf<String, androidx.compose.ui.geometry.Rect>() }
fun Modifier.probe(tag: String): Modifier = if (!Probes.on) this else composed {
    val d = androidx.compose.ui.platform.LocalDensity.current.density
    this.then(Modifier.onGloballyPositioned { val r = it.boundsInRoot(); Probes.at[tag] = androidx.compose.ui.geometry.Rect(r.left / d, r.top / d, r.right / d, r.bottom / d) })
}

// Vertical padding that keeps the browser's fractional sizes in check: the top and bottom are added up first and rounded
// once (halves to even), so a row with 14dp above and below is exactly 28dp of room on any screen density instead of
// gaining a pixel every time a half pixel is rounded up.
fun Modifier.vpad(top: Dp, bottom: Dp = top) = this.then(Modifier.layout { m, c ->
    val t = top.toPx(); val total = Math.rint((t + bottom.toPx()).toDouble()).toInt()
    val p = m.measure(c.offset(vertical = -total))
    val y = Math.rint(t.toDouble()).toInt().coerceIn(0, total)
    layout(p.width, p.height + total) { p.place(0, y) }
})

// a 1px rule in --line, drawn under the content (border-bottom)
// like a CSS border, the line takes its own 1dp of room (with box-sizing:border-box a fixed height already includes it)
fun Modifier.lineBelow(color: Color) = drawBehind { val w = 1.dp.toPx(); drawRect(color, Offset(0f, size.height - w), androidx.compose.ui.geometry.Size(size.width, w)) }.padding(bottom = 1.dp)
fun Modifier.lineAbove(color: Color) = drawBehind { drawRect(color, Offset.Zero, androidx.compose.ui.geometry.Size(size.width, 1.dp.toPx())) }.padding(top = 1.dp)

@Composable
fun Line() { Box(Modifier.fillMaxWidth().height(1.dp).background(LocalNook.current.line)) }

// .av: the owner's round photo; without one, the first letter of the name on the accent color
@Composable
fun MyAvatar(size: Dp = 40.dp, ring: Color? = null, modifier: Modifier = Modifier) {
    val c = LocalNook.current
    val pr = LocalApp.current.store.profile
    // with a ring (border: 4px solid --bg) the picture sits inside the ring instead of under it, so no photo pixels
    // peek out at the ring's edge
    val inner = if (ring != null) size - 8.dp else size
    Box(modifier.size(size).then(if (ring != null) Modifier.clip(CircleShape).background(ring) else Modifier), contentAlignment = Alignment.Center) {
        RoundPic(pr.avatar, inner, androidx.compose.ui.graphics.SolidColor(c.accent)) {
            val letter = pr.name.ifBlank { pr.handle }.ifBlank { "?" }.trim().take(1).uppercase()
            T(letter, size = (inner.value * 0.4f * size.value / inner.value).roundToInt().sp, weight = FontWeight.Bold, color = c.on, lineHeight = (size.value * 0.5f).sp)
        }
    }
}

fun hsl(h: Float, s: Float, l: Float): Color {
    val a = s * minOf(l, 1 - l)
    fun f(n: Int): Float { val k = (n + h / 30f) % 12f; return l - a * maxOf(-1f, minOf(k - 3f, 9f - k, 1f)) }
    return Color(f(0), f(8), f(4))
}

// the color of someone's letter avatar comes from their name, like rAv() does
fun hueOf(seed: String): Float {
    var h = 7L
    for (ch in seed) h = (h * 31 + ch.code) and 0xFFFFFFFFL
    return (h % 360).toFloat()
}

// .ib: a 44dp round icon button in the muted color
@Composable
fun IB(icon: String, size: Dp = 24.dp, tint: Color = LocalNook.current.muted, box: Dp = 44.dp, height: Dp = box, fill: Boolean = false, enabled: Boolean = true, onClick: () -> Unit = {}) {
    Box(Modifier.size(box, height).alpha(if (enabled) 1f else 0.4f).pressTap(CircleShape, enabled, onClick), contentAlignment = Alignment.Center) {
        NIcon(icon, size, tint, fill)
    }
}

// .bar: 44dp, the title, 44dp, 54dp high, with the line under the whole top area drawn by Top()
@Composable
fun Bar(title: String, left: (@Composable () -> Unit)? = null, right: (@Composable () -> Unit)? = null) {
    val app = LocalApp.current
    val page = LocalPage.current
    val scope = rememberCoroutineScope()
    // a tap anywhere on the bar (the buttons keep their own taps) brings the page back to its top
    Row(Modifier.fillMaxWidth().height(54.dp).tap { scope.launch { app.listStateFor(page).toTop() } }.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.width(44.dp).offset(x = (-10).dp), contentAlignment = Alignment.CenterStart) { left?.invoke() }
        T(title, Fs.xl, FontWeight.Bold, modifier = Modifier.weight(1f), align = TextAlign.Center, maxLines = 1)
        // only the left button is pulled out by 10dp: in the CSS grid the right one keeps its place (margin-right does not move it)
        Box(Modifier.width(44.dp), contentAlignment = Alignment.CenterEnd) { right?.invoke() }
    }
}

// #top: whatever sits above the page, with one line under it
@Composable
fun Top(content: @Composable ColumnScope.() -> Unit) {
    val c = LocalNook.current
    Column(Modifier.fillMaxWidth().background(c.bg).lineBelow(c.line), content = content)
}

// .tabs / .tab: each tab is as wide as its text plus 14dp on each side, and the room left over is shared out equally
// (flex: 1 0 auto); when the tabs do not fit, the row scrolls. The chosen tab has a 3dp accent line under its text.
@Composable
fun Tabs(items: List<String>, selected: Int, scroll: Boolean = false, onSelect: (Int) -> Unit) {
    val c = LocalNook.current
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val room = maxWidth - 32.dp
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
            androidx.compose.ui.layout.Layout(content = {
                items.forEachIndexed { i, t ->
                    val on = i == selected
                    Box(Modifier.tap { onSelect(i) }.padding(horizontal = 14.dp), contentAlignment = Alignment.Center) {
                        Box(Modifier.drawBehind { if (on) drawRect(c.accent, Offset(0f, size.height - 3.dp.toPx()), androidx.compose.ui.geometry.Size(size.width, 3.dp.toPx())) }
                            .vpad(13.dp, 11.dp + 3.dp)) {
                            T(t, Fs.base, if (on) FontWeight.Bold else FontWeight.SemiBold, if (on) c.fg else c.muted, maxLines = 1)
                        }
                    }
                }
            }) { ms, cons ->
                val natural = ms.map { it.maxIntrinsicWidth(cons.maxHeight) }
                val extra = ((room.roundToPx() - natural.sum()).coerceAtLeast(0)).toFloat() / ms.size
                var acc = 0f
                val ps = ms.mapIndexed { i, m ->
                    // the shares are rounded so that together they still add up to the whole row
                    val from = acc.roundToInt(); acc += natural[i] + extra
                    m.measure(androidx.compose.ui.unit.Constraints.fixedWidth(acc.roundToInt() - from))
                }
                layout(ps.sumOf { it.width }, ps.maxOf { it.height }) { var x = 0; ps.forEach { it.place(x, 0); x += it.width } }
            }
        }
    }
}

// .pri: the filled pill, .ghost: the outlined pill, .fbtn: the light pill used for Follow
enum class Btn { Pri, Ghost, F, FOn }
@Composable
fun Pill(label: String, kind: Btn = Btn.Pri, small: Boolean = false, enabled: Boolean = true, modifier: Modifier = Modifier, onClick: () -> Unit = {}) {
    val c = LocalNook.current
    val shape = RoundedCornerShape(Rad.pill)
    val (bg, fg) = when (kind) { Btn.Pri -> c.fill to c.on; Btn.Ghost, Btn.FOn -> Color.Transparent to c.fg; Btn.F -> c.fg to c.bg }
    val border = if (kind == Btn.Ghost || kind == Btn.FOn) Modifier.border(1.dp, c.line, shape) else Modifier
    Box(
        modifier.defaultMinSize(minHeight = if (small) 32.dp else 36.dp).alpha(if (enabled) 1f else 0.45f).clip(shape).background(bg).then(border)
            .pressTap(shape, enabled, onClick).padding(horizontal = if (small) 14.dp else 18.dp),
        contentAlignment = Alignment.Center,
    ) { T(label, if (small) Fs.md else Fs.base, if (kind == Btn.Ghost) FontWeight.SemiBold else FontWeight.Bold, fg, maxLines = 1) }
}

// .empty: a big muted icon, a short line and maybe a button, centered with 56dp above and below
@Composable
fun Empty(icon: String?, text: String, iconSize: Dp = 56.dp, button: (@Composable () -> Unit)? = null) {
    val c = LocalNook.current
    // the line is at most 30 characters wide (max-width: 30ch, the width of thirty zeros)
    val measurer = androidx.compose.ui.text.rememberTextMeasurer()
    val style = LocalTextStyle.current
    val ch = remember(style) { measurer.measure("0".repeat(30), style.copy(fontSize = Fs.base)).size.width }
    val maxW = with(androidx.compose.ui.platform.LocalDensity.current) { ch.toDp() }
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 56.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        if (icon != null) NIcon(icon, iconSize, c.muted, modifier = Modifier.alpha(0.8f))
        T(text, color = c.muted, align = TextAlign.Center, modifier = Modifier.widthIn(max = maxW))
        button?.invoke()
    }
}

// .sec: the small upper case heading of a settings group
@Composable
fun Sec(text: String) {
    T(text.uppercase(), Fs.sm, FontWeight.Bold, LocalNook.current.muted, Modifier.probe("sec:$text").padding(horizontal = 16.dp).vpad(18.dp, 6.dp), letterSpacing = (13 * 0.06).sp)
}

// .seg: a pill of choices with the chosen one filled
@Composable
fun Seg(items: List<String>, selected: Int, modifier: Modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 14.dp), onSelect: (Int) -> Unit) {
    val c = LocalNook.current
    Row(modifier.fillMaxWidth().clip(RoundedCornerShape(Rad.pill)).background(c.bg2).padding(4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        items.forEachIndexed { i, t ->
            val on = i == selected
            Box(Modifier.weight(1f).clip(RoundedCornerShape(Rad.pill)).background(if (on) c.fill else Color.Transparent).tap { onSelect(i) }.padding(9.dp), contentAlignment = Alignment.Center) {
                T(t, Fs.base, FontWeight.SemiBold, if (on) c.on else c.muted)
            }
        }
    }
}

// .group with .srow rows: the rounded settings card
@Composable
fun Group(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 8.dp).fillMaxWidth().clip(RoundedCornerShape(Rad.m)).background(LocalNook.current.bg2), content = content)
}

@Composable
fun SRow(icon: (@Composable () -> Unit)?, title: String, sub: String? = null, danger: Boolean = false, last: Boolean = false, onClick: () -> Unit = {}) {
    val c = LocalNook.current
    val col = if (danger) c.danger else c.fg
    Row(
        Modifier.fillMaxWidth().probe("srow:$title").then(if (last) Modifier else Modifier.lineBelow(c.line)).tap(onClick = onClick).padding(horizontal = 16.dp).vpad(14.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        if (icon != null) CompositionLocalProvider(LocalContentColor provides if (danger) c.danger else c.muted) { icon() }
        Column(Modifier.weight(1f)) {
            T(title, weight = FontWeight.SemiBold, color = col, maxLines = 1, modifier = Modifier.probe("srow-b:$title"))
            if (sub != null) T(sub, Fs.sm, color = c.muted, maxLines = 1, modifier = Modifier.probe("srow-sub:$title"))
        }
    }
}

// .lrow: a person, chat or list in a list
@Composable
fun LRow(lead: @Composable () -> Unit, title: String, sub: String? = null, time: String? = null, trail: (@Composable () -> Unit)? = null, subStrong: Boolean = false, onClick: () -> Unit = {}) {
    val c = LocalNook.current
    Row(
        Modifier.fillMaxWidth().lineBelow(c.line).tap(onClick = onClick).padding(horizontal = 16.dp).vpad(14.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        lead()
        Column(Modifier.weight(1f)) {
            T(title, weight = FontWeight.Bold, maxLines = 1)
            if (sub != null) T(sub, Fs.md, color = if (subStrong) c.fg else c.muted, maxLines = 1)
        }
        if (time != null) T(time, Fs.sm, color = c.muted, modifier = Modifier.align(Alignment.Top).padding(top = 2.dp))
        trail?.invoke()
    }
}

// .sq: the square tile used for lists
@Composable
fun Sq(icon: String) {
    val c = LocalNook.current
    Box(Modifier.size(44.dp).clip(RoundedCornerShape(Rad.s)).background(c.accent), contentAlignment = Alignment.Center) { NIcon(icon, 22.dp, c.on) }
}

// .in: a text field on --bg2 with rounded corners (and the accent outline while it has focus)
@Composable
fun Field(value: String, onChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier, lines: Int = 1, border: Boolean = false, password: Boolean = false, trailing: (@Composable () -> Unit)? = null) {
    val c = LocalNook.current
    var focused by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(Rad.s)
    val outline = when { focused -> Modifier.border(2.dp, c.accent, shape); border -> Modifier.border(1.dp, c.line, shape); else -> Modifier }
    // .in: 21 of text, 10 above and below and a 1dp border (see-through unless it is outlined) make it 43 tall
    Row(modifier.fillMaxWidth().defaultMinSize(minHeight = 42.dp).clip(shape).background(c.bg2).then(outline).padding(horizontal = 13.dp, vertical = 11.dp), verticalAlignment = Alignment.CenterVertically) {
        BasicTextField(
            value, onChange, Modifier.weight(1f).onFocusChanged { focused = it.isFocused }, singleLine = lines == 1, minLines = lines,
            visualTransformation = if (password) androidx.compose.ui.text.input.PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
            textStyle = LocalTextStyle.current.copy(color = c.fg, fontSize = Fs.base), cursorBrush = SolidColor(c.accent),
            decorationBox = { inner -> Box { if (value.isEmpty()) T(placeholder, color = c.muted); inner() } },
        )
        trailing?.invoke()
    }
}

// .nbadge: the small count bubble
@Composable
fun Badge(n: Int, modifier: Modifier = Modifier) {
    val c = LocalNook.current
    Box(modifier.defaultMinSize(minWidth = 20.dp).height(20.dp).clip(RoundedCornerShape(Rad.pill)).background(c.accent).padding(horizontal = 6.dp), contentAlignment = Alignment.Center) {
        T(n.toString(), Fs.xs, FontWeight.SemiBold, c.on)
    }
}

// one clock for every placeholder on screen (NookApp runs it, and only while at least one placeholder is drawn)
class ShimmerClock { var users by mutableIntStateOf(0); var t by mutableFloatStateOf(0f) }
val LocalShimmer = staticCompositionLocalOf<ShimmerClock?> { null }

@Composable
fun RunShimmerClock(clock: ShimmerClock) {
    LaunchedEffect(clock) {
        snapshotFlow { clock.users > 0 }.collectLatest { on ->
            if (on) while (true) androidx.compose.runtime.withFrameNanos { n -> clock.t = (n / 1_000_000L % 1200L) / 1200f }
        }
    }
}

// .skel::after: a soft light band sweeps across a placeholder every 1.2 s until the real thing is drawn. Previews and the
// screenshot tests draw one still frame.
fun Modifier.shimmer(): Modifier = composed {
    val c = LocalNook.current
    val clock = LocalShimmer.current
    if (androidx.compose.ui.platform.LocalInspectionMode.current || clock == null) return@composed this
    DisposableEffect(clock) { clock.users++; onDispose { clock.users-- } }
    // the band is made once per size and only moved on each frame (a new gradient used to be made for every placeholder every frame)
    drawWithCache {
        val band = Brush.horizontalGradient(0.3f to Color.Transparent, 0.5f to c.line, 0.7f to Color.Transparent, startX = 0f, endX = size.width)
        onDrawWithContent {
            drawContent()
            val x = (clock.t * 2f - 1f) * size.width
            translate(left = x) { drawRect(band, size = size) }
        }
    }
}

// foldAway(): the height of a row goes to nothing in .2 s while it fades in .16 s; nothing plays when the row comes in
@Composable
fun FoldAway(gone: Boolean, content: @Composable () -> Unit) {
    androidx.compose.animation.AnimatedVisibility(
        !gone, enter = androidx.compose.animation.EnterTransition.None,
        exit = androidx.compose.animation.shrinkVertically(androidx.compose.animation.core.tween(200)) + androidx.compose.animation.fadeOut(androidx.compose.animation.core.tween(160)),
    ) { content() }
}

// back to the top: a long list first jumps close to it, so the glide is short and stays smooth
suspend fun androidx.compose.foundation.lazy.LazyListState.toTop() {
    if (firstVisibleItemIndex > 3) scrollToItem(3)
    animateScrollToItem(0)
}
