package io.github.nookwebapp.native_ui

import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue

// The shapes the screens draw. Nothing talks to the server yet: the sample data below stands in for it,
// so every page can be built and checked before the real data is wired in.
data class Person(val id: String, val name: String, val handle: String, val hue: Float? = null, val bio: String = "")

class Post(
    val id: String, val author: Person, val text: String, val ago: String,
    val pics: Int = 0, val parent: String? = null,
    replies: Int = 0, likes: Int = 0, reposts: Int = 0, saves: Int = 0, shares: Int = 0,
    liked: Boolean = false, reposted: Boolean = false, saved: Boolean = false,
    val repostedBy: String? = null, val pinned: Boolean = false, val edited: Boolean = false,
    val time: String = "Oct 28, 2026, 2:06 PM",
) {
    var replies by mutableStateOf(replies)
    var likes by mutableStateOf(likes)
    var reposts by mutableStateOf(reposts)
    var saves by mutableStateOf(saves)
    var shares by mutableStateOf(shares)
    var liked by mutableStateOf(liked)
    var reposted by mutableStateOf(reposted)
    var saved by mutableStateOf(saved)
}

data class ChatRow(val id: String, val who: Person, val last: String, val time: String, val unread: Int = 0, val muted: Boolean = false, val note: Boolean = false)
data class NookList(val id: String, val name: String, val count: Int)

object Sample {
    val me = Person("me", "watermelon", "haytham.idk", null, "")
    val zenith = Person("zen", "Zenith", "zenith", 205f, "Zenith is an AI model")
    val sleet = Person("sleet", "Sleet", "sleetslumber", 280f, "sleepy artist")
    val mina = Person("mina", "Mina", "mina.k", 330f)
    val user = Person("u1", "user", "user", 150f)
    val people = listOf(zenith, sleet, mina, user)

    val posts = mutableStateListOf(
        Post("p1", me, "hello nook :3", "now"),
        Post("p2", me, "ranking snacks again because i have no self control. chips first obviously", "now"),
        Post("p3", zenith, "just spent the morning looking for my hoodie and it was on me the whole time :3 uwu", "9m", likes = 1, replies = 1),
        Post("p4", me, "", "56m", pics = 1, replies = 1),
        Post("p5", sleet, "new banner who dis uwu", "1h", replies = 2, reposts = 1, likes = 8, liked = true),
        Post("p6", me, "tested the new update, everything feels smoother", "13h", likes = 2, shares = 1),
        Post("p7", zenith, "nice, glad it feels smoother :3", "13h", parent = "p6"),
    )
    val chats = listOf(
        ChatRow("c0", me, "milk, eggs, charger", "1h", note = true),
        ChatRow("c1", zenith, "ok but what snack is your top pick", "now", unread = 2),
        ChatRow("c2", sleet, "Photo", "12m"),
        ChatRow("c3", mina, "lol same", "3d", muted = true),
    )
    val lists = listOf(NookList("l1", "Friends", 3), NookList("l2", "Art", 12))
    val placeholders = listOf("Jot down a thought", "Note to future self", "How's your day going?")
}
