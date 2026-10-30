package io.github.nookwebapp.native_ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

// where each "/media" card stands on this phone: the share of the file that came, or the place it was saved at
class MediaDl {
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
    val meta = listOf(MediaGrab.siteName(card.optString("s")), clock(card.optInt("d"))).filter { it.isNotEmpty() }.joinToString(" · ")
    Column(Modifier.fillMaxWidth(0.82f).widthIn(max = 320.dp).clip(shape).background(c.bg2)) {
        card.optString("i").takeIf { it.isNotEmpty() }?.let { img ->
            Box(Modifier.fillMaxWidth().aspectRatio(1f).background(c.bg2)) { LinkPicBox(img) }
        }
        Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            T(card.optString("t").ifEmpty { card.optString("u") }, weight = FontWeight.SemiBold, maxLines = 2)
            T(meta, Fs.xs, color = c.muted)
            val label = when {
                busy -> if (st!!.progress > 0f) "Downloading " + (st.progress * 100).toInt() + "%" else "Downloading..."
                saved != null -> "Saved. Open"
                st?.error != null -> "Try again"
                else -> "Download"
            }
            Pill(label, Btn.Pri, small = true, enabled = !busy, modifier = Modifier.fillMaxWidth().padding(top = 4.dp)) {
                ctx ?: return@Pill
                if (saved != null && st?.error == null) {
                    runCatching {
                        val kind = if (card.optString("k") == "image") "image/*" else "video/*"
                        ctx.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(saved), kind).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION))
                    }.onFailure { app.say("Could not open it. Look in your gallery") }
                } else {
                    app.mdl.state[m.id] = MediaDl.St(0f, null, null)
                    app.scope.launch {
                        try {
                            val uri = Keep.around(ctx) { MediaGrab.save(ctx, card.optString("u")) { p -> app.mdl.state[m.id] = MediaDl.St(p, null, null) } }
                            app.mdl.keep(ctx, m.id, uri.toString())
                            app.mdl.state[m.id] = MediaDl.St(1f, uri.toString(), null)
                            app.say("Saved in your gallery (Nook)")
                        } catch (e: Exception) {
                            app.mdl.state[m.id] = MediaDl.St(0f, null, e.message ?: "failed")
                            app.say(if (e is MediaGrab.Fail) e.message ?: "Could not save it" else "Could not save it. Check your connection")
                        }
                    }
                }
            }
            if (st?.error != null) T(st.error, Fs.xs, color = c.muted)
        }
    }
}

// the picture of the card comes from the site itself, so it is loaded on its own, like the picture of a link
@Composable
private fun LinkPicBox(src: String) {
    if (androidx.compose.ui.platform.LocalInspectionMode.current || Photos.sync) return
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val req = remember(src) { coil.request.ImageRequest.Builder(ctx).data(src).setHeader("Referer", "").build() }
    coil.compose.AsyncImage(req, null, modifier = Modifier.fillMaxSize(), imageLoader = Img.loader(ctx), contentScale = androidx.compose.ui.layout.ContentScale.Crop)
}
