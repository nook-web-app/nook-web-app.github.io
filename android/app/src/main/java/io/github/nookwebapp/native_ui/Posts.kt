package io.github.nookwebapp.native_ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.FirstBaseline
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private fun count(n: Int) = if (n > 0) n.toString() else null

// .ab: one action of a post; the count sits 6dp after the icon
@Composable
private fun Ab(icon: String, n: Int, on: Boolean, onColor: Color, big: Boolean, fill: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val c = LocalNook.current
    val col = if (on) onColor else c.muted
    Row(
        modifier.defaultMinSize(minHeight = 38.dp).tap(RoundedCornerShape(Rad.pill), onClick = onClick).padding(8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        NIcon(icon, if (big) 24.dp else 20.dp, col, fill && on)
        count(n)?.let { T(it, Fs.sm, color = col, lineHeight = 16.sp) }
    }
}

// .acts: reply, repost, like, save, share, more. The first three share the room (at most 84dp each) and the
// last three sit at the right, like margin-left:auto on the fourth does; in a thread they are spread out evenly.
@Composable
fun Acts(p: Post, big: Boolean = false) {
    val app = LocalApp.current
    val c = LocalNook.current
    val items: List<@Composable (Modifier) -> Unit> = listOf(
        { m -> Ab("reply", p.replies, false, c.accent, big, false, m) { app.panel = Panel.Compose } },
        { m -> Ab("repost", p.reposts, p.reposted, c.good, big, false, m) { p.reposted = !p.reposted; p.reposts += if (p.reposted) 1 else -1 } },
        { m -> Ab("heart", p.likes, p.liked, c.like, big, true, m) { p.liked = !p.liked; p.likes += if (p.liked) 1 else -1 } },
        { m -> Ab("bookmark", p.saves, p.saved, c.accent, big, true, m) { p.saved = !p.saved; app.say(if (p.saved) "Saved" else "Removed from saved") } },
        { m -> Ab("share", p.shares, false, c.accent, big, false, m) { shareSheet(app, p) } },
        { m -> Ab("dots", 0, false, c.accent, big, false, m) { postSheet(app, p) } },
    )
    if (big) {
        Row(Modifier.fillMaxWidth().padding(vertical = 4.dp).padding(top = 4.dp), horizontalArrangement = Arrangement.SpaceAround) { items.forEach { it(Modifier) } }
        return
    }
    BoxWithConstraints(Modifier.fillMaxWidth().padding(top = 2.dp)) {
        // the row starts 8dp left of the text (margin-left:-8px), so it is 8dp wider than the column
        val w = maxWidth + 8.dp
        val rest = 36.dp * 3
        val first = minOf(84.dp, (w - rest) / 3)
        Row(Modifier.requiredWidth(w).offset(x = (-4).dp)) {
            items.take(3).forEach { it(Modifier.width(first)) }
            Spacer(Modifier.weight(1f))
            items.drop(3).forEach { it(Modifier) }
        }
    }
}

// .imgs: the pictures of a post (sample posts show a soft gradient where the photo would be)
@Composable
fun Pics(n: Int, seed: Float) {
    val c = LocalNook.current
    val shape = RoundedCornerShape(Rad.m)
    Box(
        Modifier.padding(top = 8.dp).fillMaxWidth().aspectRatio(if (n > 1) 2f else 0.85f).clip(shape).border(1.dp, c.line, shape)
            .background(Brush.linearGradient(listOf(hsl(seed, 0.35f, 0.45f), hsl((seed + 50) % 360, 0.45f, 0.25f)))),
    )
}

// .post: avatar, then name, handle and time on one baseline, the text, pictures and actions
@Composable
fun PostCard(p: Post, depth: Int = 0, label: String? = null) {
    val app = LocalApp.current
    val c = LocalNook.current
    Row(
        Modifier.fillMaxWidth().lineBelow(c.line).tap { app.go(Route.Thread(p.id)) }
            .padding(start = 16.dp + (14 * depth).dp, end = 16.dp, top = 12.dp, bottom = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Avatar(p.author, 40.dp, modifier = Modifier.tap(androidx.compose.foundation.shape.CircleShape) { if (p.author.id != "me") app.go(Route.User(p.author.id)) })
        Column(Modifier.weight(1f)) {
            if (label != null) Row(Modifier.padding(bottom = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                NIcon("repost", 14.dp, c.muted); T(label, Fs.sm, color = c.muted)
            }
            BoxWithConstraints {
                val half = maxWidth / 2
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    T(p.author.name, weight = FontWeight.Bold, maxLines = 1, modifier = Modifier.alignBy(FirstBaseline).widthIn(max = half))
                    T("@" + p.author.handle, color = c.muted, maxLines = 1, modifier = Modifier.alignBy(FirstBaseline).weight(1f))
                    T(p.ago, Fs.md, color = c.muted, modifier = Modifier.alignBy(FirstBaseline))
                }
            }
            if (p.text.isNotEmpty()) T(p.text, lineHeight = (15 * 1.38).sp)
            if (p.pics > 0) Pics(p.pics, hueOf(p.id))
            Acts(p)
        }
    }
}

// the big post at the top of a thread (mainPost)
@Composable
fun MainPost(p: Post) {
    val app = LocalApp.current
    val c = LocalNook.current
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Avatar(p.author, 48.dp, modifier = Modifier.tap(androidx.compose.foundation.shape.CircleShape) { if (p.author.id != "me") app.go(Route.User(p.author.id)) })
            Column { T(p.author.name, weight = FontWeight.Bold); T("@" + p.author.handle, color = c.muted) }
        }
        if (p.text.isNotEmpty()) T(p.text, Fs.x2, modifier = Modifier.padding(top = 12.dp), lineHeight = (20 * 1.35).sp)
        if (p.pics > 0) Pics(p.pics, hueOf(p.id))
        T(p.time + if (p.edited) " · edited" else "", Fs.md, color = c.muted, modifier = Modifier.padding(top = 12.dp, bottom = 12.dp))
        if (p.saves > 0) Row(Modifier.padding(bottom = 12.dp)) { T("${p.saves}", Fs.md, FontWeight.Bold); T(if (p.saves == 1) " save" else " saves", Fs.md, color = c.muted) }
        Acts(p, big = true)
    }
    Box(Modifier.padding(top = 6.dp)) { Line() }
}

// .cr: the "write a post" row at the top of the feed and of one's own profile
@Composable
fun ComposerRow() {
    val app = LocalApp.current
    val c = LocalNook.current
    Row(Modifier.fillMaxWidth().lineBelow(c.line).padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Avatar(Sample.me, 40.dp)
        Box(Modifier.weight(1f).tap { app.panel = Panel.Compose }.padding(vertical = 8.dp)) { T(Sample.placeholders[0], Fs.lg, color = c.muted, maxLines = 1) }
        IB("camera", box = 36.dp, height = 44.dp) { app.panel = Panel.Compose }
        IB("image", box = 36.dp, height = 44.dp) { app.panel = Panel.Compose }
    }
}

// the sheets a post opens: more (own or someone else's), share, report
fun postSheet(app: AppState, p: Post) {
    if (p.author.id != "me") {
        val zenOwner = p.author.id == "zen"
        app.open(listOfNotNull(
            if (p.text.isNotEmpty()) SheetItem("Copy post text", "copy") { app.say("Copied") } else null,
            SheetItem("Not interested", "eyeoff", danger = true) { app.say("You will see less like this") },
            if (zenOwner) SheetItem("Delete post", "trash", danger = true) { app.confirm("Delete this post of Zenith and its replies?", "Delete") { Sample.posts.remove(p); app.say("Post deleted") } }
            else SheetItem("Report post", "flag", danger = true) { reportSheet(app, p) },
        ))
        return
    }
    app.open(listOfNotNull(
        if (p.text.isNotEmpty()) SheetItem("Copy post text", "copy") { app.say("Copied") } else null,
        if (p.parent == null) SheetItem(if (p.pinned) "Unpin from profile" else "Pin to profile", "pin") { app.say("Pinned to your profile") } else null,
        SheetItem("Add to list", "list") { app.open(Sample.lists.map { SheetItem(it.name, "list") { app.say("Added to " + it.name) } } + SheetItem("Cancel", cancel = true), "Add to list") },
        SheetItem("Edit post", "edit") { app.panel = Panel.Compose },
        SheetItem("Delete post", "trash", danger = true) { app.confirm("Delete this post?", "Delete") { Sample.posts.remove(p); app.say("Post deleted") } },
    ))
}

fun shareSheet(app: AppState, p: Post) = app.open(listOf(
    SheetItem("Post", "edit") { app.panel = Panel.Compose },
    SheetItem("Another app", "share") {},
    SheetItem("Cancel", cancel = true),
), "Share post")

fun reportSheet(app: AppState, p: Post) {
    val why = (if (p.pics > 0) listOf("Sexual content") else emptyList()) + listOf(
        "Bullying or harassment", "Hate speech", "Threats or violence", "Self harm", "Illegal or dangerous",
        "Private information", "Pretending to be someone", "Spam or scam", "Something else",
    )
    app.open(why.map { SheetItem(it) { app.say("Thanks, we will check it") } } + SheetItem("Cancel", cancel = true), "Why are you reporting this post?")
}
