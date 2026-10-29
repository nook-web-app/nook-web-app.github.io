package io.github.nookwebapp.native_ui

import android.net.Uri
import androidx.activity.compose.LocalActivityResultRegistryOwner
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

// The photo buttons (pickBtn in app.js): the gallery (several at once when allowed) or the camera. Each picked photo goes
// through Photos.intake and the saved file paths come back; a file that is not a photo is counted and reported like the web app does.
class Picker(val gallery: () -> Unit, val camera: () -> Unit)

@Composable
fun rememberPicker(multi: Int, onDone: (List<String>) -> Unit): Picker {
    // the screenshot tests have no activity to start a picker from
    if (LocalActivityResultRegistryOwner.current == null) return remember { Picker({}, {}) }
    val ctx = LocalContext.current
    val app = LocalApp.current
    val scope = rememberCoroutineScope()
    val take: (List<Uri>) -> Unit = { uris ->
        if (uris.isNotEmpty()) scope.launch {
            val dir = app.store.mediaDir ?: return@launch
            var bad = 0
            val out = withContext(Dispatchers.IO) { uris.mapNotNull { u -> Photos.intake(ctx, dir, u).also { if (it == null) bad++ } } }
            if (bad > 0) app.say(if (bad == 1) "That file is not a photo we can read" else "Could not add $bad files")
            onDone(out)
        }
    }
    val many = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(maxOf(2, multi))) { take(it) }
    val one = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { it?.let { u -> take(listOf(u)) } }
    val shot = remember { File(File(ctx.cacheDir, "camera").apply { mkdirs() }, "shot.jpg") }
    val shotUri = remember { FileProvider.getUriForFile(ctx, ctx.packageName + ".files", shot) }
    val cam = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok -> if (ok) take(listOf(shotUri)) }
    val req = PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
    return remember(multi) { Picker({ if (multi > 1) many.launch(req) else one.launch(req) }, { runCatching { cam.launch(shotUri) } }) }
}
