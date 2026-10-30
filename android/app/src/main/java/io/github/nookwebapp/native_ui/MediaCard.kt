package io.github.nookwebapp.native_ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

// where each "/media" card stands on this phone: the share of the file that came, or the place it was saved at
class MediaDl {
    companion object { val shared = MediaDl(); val scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.Main) }
    class St(val progress: Float, val saved: String?, val error: String?)
    val state = mutableStateMapOf<String, St>()
    fun saved(ctx: android.content.Context, id: String): String? = state[id]?.saved ?: ctx.getSharedPreferences("mdl", 0).getString(id, null)
    fun keep(ctx: android.content.Context, id: String, uri: String) { ctx.getSharedPreferences("mdl", 0).edit().putString(id, uri).apply() }
}

private fun clock(sec: Int) = if (sec <= 0) "" else if (sec >= 3600) "%d:%02d:%02d".format(sec / 3600, sec / 60 % 60, sec % 60) else "%d:%02d".format(sec / 60, sec % 60)

// the card of a link (like the one of a link in a chat) with the picture, the title and, where the caption sits, a blue button that
// saves the video, gif or picture on this phone
@Composable
fun MediaCard(m: LMsg) {
    val app = LocalApp.current
    val c = LocalNook.current
    val ctx = app.ctx
    val card = m.mcard ?: return
    val shape = RoundedCornerShape(Rad.bubble)
    val st = app.mdl.state[m.id]
    val saved = remember(m.id, st?.saved) { ctx?.let { app.mdl.saved(it, m.id) } }
    val busy = st != null && st.saved == null && st.error == null
    val meta = listOf(MediaGrab.siteName(card.optString("s")), clock(card.optInt("d")), MediaGrab.sizeText(card.optLong("z"))).filter { it.isNotEmpty() }.joinToString(" · ")
    Column(Modifier.fillMaxWidth(0.82f).widthIn(max = 320.dp).clip(shape).background(c.bg2)) {
        card.optString("i").takeIf { it.isNotEmpty() }?.let { img ->
            Box(Modifier.fillMaxWidth().aspectRatio(1f).background(c.bg2)) { LinkPicBox(img) }
        }
        Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            T(card.optString("t").ifEmpty { card.optString("u") }, weight = FontWeight.SemiBold, maxLines = 2)
            T(meta, Fs.xs, color = c.muted)
            val label = when {
                busy -> if (st!!.progress > 0f) "Downloading " + (st.progress * 100).toInt() + "%" else "Downloading..."
                saved != null -> "Open"
                st?.error != null -> "Try again"
                else -> "Download"
            }
            Pill(label, Btn.Pri, small = true, enabled = !busy, modifier = Modifier.fillMaxWidth().padding(top = 4.dp)) {
                ctx ?: return@Pill
                if (saved != null && st?.error == null) {
                    runCatching { openFile(ctx, Uri.parse(saved), card.optString("k")) }.onFailure { app.say("Could not open it. Look in your gallery") }
                } else {
                    app.mdl.state[m.id] = MediaDl.St(0f, null, null)
                    // the download belongs to the process, not to the screen: it goes on when the app is left or the screen is closed
                    val title = card.optString("t").ifEmpty { "Nook" }
                    MediaDl.scope.launch {
                        try {
                            val uri = Keep.around(ctx) {
                                Keep.progress(ctx, title, 0)
                                MediaGrab.save(ctx, card.optString("u"), card.optString("q")) { p -> app.mdl.state[m.id] = MediaDl.St(p, null, null); Keep.progress(ctx, title, (p * 100).toInt()) }
                            }
                            app.mdl.keep(ctx, m.id, uri.toString())
                            app.mdl.state[m.id] = MediaDl.St(1f, uri.toString(), null)
                            app.say(MediaGrab.note ?: "Saved in your gallery")
                        } catch (e: Exception) {
                            app.mdl.state[m.id] = MediaDl.St(0f, null, e.message ?: "failed")
                            app.say(if (e is MediaGrab.Fail) e.message ?: "Could not save it" else "Could not save it (" + (e.message ?: e.javaClass.simpleName).lineSequence().first().take(80) + ")")
                        }
                    }
                }
            }
            if (st?.error != null) T(st.error, Fs.xs, color = c.muted)
        }
    }
}

// the picture of the card comes from the site itself, so it is loaded on its own, like the picture of a link
// the file opens in the phone's own gallery or player at once, without the list "open with" (the only one asked when there is none)
private fun openFile(ctx: android.content.Context, uri: Uri, kind: String) {
    val type = ctx.contentResolver.getType(uri) ?: if (kind == "image" || kind == "gif") "image/*" else "video/*"
    val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, type).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
    val pm = ctx.packageManager
    val def = pm.resolveActivity(view, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY)
    if (def == null || def.activityInfo.packageName == "android") {
        val all = pm.queryIntentActivities(view, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY)
        val best = all.firstOrNull { Regex("gallery|photos|video|player|media", RegexOption.IGNORE_CASE).containsMatchIn(it.activityInfo.packageName) }
            ?: all.firstOrNull { it.activityInfo.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_SYSTEM != 0 } ?: all.firstOrNull()
        if (best != null) view.setPackage(best.activityInfo.packageName)
    }
    ctx.startActivity(view)
}

@Composable
private fun LinkPicBox(src: String) {
    if (androidx.compose.ui.platform.LocalInspectionMode.current || Photos.sync) return
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val req = remember(src) { coil.request.ImageRequest.Builder(ctx).data(Img.model(src)).setHeader("Referer", "").build() }
    coil.compose.AsyncImage(req, null, modifier = Modifier.fillMaxSize(), imageLoader = Img.loader(ctx), contentScale = androidx.compose.ui.layout.ContentScale.Crop)
}

// the message of the command: "/media", the size if one was typed, and the name of the site in the colour of links in my own messages; a tap on the name opens the page
@Composable
fun MediaCmd(url: String, site: String, quality: String, tap: () -> Unit, onLong: () -> Unit) {
    val c = LocalNook.current
    val uri = androidx.compose.ui.platform.LocalUriHandler.current
    val shape = RoundedCornerShape(Rad.bubble, Rad.bubble, Rad.xs, Rad.bubble)
    val ann = remember(url, site, quality) {
        androidx.compose.ui.text.buildAnnotatedString {
            append("/media " + (if (quality.isNotEmpty()) "/$quality " else ""))
            pushStringAnnotation("url", url)
            withStyle(androidx.compose.ui.text.SpanStyle(color = androidx.compose.ui.graphics.Color.White)) { append(MediaGrab.domain(site)) }
            pop()
        }
    }
    var layout by remember { mutableStateOf<androidx.compose.ui.text.TextLayoutResult?>(null) }
    Box(Modifier.clip(shape).background(c.accent).padding(horizontal = 14.dp, vertical = 9.dp)) {
        androidx.compose.material3.Text(
            ann,
            Modifier.pointerInput(ann) {
                detectTapGestures(onLongPress = { onLong() }) { pos ->
                    val l = layout ?: return@detectTapGestures
                    val o = l.getOffsetForPosition(pos)
                    ann.getStringAnnotations("url", o, o).firstOrNull()?.let { runCatching { uri.openUri(it.item) }; return@detectTapGestures }
                    tap()
                }
            },
            style = androidx.compose.material3.LocalTextStyle.current.copy(fontSize = Fs.base, lineHeight = (15 * 1.38).sp, color = c.on), onTextLayout = { layout = it },
        )
    }
}
