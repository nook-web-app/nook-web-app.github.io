package io.github.nookwebapp.native_ui

import android.graphics.Bitmap
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.LocalTextStyle
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

// openCompose(): a new post, a reply (with the post it answers quoted above) or an edit; up to four photos.
// Cancel asks before throwing away what was typed; leaving with the back button keeps an unsent new post as a draft.
@Composable
fun ComposePanel(app: AppState, o: Panel.Compose) {
    val c = LocalNook.current
    val s = app.store
    val parent = s.byId(o.parent)
    val ed = s.byId(o.edit)
    val draft = s.draft?.takeIf { ed == null && parent == null && Clock.now() - it.second < 120_000 }?.first ?: ""
    val start = remember { ed?.text ?: o.text.ifEmpty { draft } }
    var text by remember { mutableStateOf(start) }
    val imgs = remember { mutableStateListOf<String>().apply { ed?.let { addAll(it.imgs) }; addAll(o.files.take(4)) } }
    val full = imgs.size >= 4
    val picker = rememberPicker(4 - imgs.size) { got ->
        val room = 4 - imgs.size
        imgs.addAll(got.take(room))
        if (got.size > room) app.say("Only 4 allowed, extra ones skipped")
    }
    LaunchedEffect(Unit) { when (o.pick) { "camera" -> picker.camera(); "image" -> picker.gallery() } }
    DisposableEffect(Unit) {
        app.panelBackHooks[o] = { if (ed == null && parent == null && text.isNotBlank()) { s.draft = text to Clock.now(); app.persist() } }
        onDispose { }
    }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { if (o.pick == null) runCatching { focus.requestFocus() } }
    val kind = if (ed != null) "Save" else if (parent != null) "Reply" else "Post"
    Modal("", kind, enabled = text.isNotBlank() || imgs.isNotEmpty(), onCancel = {
        val dirty = text != start || imgs.size != (ed?.imgs?.size ?: 0)
        if (dirty) app.open(listOf(SheetItem("Discard", danger = true) { s.draft = null; app.persist(); app.closePanel(o) }, SheetItem("Keep editing", cancel = true)), "Discard this post?")
        else app.closePanel(o)
    }, onAction = {
        val t = cleanText(text.trim())
        if (bannedHit(t) != null) app.say("That post has a banned word")
        else {
            if (ed != null) app.saveEdit(ed, t, imgs.toList()) else app.newPost(t, imgs.toList(), parent?.id)
            app.closePanel(o)
        }
    }, foot = {
        // .cfoot: the camera and gallery buttons in the accent color, dimmed once four photos are in
        Row(Modifier.fillMaxWidth().lineAbove(c.line).padding(horizontal = 16.dp).vpad(6.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            IB("camera", tint = c.accent, enabled = !full) { picker.camera() }
            IB("image", tint = c.accent, enabled = !full) { picker.gallery() }
        }
    }) {
        if (parent != null) Box(Modifier.fillMaxWidth().padding(bottom = 12.dp).clip(RoundedCornerShape(Rad.m)).border(1.dp, c.line, RoundedCornerShape(Rad.m)).padding(horizontal = 12.dp, vertical = 10.dp)) {
            // .quote: the name and the words are one block of text, the words flowing on after the name
            val who = if (parent.ai) "Zenith" else parent.ra?.let { it.name.ifEmpty { "@" + it.handle } } ?: s.profile.name.ifEmpty { "@" + s.profile.handle }
            val body = if (parent.text.isNotEmpty()) parent.text.take(140) else "Photo post"
            androidx.compose.material3.Text(
                androidx.compose.ui.text.buildAnnotatedString {
                    withStyle(androidx.compose.ui.text.SpanStyle(fontWeight = FontWeight.Bold, color = c.fg)) { append(who) }
                    withStyle(androidx.compose.ui.text.SpanStyle(color = c.muted)) { append(" $body") }
                },
                style = LocalTextStyle.current.copy(fontSize = Fs.md, lineHeight = (Fs.md.value * 1.4f).sp),
            )
        }
        // .crow: the avatar and the text box (17px, at least 130dp tall)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            MyAvatar(40.dp)
            BasicTextField(
                text, { if (it.length <= 5000) text = it }, Modifier.weight(1f).heightIn(min = 130.dp).vpad(6.dp).focusRequester(focus),
                textStyle = LocalTextStyle.current.copy(color = c.fg, fontSize = Fs.xl, lineHeight = (17 * 1.4).sp), cursorBrush = SolidColor(c.accent),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                decorationBox = { inner -> Box { if (text.isEmpty()) T(if (parent != null) "Write your reply" else app.ph, Fs.xl, color = c.muted); inner() } },
            )
        }
        // .cimgs: the chosen photos in four columns, each with a remove button
        if (imgs.isNotEmpty()) Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (i in 0 until 4) Box(Modifier.weight(1f).aspectRatio(1f)) {
                if (i < imgs.size) {
                    Pic(imgs[i], Modifier.fillMaxSize().clip(RoundedCornerShape(Rad.s)), want = 400)
                    Box(Modifier.align(Alignment.TopEnd).padding(4.dp).size(26.dp).clip(CircleShape).background(Color(0xA6000000)).tap(CircleShape) { imgs.removeAt(i) }, contentAlignment = Alignment.Center) { NIcon("close", 20.dp, Color.White) }
                }
            }
        }
    }
}

// editProfile(): banner and picture (each cropped first), banner style, display name (15), handle (15, letters, numbers,
// dots and underscores) and bio (500)
@Composable
fun EditProfilePanel(app: AppState, me: Panel) {
    val c = LocalNook.current
    val pr = app.store.profile
    var avatar by remember { mutableStateOf(pr.avatar) }
    var banner by remember { mutableStateOf(pr.banner) }
    var theme by remember { mutableStateOf(if (pr.bannerTheme == "avatar") "avatar" else "default") }
    var name by remember { mutableStateOf(pr.name) }
    var handle by remember { mutableStateOf(pr.handle) }
    var bio by remember { mutableStateOf(pr.bio) }
    var saving by remember { mutableStateOf(false) }
    val lockDays = pr.handleChangedAt?.let { val t = parseIso(it) + 7 * 86_400_000 - System.currentTimeMillis(); if (t > 0) Math.ceil(t / 86_400_000.0).toInt() else 0 } ?: 0
    val crop: (Boolean, Int, Int, String, (String) -> Unit) -> (List<String>) -> Unit = { round, w, h, title, set ->
        { got -> got.firstOrNull()?.let { src -> app.panels.add(Panel.Crop(src, round, w, h, title) { out -> if (out != null) set(out) }) }; Unit }
    }
    val bannerPick = rememberPicker(1, crop(false, 1000, 330, "Crop banner") { banner = it; theme = "default" })
    val avatarPick = rememberPicker(1, crop(true, 320, 320, "Crop profile photo") { avatar = it })
    Modal("Edit profile", "Save", top = true, onCancel = {
        val dirty = name.trim() != pr.name || handle.trim().lowercase() != pr.handle || bio != pr.bio || avatar != pr.avatar || banner != pr.banner || theme != (if (pr.bannerTheme == "avatar") "avatar" else "default")
        if (dirty) app.open(listOf(SheetItem("Discard changes", danger = true) { app.closePanel(me) }, SheetItem("Keep editing", cancel = true)), "Discard your changes?")
        else app.closePanel(me)
    }, onAction = {
        if (!saving) {
            saving = true
            app.scope.launch { val r = app.on.saveProfile(name, handle, bio, avatar, banner, theme); saving = false; if (r == null) app.closePanel(me) else app.say(r) }
        }
    }, enabled = !saving) {
        // .ebanner: the banner as it will look, with its photo button
        Box(Modifier.fillMaxWidth().aspectRatio(1000f / 330f).clip(RoundedCornerShape(Rad.m))) {
            BannerPic(banner, avatar, theme)
            PickBtn(Modifier.align(Alignment.BottomEnd).padding(8.dp)) {
                if (banner == null) bannerPick.gallery()
                else app.open(listOf(SheetItem("Choose a photo", "image") { bannerPick.gallery() }, SheetItem("Remove banner", "trash", danger = true) { banner = null; if (avatar == null) theme = "default" }, SheetItem("Cancel", cancel = true)), "Banner")
            }
        }
        // .eav: the picture over the banner's edge, with its own photo button
        Box(Modifier.padding(start = 12.dp).layoutOffsetUp(44.dp).width(88.dp)) {
            EditAvatar(avatar, name.ifBlank { handle })
            PickBtn(Modifier.align(Alignment.BottomEnd).offset(x = 6.dp, y = (-2).dp), icon = 16.dp) {
                if (avatar == null) avatarPick.gallery()
                else app.open(listOf(SheetItem("Choose a photo", "image") { avatarPick.gallery() }, SheetItem("Remove photo", "trash", danger = true) { avatar = null; if (banner == null) theme = "default" }, SheetItem("Cancel", cancel = true)), "Profile photo")
            }
        }
        Fld("Banner style") { Seg(listOf("Default", "Blurred photo"), if (theme == "avatar") 1 else 0, Modifier.padding(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 14.dp)) { if (it == 1 && banner == null && avatar == null) app.say("Pick a picture first") else theme = if (it == 1) "avatar" else "default" } }
        Fld("Display name") { Field(name, { if (it.length <= 15) name = it }, "") }
        Fld("Handle") {
            Column {
                Field(handle, { if (it.length <= 15 && lockDays == 0) handle = it }, "")
                if (lockDays > 0) T("You changed your handle recently. You can change it again in $lockDays" + (if (lockDays == 1) " day." else " days."), Fs.sm, color = c.muted, modifier = Modifier.padding(top = 6.dp))
            }
        }
        Fld("Bio") { Field(bio, { if (it.length <= 500) bio = it }, "", lines = 3) }
    }
}

// the banner: a photo of its own, or (Blurred photo) the profile picture enlarged from a small copy, or the gradient.
// The gradient is only drawn until the photo is in, so none of it shows along the photo's edges.
@Composable
fun BannerPic(banner: String?, avatar: String?, theme: String, modifier: Modifier = Modifier.fillMaxSize()) {
    val c = LocalNook.current
    var ok by remember(banner, avatar, theme) { mutableStateOf(false) }
    Box(modifier.then(if (ok) Modifier else Modifier.background(Brush.linearGradient(listOf(c.b1, c.b2), Offset.Zero, Offset.Infinite)))) {
        when {
            theme == "avatar" && (banner ?: avatar) != null -> {
                val src = (banner ?: avatar)!!
                val px = with(androidx.compose.ui.platform.LocalDensity.current) { androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp.dp.toPx() }
                // like the web app's soft look: a tenth of the size scaled up (the smoothing is the blur), a little larger than the
                // box so no edge shows, and a real blur on top where the phone can do it (Android 12 and later)
                val soft = if (android.os.Build.VERSION.SDK_INT >= 31) Modifier.blur(10.dp, androidx.compose.ui.draw.BlurredEdgeTreatment.Unbounded) else Modifier
                Box(Modifier.fillMaxSize().clipToBounds()) {
                    Pic(src, Modifier.fillMaxSize().graphicsLayer { scaleX = 1.3f; scaleY = 1.3f }.then(soft), want = (px / 10).toInt().coerceIn(24, 96), smooth = true, small = true, bare = true) { _, _ -> ok = true }
                }
            }
            banner != null -> Pic(banner, Modifier.fillMaxSize(), want = 1000, bare = true) { _, _ -> ok = true }
        }
    }
}

@Composable
private fun EditAvatar(avatar: String?, name: String) {
    val c = LocalNook.current
    Box(Modifier.size(88.dp).clip(CircleShape).background(c.bg), contentAlignment = Alignment.Center) {
        RoundPic(avatar, 80.dp, SolidColor(c.accent)) { T(name.trim().take(1).uppercase().ifEmpty { "?" }, Fs.av, FontWeight.Bold, c.on, lineHeight = 44.sp) }
    }
}

// openCropper(): drag to move, pinch to zoom (up to 4x), the frame is a circle for the picture or the banner's shape
// with thirds lines; Done saves the framed part at the size asked for
@Composable
fun CropPanel(app: AppState, p: Panel.Crop) {
    val c = LocalNook.current
    var img by remember { mutableStateOf<ImageBitmap?>(null) }
    LaunchedEffect(p.src) { img = Photos.load(p.src, 2048) }
    // the frame in canvas pixels, kept up to date by the drawing below so Done cuts exactly what is shown
    var frame by remember { mutableStateOf(Rect.Zero) }
    var s by remember { mutableFloatStateOf(0f) }
    var cx by remember { mutableFloatStateOf(0f) }
    var cy by remember { mutableFloatStateOf(0f) }
    DisposableEffect(Unit) { app.panelBackHooks[p] = { p.done(null) }; onDispose { } }
    val scope = rememberCoroutineScope()
    Modal(p.title, "Done", onCancel = { app.closePanel(p); p.done(null) }, onAction = {
        val im = img
        val d = app.store.mediaDir
        if (im != null && d != null && s > 0f) scope.launch {
            if (p.src.endsWith(".gif")) {
                // cropGif(): the area picked on the first frame is cut from every frame and the GIF is made again
                app.say("Cropping your GIF...")
                val path = withContext(Dispatchers.Default) {
                    val b = File(p.src).readBytes()
                    val real = Gif.size(b) ?: return@withContext null
                    val k = real.first.toFloat() / im.width
                    val left = cx - im.width * s / 2; val top = cy - im.height * s / 2
                    val out = Gif.crop(b, (frame.left - left) / s * k, (frame.top - top) / s * k, frame.width / s * k, frame.height / s * k, p.w, p.h, p.round) ?: return@withContext null
                    File(d, uid() + ".gif").apply { writeBytes(out) }.absolutePath
                }
                if (path == null) { app.say(if (File(p.src).length() > Gif.MAX) "That GIF is too big to crop (over 12 MB)" else "Could not crop that GIF"); return@launch }
                app.closePanel(p); p.done(path)
                return@launch
            }
            val out = withContext(Dispatchers.Default) { cropOut(im, s, cx, cy, frame, p) }
            val path = withContext(Dispatchers.IO) { Photos.saveBitmap(d, out, if (p.round) "image/png" else "image/jpeg") }
            app.closePanel(p); p.done(path)
        }
    }) {
        val im = img
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val W = minOf(maxWidth, 520.dp)
            val pad = 16.dp
            val fw = W - pad * 2
            val fh = if (p.round) fw else fw * p.h.toFloat() / p.w
            val H = if (p.round) W else maxOf(fh + pad * 2 + 80.dp, W * 0.8f)
            Canvas(Modifier.size(W, H).align(Alignment.Center).clipToBounds().pointerInput(im) {
                detectTransformGestures { centroid, pan, zoom, _ ->
                    if (im == null || s <= 0f) return@detectTransformGestures
                    val minS = maxOf(fw.toPx() / im.width, fh.toPx() / im.height)
                    val ns = (s * zoom).coerceIn(minS, minS * 4)
                    val g = ns / s
                    cx = centroid.x + (cx - centroid.x) * g + pan.x; cy = centroid.y + (cy - centroid.y) * g + pan.y; s = ns
                    val (x, y) = clampCrop(im, s, cx, cy, pad.toPx(), (size.height - fh.toPx()) / 2, fw.toPx(), fh.toPx()); cx = x; cy = y
                }
            }) {
                if (im == null) return@Canvas
                val fl = pad.toPx(); val ft = (size.height - fh.toPx()) / 2; val fwp = fw.toPx(); val fhp = fh.toPx()
                if (s == 0f) { s = maxOf(fwp / im.width, fhp / im.height); cx = size.width / 2; cy = size.height / 2 }
                frame = Rect(fl, ft, fl + fwp, ft + fhp)
                drawRect(c.bg2)
                drawImage(im, dstOffset = androidx.compose.ui.unit.IntOffset((cx - im.width * s / 2).toInt(), (cy - im.height * s / 2).toInt()), dstSize = IntSize((im.width * s).toInt(), (im.height * s).toInt()))
                val hole = Path().apply {
                    fillType = PathFillType.EvenOdd
                    addRect(Rect(0f, 0f, size.width, size.height))
                    if (p.round) addOval(Rect(Offset(size.width / 2, size.height / 2), fwp / 2)) else addRect(Rect(fl, ft, fl + fwp, ft + fhp))
                }
                drawPath(hole, Color(0x800A0F14))
                if (p.round) drawCircle(Color.White, fwp / 2, Offset(size.width / 2, size.height / 2), style = Stroke(1.5.dp.toPx()))
                else {
                    drawRect(Color.White, Offset(fl, ft), Size(fwp, fhp), style = Stroke(1.5.dp.toPx()))
                    for (i in 1..2) {
                        drawLine(Color.White.copy(alpha = 0.3f), Offset(fl + fwp * i / 3, ft), Offset(fl + fwp * i / 3, ft + fhp), 1.dp.toPx())
                        drawLine(Color.White.copy(alpha = 0.3f), Offset(fl, ft + fhp * i / 3), Offset(fl + fwp, ft + fhp * i / 3), 1.dp.toPx())
                    }
                }
            }
        }
        T("Drag to move, pinch to zoom", Fs.sm, color = c.muted, align = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 12.dp))
    }
}

private fun clampCrop(im: ImageBitmap, s: Float, cx: Float, cy: Float, fl: Float, ft: Float, fw: Float, fh: Float): Pair<Float, Float> {
    // the picture always covers the frame; when it is exactly as big as the frame the two limits meet (and rounding
    // can even swap them), so the middle of the two is taken then instead of failing
    val hw = im.width * s / 2; val hh = im.height * s / 2
    fun fit(v: Float, lo: Float, hi: Float) = if (lo <= hi) v.coerceIn(lo, hi) else (lo + hi) / 2
    return fit(cx, fl + fw - hw, fl + hw) to fit(cy, ft + fh - hh, ft + hh)
}

// the framed part of the photo, at p.w x p.h pixels (on white unless it is the round picture)
private fun cropOut(im: ImageBitmap, s: Float, cx: Float, cy: Float, frame: Rect, p: Panel.Crop): Bitmap {
    val left = cx - im.width * s / 2; val top = cy - im.height * s / 2
    val out = Bitmap.createBitmap(p.w, p.h, Bitmap.Config.ARGB_8888)
    val cv = android.graphics.Canvas(out)
    if (!p.round) cv.drawColor(android.graphics.Color.WHITE)
    val sx = (frame.left - left) / s; val sy = (frame.top - top) / s
    val src = android.graphics.RectF(sx, sy, sx + frame.width / s, sy + frame.height / s)
    val m = android.graphics.Matrix().apply { setRectToRect(src, android.graphics.RectF(0f, 0f, p.w.toFloat(), p.h.toFloat()), android.graphics.Matrix.ScaleToFit.FILL) }
    cv.drawBitmap(im.asAndroidBitmap(), m, android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG))
    return out
}
