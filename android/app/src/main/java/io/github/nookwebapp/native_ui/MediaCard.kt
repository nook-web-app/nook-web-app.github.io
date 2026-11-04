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
    companion object { val jobs = java.util.concurrent.ConcurrentHashMap<String, kotlinx.coroutines.Job>(); val shared = MediaDl(); val scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.Main) }
    // the running download of each card, and whether its message is still in a chat
    fun exists(app: AppState, id: String): Boolean = app.s.chats.any { c -> c.msgs.any { it.id == id } }
    class St(val progress: Float, val saved: String?, val error: String?)
    val state = mutableStateMapOf<String, St>()
    fun saved(ctx: android.content.Context, id: String): String? = state[id]?.saved ?: ctx.getSharedPreferences("mdl", 0).getString(id, null)
    fun keep(ctx: android.content.Context, id: String, uri: String) { ctx.getSharedPreferences("mdl", 0).edit().putString(id, uri).apply() }
}

private fun clock(sec: Int) = if (sec <= 0) "" else if (sec >= 3600) "%d:%02d:%02d".format(sec / 3600, sec / 60 % 60, sec % 60) else "%d:%02d".format(sec / 60, sec % 60)

// the card of a link (like the one of a link in a chat) with the picture, the title and, where the caption sits, a blue button that
// saves the video, gif or picture on this phone
@Composable
fun MediaCard(m: LMsg, onTap: () -> Unit = {}, onLong: () -> Unit = {}) {
    val app = LocalApp.current
    val c = LocalNook.current
    val ctx = app.ctx
    val uri = androidx.compose.ui.platform.LocalUriHandler.current
    val card = m.mcard ?: return
    val shape = RoundedCornerShape(Rad.bubble)
    val st = app.mdl.state[m.id]
    val saved = remember(m.id, st?.saved) { ctx?.let { app.mdl.saved(it, m.id) } }
    val busy = st != null && st.saved == null && st.error == null
    val of = if (card.optInt("c") > 1) (card.optInt("n") + 1).toString() + "/" + card.optInt("c") else ""
    val meta = listOf(MediaGrab.siteName(card.optString("s"), card.optString("u")), of, clock(card.optInt("d")), MediaGrab.sizeText(card.optLong("z"))).filter { it.isNotEmpty() }.joinToString(" · ")
    // a double tap on the preview opens the page of the link; a single tap and a hold still reach the message
    Column(Modifier.fillMaxWidth(0.82f).widthIn(max = 320.dp).clip(shape).background(c.bg2).pointerInput(card) {
        detectTapGestures(onTap = { onTap() }, onLongPress = { onLong() }, onDoubleTap = { runCatching { uri.openUri(card.optString("u")) } })
    }) {
        card.optString("i").takeIf { it.isNotEmpty() }?.let { img ->
            Box(Modifier.fillMaxWidth().aspectRatio(1f).background(c.bg2)) { LinkPicBox(img) }
        }
        Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            // the caption first, the name of the app after it (never twice: a caption that is only the name of the app is left out)
            val cap = card.optString("t").trim()
            val sn = MediaGrab.siteName(card.optString("s"), card.optString("u"))
            if (cap.isNotEmpty() && !cap.equals(sn, true)) T(cap, weight = FontWeight.SemiBold, maxLines = 2)
            T(meta, if (cap.isEmpty() || cap.equals(sn, true)) Fs.base else Fs.xs, color = if (cap.isEmpty() || cap.equals(sn, true)) c.fg else c.muted)
            val label = when {
                busy -> if (st!!.progress > 0f) "Downloading " + (st.progress * 100).toInt() + "%" else "Downloading..."
                saved != null -> "Open"
                st?.error != null -> "Try again"
                card.optString("q") == "audio" -> "Download audio"
                else -> "Download"
            }
            Pill(label, Btn.Pri, small = true, enabled = !busy, modifier = Modifier.fillMaxWidth().padding(top = 4.dp)) {
                ctx ?: return@Pill
                if (saved != null && st?.error == null) {
                    runCatching { openFile(ctx, Uri.parse(saved), if (card.optString("q") == "audio") "audio" else card.optString("k")) }.onFailure { app.say("Could not open it. Look in your gallery") }
                } else {
                    app.mdl.state[m.id] = MediaDl.St(0f, null, null)
                    // the download belongs to the process, not to the screen: it goes on when the app is left or the screen is closed
                    val title = card.optString("t").ifEmpty { "Nook" }
                    val key = m.id
                    val index = card.optInt("n")
                    val job = MediaDl.scope.launch {
                        var checked = 0L
                        try {
                            val got = Keep.download(ctx, key, title) {
                                Keep.progress(ctx, key, title, 0)
                                MediaGrab.save(ctx, card.optString("u"), card.optString("q"), index, card.optString("i"), card.optString("f")) { p ->
                                    // the message was deleted while it downloads: the download stops and its notification goes
                                    val now = System.currentTimeMillis()
                                    if (now - checked > 700) { checked = now; if (!app.mdl.exists(app, key)) throw kotlinx.coroutines.CancellationException("deleted") }
                                    app.mdl.state[key] = MediaDl.St(p, null, null); Keep.progress(ctx, key, title, (p * 100).toInt())
                                }
                            }
                            app.mdl.keep(ctx, key, got.uri.toString())
                            app.mdl.state[key] = MediaDl.St(1f, got.uri.toString(), null)
                            app.say(got.note ?: "Saved in your gallery")
                        } catch (e: kotlinx.coroutines.CancellationException) {
                            app.mdl.state.remove(key)
                        } catch (e: Exception) {
                            app.mdl.state[key] = MediaDl.St(0f, null, e.message ?: "failed")
                            app.say(if (e is MediaGrab.Fail) e.message ?: "Could not save it" else "Could not save it (" + (e.message ?: e.javaClass.simpleName).lineSequence().first().take(80) + ")")
                        } finally { Keep.clear(ctx, key); MediaDl.jobs.remove(key) }
                    }
                    MediaDl.jobs[key] = job
                }
            }
            if (st?.error != null) T(st.error, Fs.xs, color = c.muted)
        }
    }
}

// the picture of the card comes from the site itself, so it is loaded on its own, like the picture of a link
// the file opens in the phone's own gallery or player at once, without the list "open with" (the only one asked when there is none)
private fun openFile(ctx: android.content.Context, uri: Uri, kind: String) {
    // a sound opens in Samsung Music at once (when the phone has it), without the list "open with"
    if (kind == "audio") {
        val tryView = Intent(Intent.ACTION_VIEW).setDataAndType(uri, ctx.contentResolver.getType(uri) ?: "audio/*").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        for (pkg in listOf("com.sec.android.app.music", "com.samsung.android.app.musicplayer")) {
            val ok = runCatching { ctx.startActivity(Intent(tryView).setPackage(pkg)) }.isSuccess
            if (ok) return
        }
    }
    val type = ctx.contentResolver.getType(uri) ?: if (kind == "image" || kind == "gif") "image/*" else if (kind == "audio") "audio/*" else "video/*"
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

// the message of the command: "/media", the size if one was typed and the name of each app once (three X links and a TikTok one
// read "/media x.com tiktok.com"); the links are opened by a double tap on a preview, not from here
@Composable
fun MediaCmd(url: String, site: String, quality: String, tap: () -> Unit, onLong: () -> Unit, more: List<String> = emptyList(), folder: String = "") {
    val c = LocalNook.current
    val shape = RoundedCornerShape(Rad.bubble, Rad.bubble, Rad.xs, Rad.bubble)
    val text = remember(url, site, quality, more, folder) {
        val names = (if (more.size > 1) more else listOf(url)).map { link -> MediaGrab.domain(MediaGrab.site(link) ?: site, link) }.distinct()
        androidx.compose.ui.text.buildAnnotatedString {
            append((if (quality == "audio") "/audio " else "/media " + (if (quality.isNotEmpty()) "/$quality " else "")) + (if (folder.isNotEmpty()) "/folder/$folder " else ""))
            names.forEachIndexed { i, n -> if (i > 0) append(" "); withStyle(androidx.compose.ui.text.SpanStyle(color = androidx.compose.ui.graphics.Color.White)) { append(n) } }
        }
    }
    Box(Modifier.clip(shape).background(c.accent).padding(horizontal = 14.dp, vertical = 9.dp).pointerInput(Unit) { detectTapGestures(onLongPress = { onLong() }, onTap = { tap() }) }) {
        androidx.compose.material3.Text(
            text, style = androidx.compose.material3.LocalTextStyle.current.copy(fontSize = Fs.base, lineHeight = (15 * 1.38).sp, color = c.on),
        )
    }
}
