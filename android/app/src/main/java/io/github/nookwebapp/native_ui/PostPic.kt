package io.github.nookwebapp.native_ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.text.TextPaint

// postPic() of app.js: a picture of a post (the avatar, name and handle, the text, the first photo and the time) on
// the theme's background, 960 wide in its own units and about two million pixels in all
object PostPic {
    fun make(p: LPost, pr: Profile, c: NookColors, zenPfp: String? = null): Bitmap {
        // who wrote it: Zenith, somebody else, or the owner
        val name = if (p.ai) "Zenith" else p.ra?.name ?: pr.name
        val handle = if (p.ai) "zenith" else p.ra?.handle ?: pr.handle
        val avSrc = if (p.ai) zenPfp else p.ra?.avatar?.takeIf { Photos.ownMedia(it) } ?: pr.avatar
        val W = 960f; val pad = 56f; val av = 80f; val fs = 34f; val lh = 48f
        val cw = W - pad * 2
        val txt = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { textSize = fs; typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL) }
        val lines = if (p.text.isNotEmpty()) wrap(txt, p.text, cw) else emptyList()
        val pic = p.imgs.firstOrNull()?.let { src -> Photos.bytesOf(src)?.let { b -> Photos.decodeUpright(b, 1600) } }
        val me = avSrc?.let { src -> Photos.bytesOf(src)?.let { b -> runCatching { BitmapFactory.decodeByteArray(b, 0, b.size) }.getOrNull() } }
        val picH = if (pic != null) minOf(Math.round(cw * pic.height / pic.width).toFloat(), 900f) else 0f
        val H = pad + av + 32 + lines.size * lh + (if (pic != null) picH + 32 else 0f) + 60 + pad
        val s = Math.sqrt(2_000_000.0 / (W * H)).toFloat()
        val out = Bitmap.createBitmap(Math.round(W * s), Math.round(H * s), Bitmap.Config.ARGB_8888)
        val x = Canvas(out)
        x.scale(out.width / W, out.height / H)
        x.drawColor(c.bg.toArgb())
        val ax = pad + av / 2; val ay = pad + av / 2; val ar = av / 2
        x.drawCircle(ax, ay, ar, Paint(Paint.ANTI_ALIAS_FLAG).apply {
            if (p.ai) shader = android.graphics.LinearGradient(ax - ar, ay - ar, ax + ar, ay + ar, 0xFF14466F.toInt(), 0xFF208BFE.toInt(), android.graphics.Shader.TileMode.CLAMP)
            else color = (if (p.ra != null) hsl(hueOf(name.ifEmpty { handle }), .45f, .42f) else c.accent).toArgb()
        })
        if (me != null) {
            x.save(); x.clipPath(Path().apply { addCircle(ax, ay, ar, Path.Direction.CW) })
            val k = maxOf(av / me.width, av / me.height)
            x.drawBitmap(me, null, RectF(ax - me.width * k / 2, ay - me.height * k / 2, ax + me.width * k / 2, ay + me.height * k / 2), Paint(Paint.FILTER_BITMAP_FLAG))
            x.restore()
        } else {
            val lp = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = android.graphics.Color.WHITE; textAlign = Paint.Align.CENTER; textSize = Math.round(av * (if (p.ai) 0.5f else 0.4f)).toFloat(); typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD) }
            val fm = lp.fontMetrics
            x.drawText(if (p.ai) "Z" else name.ifBlank { handle }.ifBlank { "?" }.trim().take(1).uppercase(), ax, ay + 1 - (fm.ascent + fm.descent) / 2, lp)
        }
        val bold = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = c.fg.toArgb(); textSize = fs; typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD) }
        x.drawText(name.ifBlank { handle }.ifBlank { "user" }, pad + av + 20, pad + 36, bold)
        val mu = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = c.muted.toArgb(); textSize = Math.round(fs * 0.85f).toFloat() }
        x.drawText("@$handle", pad + av + 20, pad + 36 + 36, mu)
        var y = pad + av + 32
        txt.color = c.fg.toArgb()
        lines.forEach { l -> y += lh; x.drawText(l, pad, y, txt) }
        if (pic != null) {
            y += 32
            val ph = Math.round(cw * pic.height / pic.width).toFloat()
            val dh = minOf(ph, 900f); val dw = Math.round(dh * pic.width / pic.height).toFloat()
            val r = RectF(pad, y, pad + minOf(cw, dw), y + dh)
            x.save(); x.clipPath(Path().apply { addRoundRect(r, 18f, 18f, Path.Direction.CW) })
            x.drawBitmap(pic, null, r, Paint(Paint.FILTER_BITMAP_FLAG)); x.restore()
            y += dh
        }
        y += 60
        mu.textSize = Math.round(fs * 0.75f).toFloat()
        x.drawText(whenText(p.t), pad, y, mu)
        return out
    }

    // wrapLines(): words are put on a line while they fit; each line break in the text starts a new line
    private fun wrap(p: TextPaint, text: String, maxW: Float): List<String> {
        val out = mutableListOf<String>()
        text.split("\n").forEach { par ->
            var line = ""
            par.split(" ").forEach { w ->
                val t = if (line.isNotEmpty()) "$line $w" else w
                if (p.measureText(t) <= maxW || line.isEmpty()) line = t else { out.add(line); line = w }
            }
            out.add(line)
        }
        return out
    }
}

private fun androidx.compose.ui.graphics.Color.toArgb() = android.graphics.Color.argb((alpha * 255).toInt(), (red * 255).toInt(), (green * 255).toInt(), (blue * 255).toInt())
