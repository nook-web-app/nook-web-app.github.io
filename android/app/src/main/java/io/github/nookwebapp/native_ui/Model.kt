package io.github.nookwebapp.native_ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

// The shapes the screens draw. Nothing talks to the server yet: Sample (Fixture.kt) stands in for it.
data class Person(val id: String, val name: String, val handle: String, val bio: String = "", val own: Boolean = false)

class Post(
    val id: String, val author: Person, val text: String, val ago: String,
    val pic: Boolean = false, val parent: String? = null, val time: String = "",
    replies: Int = 0, likes: Int = 0, reposts: Int = 0, saves: Int = 0, shares: Int = 0,
    liked: Boolean = false, reposted: Boolean = false, saved: Boolean = false,
    val repostedBy: String? = null, val pinned: Boolean = false, val edited: Boolean = false,
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
