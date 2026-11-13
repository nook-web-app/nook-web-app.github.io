package io.github.nookwebapp.native_ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// The same tokens as :root in the web app's style.css. One CSS pixel is one dp, so sizes carry over as they are.
class NookColors(
    val bg: Color, val bg2: Color, val fg: Color, val muted: Color, val line: Color,
    val accent: Color, val fill: Color, val lnk: Color, val on: Color,
    val danger: Color, val good: Color, val like: Color, val scrim: Color,
    val b1: Color, val b2: Color, val dark: Boolean,
)

val DarkColors = NookColors(
    bg = Color(0xFF161E27), bg2 = Color(0xFF1F2A37), fg = Color(0xFFF1F3F5), muted = Color(0xFF8D9BAE), line = Color(0xFF2B3846),
    accent = Color(0xFF208BFE), fill = Color(0xFF1B75D6), lnk = Color(0xFF208BFE), on = Color.White,
    danger = Color(0xFFF0516F), good = Color(0xFF2DC653), like = Color(0xFFEC4899), scrim = Color(0x8C000000),
    b1 = Color(0xFF14466F), b2 = Color(0xFF1D6AA8), dark = true,
)
val LightColors = NookColors(
    bg = Color.White, bg2 = Color(0xFFEFF2F6), fg = Color(0xFF0B0F14), muted = Color(0xFF5C6F8A), line = Color(0xFFD9E0E8),
    accent = Color(0xFF0B78F0), fill = Color(0xFF0A73E6), lnk = Color(0xFF0A73E6), on = Color.White,
    danger = Color(0xFFD4264A), good = Color(0xFF16A34A), like = Color(0xFFE11D74), scrim = Color(0x660A0F14),
    b1 = Color(0xFF9FCBFB), b2 = Color(0xFF5AA6F5), dark = false,
)

val LocalNook = staticCompositionLocalOf { DarkColors }

// font sizes and radii from :root (--fs-*, --r-*)
object Fs {
    val xs = 12.sp; val sm = 13.sp; val md = 14.sp; val base = 15.sp; val lg = 16.sp
    val xl = 17.sp; val x2 = 20.sp; val x3 = 24.sp; val av = 34.sp
}
object Rad {
    val xs = 4.dp; val s = 10.dp; val m = 14.dp; val bubble = 18.dp; val l = 22.dp; val sheet = 28.dp; val pill = 999.dp
}

val Inter = FontFamily(
    Font(R.font.inter_regular, FontWeight.Normal),
    Font(R.font.inter_medium, FontWeight.Medium),
    Font(R.font.inter_semibold, FontWeight.SemiBold),
    Font(R.font.inter_bold, FontWeight.Bold),
)

// text is laid out like the browser does it: no extra font padding, the line height split evenly above and below
val BaseText = TextStyle(
    fontFamily = Inter, fontSize = Fs.base, lineHeight = 21.sp,
    platformStyle = PlatformTextStyle(includeFontPadding = false),
    lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None),
)

enum class ThemeMode { System, Dark, Light }

// the same version as the web app (APP_VERSION in app.js); the app's own version code is made from it in build.gradle
const val APP_VERSION = "3.48.9"

@Composable
fun NookTheme(mode: ThemeMode = ThemeMode.System, content: @Composable () -> Unit) {
    val dark = when (mode) { ThemeMode.System -> isSystemInDarkTheme(); ThemeMode.Dark -> true; ThemeMode.Light -> false }
    val c = if (dark) DarkColors else LightColors
    val scheme = (if (dark) darkColorScheme() else lightColorScheme()).copy(
        background = c.bg, surface = c.bg, primary = c.accent, onBackground = c.fg, onSurface = c.fg,
    )
    // text keeps the web app's sizes whatever the phone's font size setting is, so the screens stay the same as the web app
    val d = LocalDensity.current
    MaterialTheme(colorScheme = scheme) {
        // no blue drop under the cursor while typing (the selection handles are see-through); selected text keeps a light accent behind it
        CompositionLocalProvider(LocalDensity provides Density(d.density, 1f), LocalNook provides c, LocalContentColor provides c.fg, LocalTextStyle provides BaseText.copy(color = c.fg),
            androidx.compose.foundation.text.selection.LocalTextSelectionColors provides androidx.compose.foundation.text.selection.TextSelectionColors(androidx.compose.ui.graphics.Color.Transparent, c.accent.copy(alpha = 0.3f))) {
            content()
        }
    }
}
