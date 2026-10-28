package io.github.nookwebapp.native_ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

// One shape of an icon in the 24x24 box: its path, stroke width, and whether it is filled and/or stroked.
class El(val d: String, val sw: Float, val filled: Boolean, val stroked: Boolean) {
    val path: Path by lazy { PathParser().parsePathString(d).toPath() }
}

// An icon: shapes drawn as they are, shapes drawn under a mask, and the shape that mask cuts away.
class Ic(val plain: List<El>, val masked: List<El>, val cut: El?)

private fun DrawScope.drawEl(e: El, color: Color, fillAll: Boolean, blend: BlendMode = BlendMode.SrcOver) {
    if (e.filled || fillAll) drawPath(e.path, color, style = Fill, blendMode = blend)
    if (e.stroked) drawPath(e.path, color, style = Stroke(width = e.sw, cap = StrokeCap.Round, join = StrokeJoin.Round), blendMode = blend)
}

// Draws an icon of the web app's set exactly like ic(name, size, fill) does in the browser.
@Composable
fun NIcon(name: String, size: Dp = 22.dp, tint: Color = LocalContentColor.current, fill: Boolean = false, modifier: Modifier = Modifier) {
    val ic = ICONS[name] ?: return
    Canvas(modifier.size(size)) {
        val k = this.size.width / 24f
        scale(k, k, pivot = androidx.compose.ui.geometry.Offset.Zero) {
            if (ic.masked.isNotEmpty() && ic.cut != null) {
                // the masked group goes on its own layer, the cut shape clears it, then the layer is laid down
                drawIntoCanvas { it.saveLayer(Rect(0f, 0f, 24f, 24f), Paint()) }
                ic.masked.forEach { drawEl(it, tint, fill) }
                drawEl(ic.cut, Color.Black, false, BlendMode.Clear)
                drawIntoCanvas { it.restore() }
            } else ic.masked.forEach { drawEl(it, tint, fill) }
            ic.plain.forEach { drawEl(it, tint, fill) }
        }
    }
}
