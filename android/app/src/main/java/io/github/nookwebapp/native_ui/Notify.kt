package io.github.nookwebapp.native_ui

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.launch

// Phone notifications. The web app gets them through web push; here they come from the live connection while the app
// is alive, and from a check every 15 minutes (WorkManager) while it is not. Only notifications this person has not
// read yet, and that were not shown before, become a notification on the phone.
object Notify {
    private const val CH = "nook"
    private const val WORK = "nook-notes"

    fun channel(ctx: Context) {
        if (Build.VERSION.SDK_INT >= 26) {
            val nm = ctx.getSystemService(NotificationManager::class.java)
            if (nm.getNotificationChannel(CH) == null) nm.createNotificationChannel(NotificationChannel(CH, "Nook", NotificationManager.IMPORTANCE_DEFAULT))
        }
    }

    fun allowed(ctx: Context) = (Build.VERSION.SDK_INT < 33 || ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) && NotificationManagerCompat.from(ctx).areNotificationsEnabled()

    fun on(ctx: Context) = ctx.getSharedPreferences("nook", 0).getBoolean("push", false)
    fun setOn(ctx: Context, v: Boolean) {
        ctx.getSharedPreferences("nook", 0).edit().putBoolean("push", v).apply()
        if (v) { schedule(ctx); kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.IO).launch { runCatching { Push.register(ctx) } } } else WorkManager.getInstance(ctx).cancelUniqueWork(WORK)
    }

    fun schedule(ctx: Context) {
        val req = PeriodicWorkRequestBuilder<NoteWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.KEEP, req)
    }

    // one notification; a tap opens the app at what it is about ("notifs" or "dm:<id>")
    fun show(ctx: Context, title: String, body: String, open: String, id: Int = open.hashCode()) {
        if (!allowed(ctx)) return
        channel(ctx)
        val i = Intent(ctx, MainActivity::class.java).putExtra("open", open).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pi = PendingIntent.getActivity(ctx, id, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(ctx, CH).setSmallIcon(R.drawable.ic_stat).setContentTitle(title).setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body)).setContentIntent(pi).setAutoCancel(true).build()
        runCatching { NotificationManagerCompat.from(ctx).notify(id, n) }
    }

    // the notifications that were already shown on this phone (so the 15 minute check never shows one twice)
    fun seen(ctx: Context): MutableSet<String> = ctx.getSharedPreferences("nook", 0).getStringSet("seen", emptySet())!!.toMutableSet()
    fun markSeen(ctx: Context, ids: Collection<String>) {
        val s = seen(ctx).apply { addAll(ids) }
        ctx.getSharedPreferences("nook", 0).edit().putStringSet("seen", s.toList().takeLast(400).toSet()).apply()
    }

    // the check itself: unread notifications of this account newer than the last check
    suspend fun check(ctx: Context) {
        if (!on(ctx) || !allowed(ctx)) return
        if (Sb.session == null) {
            Sb.session = Vault.read(File(ctx.filesDir, "sb.bin"))?.let { runCatching { Session.of(JSONObject(it)) }.getOrNull() }
            // a renewed login is saved at once, so the app never uses a spent one
            Sb.onSession = { ss -> Vault.write(File(ctx.filesDir, "sb.bin"), ss?.json()?.toString()) }
        }
        val me = Sb.user?.id ?: return
        val since = ctx.getSharedPreferences("nook", 0).getLong("since", System.currentTimeMillis() - 86_400_000)
        val r = Sb.get(Q("notifications").select("id, actor_id, kind, post_id, created_at").eq("user_id", me).isNull("read_at").gt("created_at", isoOf(since)).order("created_at", false).limit(20))
        if (!r.ok) return
        val seen = seen(ctx)
        val fresh = r.rows.filter { it.optString("id") !in seen }
        if (fresh.isEmpty()) return
        val actors = fresh.map { it.optString("actor_id") }.distinct()
        val accts = Sb.get(Q("accounts").select("id, username, display_name").inList("id", actors)).rows.associateBy { it.optString("id") }
        val muted = Sb.get(Q("dm_mutes").select("target_id, until_at, hidden").eq("owner_id", me)).rows.filter { m -> m.optBoolean("hidden") || m.isNull("until_at") || parseIso(m.optString("until_at")) > System.currentTimeMillis() }.map { it.optString("target_id") }.toSet()
        fresh.reversed().forEach { n ->
            val a = accts[n.optString("actor_id")]
            val who = a?.let { if (it.isNull("display_name")) it.optString("username") else it.optString("display_name") } ?: "Someone"
            val kind = n.optString("kind")
            if (kind == "message" && n.optString("actor_id") in muted) return@forEach
            show(ctx, who, NOTE_WHAT[kind] ?: "", if (kind == "message") "dm:" + n.optString("actor_id") else "notifs", n.optString("id").hashCode())
        }
        markSeen(ctx, fresh.map { it.optString("id") })
        ctx.getSharedPreferences("nook", 0).edit().putLong("since", parseIso(fresh.first().optString("created_at"))).apply()
    }
}

class NoteWorker(ctx: Context, p: WorkerParameters) : CoroutineWorker(ctx, p) {
    override suspend fun doWork(): Result {
        // while the app is open the live connection already tells about new things
        if (AppState.current?.foreground == true) return Result.success()
        runCatching { Notify.check(applicationContext) }
        return Result.success()
    }
}

// pushDetach(): this phone stops getting notifications for the account that leaves it
suspend fun Online.pushDetach() {
    val ctx = app.ctx ?: return
    runCatching { Push.detach(ctx) }
    androidx.work.WorkManager.getInstance(ctx).cancelUniqueWork("nook-notes")
    ctx.getSharedPreferences("nook", 0).edit().remove("since").remove("seen").apply()
}

// the zip the banned page hands out (buildBanZip): posts, photos, profile, follows, and the chats this phone can open
suspend fun Online.buildBanZip(j: JSONObject, say: (String) -> Unit): File? {
    val d = j.optJSONObject("data") ?: JSONObject()
    val acc = d.optJSONObject("account") ?: JSONObject()
    val me = acc.optString("id")
    val files = ArrayList<Pair<String, ByteArray>>()
    val got = HashMap<String, ByteArray>()
    val list = j.optJSONArray("files")?.objs() ?: emptyList()
    list.forEachIndexed { i, f -> Sb.bytes(f.optString("url"))?.let { got[f.optString("bucket") + "/" + f.optString("name")] = it }; say("Getting your files " + (i + 1) + " of " + list.size) }
    fun rel(u: String?): String? = u?.let { Regex("/object/(?:public|sign)/[^/]+/[0-9a-f-]{36}/([^?#]+)", RegexOption.IGNORE_CASE).find(it)?.groupValues?.get(1)?.let { s -> java.net.URLDecoder.decode(s, "UTF-8") } }
    fun whenOf(t: String?) = parseIso(t).takeIf { it > 0 }?.let { java.text.SimpleDateFormat("yyyy-MM-dd HH:mm", java.util.Locale.US).apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }.format(java.util.Date(it)) + " UTC" } ?: ""
    fun photos(mu: Any?): List<String> = parseMedia(mu).mapNotNull { rel(it) }.filter { got.containsKey("media/$it") }.map { x -> files.add("photos/posts/$x" to got["media/$x"]!!); "photos/posts/$x" }
    val posts = ArrayList<String>(); val replies = ArrayList<String>()
    d.optJSONArray("posts")?.objs()?.forEach { p -> (if (p.isNull("reply_to")) posts else replies).add(whenOf(p.optString("created_at")) + "\n" + p.optString("text") + photos(p.opt("media_url")).joinToString("") { "\n[photo: $it]" }) }
    if (posts.isNotEmpty()) files.add("posts.txt" to (posts.joinToString("\n\n") + "\n").toByteArray())
    if (replies.isNotEmpty()) files.add("replies.txt" to (replies.joinToString("\n\n") + "\n").toByteArray())
    val prof = mutableListOf("Username: " + acc.optString("username"), "Name: " + acc.optString("display_name"), "Email: " + d.optString("email"), "Joined: " + whenOf(acc.optString("created_at")))
    acc.optStr("bio")?.let { prof.add("Bio: $it") }
    files.add("profile.txt" to (prof.joinToString("\n") + "\n").toByteArray())
    acc.optStr("avatar")?.takeIf { it.startsWith("data:") }?.let { a -> runCatching { files.add("avatar." + (Regex("^data:image/([a-z]+)").find(a)?.groupValues?.get(1)?.replace("jpeg", "jpg") ?: "png") to java.util.Base64.getDecoder().decode(a.substringAfter(","))) } }
    rel(acc.optStr("banner"))?.let { bn -> got["media/$bn"]?.let { files.add("banner." + bn.substringAfterLast('.', "jpg") to it) } }
    listOf("following", "followers", "likes", "reposts").forEach { k -> d.optJSONArray(k)?.strings()?.takeIf { it.isNotEmpty() }?.let { files.add("$k.txt" to (it.joinToString("\n") + "\n").toByteArray()) } }
    d.optJSONArray("nicknames")?.objs()?.takeIf { it.isNotEmpty() }?.let { n -> files.add("nicknames.txt" to (n.joinToString("\n") { it.optString("person") + ": " + it.optString("nickname") } + "\n").toByteArray()) }
    var sealed = 0; var chatNo = 0
    val mine = readLocalKeys(me)
    d.optJSONArray("chats")?.objs()?.forEach { c ->
        val msgs = c.optJSONArray("messages")?.objs() ?: return@forEach
        if (msgs.isEmpty()) return@forEach
        val key = runCatching { if (mine != null) Crypto.shared(mine.priv, Crypto.pubFromB64(c.optString("peer_public_key"))) else null }.getOrNull()
        val who = "${++chatNo}-" + c.optString("person").replace(Regex("[\\\\/:*?\"<>|\\x00-\\x1f]"), "_").trim().take(40).ifEmpty { "chat" }
        val lines = ArrayList<String>(); var i = 0
        msgs.forEach { m ->
            var text = m.optString("text"); var note = ""
            if (text.startsWith("e2e1:")) text = runCatching { Crypto.openText(key!!, text) }.getOrElse { sealed++; note = " [could not be opened]"; "" }
            val shots = StringBuilder()
            m.optJSONArray("media")?.objs()?.forEach { md ->
                val raw = rel(md.optString("url"))?.let { got["dm-media/$it"] } ?: return@forEach
                var bytes = raw; var ext = when (md.optString("type")) { "image/png" -> "png"; "image/gif" -> "gif"; "image/webp" -> "webp"; "image/jpeg" -> "jpg"; else -> "bin" }
                md.optStr("iv")?.let { iv -> bytes = runCatching { Crypto.open(key!!, Crypto.unb64(iv), raw) }.getOrElse { ext = "bin"; sealed++; raw } }
                val path = "photos/messages/$who/${++i}.$ext"
                files.add(path to bytes); shots.append("\n[photo: $path]")
            }
            lines.add("[" + whenOf(m.optString("created_at")) + "] " + (if (m.optBoolean("from_me")) "me" else c.optString("person")) + ": " + text + note + shots)
        }
        files.add("messages/$who.txt" to (lines.joinToString("\n") + "\n").toByteArray())
    }
    if (sealed > 0) files.add("notes.txt" to "$sealed item(s) in your chats are end to end encrypted and could not be opened here. Messages are only readable on the device that made them.\n".toByteArray())
    val dir = Photos.cacheDir?.let { File(it, "share").apply { mkdirs() } } ?: return null
    val out = File(dir, "nook-data-" + java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(java.util.Date()) + ".zip")
    java.util.zip.ZipOutputStream(out.outputStream()).use { z -> files.forEach { (n, b) -> z.putNextEntry(java.util.zip.ZipEntry(n)); z.write(b); z.closeEntry() } }
    return out
}
