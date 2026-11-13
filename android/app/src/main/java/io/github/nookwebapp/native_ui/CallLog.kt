package io.github.nookwebapp.native_ui

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

// The log of a call, kept in the chat as a message: a card like a phone call, and a tap opens what was said (only the captions, no audio).
// It is an ordinary text message with a mark in front, so it is saved, synced and sealed like any other message:
//   <mark>CALL \n seconds \n Y|what you said \n Z|what he said ...
private const val MARK = "\u2060CALL"

class CallLine(val mine: Boolean, val text: String)

fun callLogText(seconds: Int, lines: List<Cap>): String {
    val sb = StringBuilder(MARK).append('\n').append(seconds)
    val rows = lines.filter { it.text.isNotBlank() }.map { (if (it.who == "You") "Y|" else "Z|") + it.text.replace(Regex("\\s+"), " ").trim() }
    // a very long call keeps its newest lines
    var keep = rows
    while (keep.sumOf { it.length + 1 } > 6000 && keep.size > 1) keep = keep.drop(1)
    keep.forEach { sb.append('\n').append(it) }
    return sb.toString()
}

fun callLogOf(text: String): Pair<Int, List<CallLine>>? {
    if (!text.startsWith(MARK)) return null
    val rows = text.split('\n')
    val secs = rows.getOrNull(1)?.toIntOrNull() ?: 0
    return secs to rows.drop(2).filter { it.length > 2 && it[1] == '|' }.map { CallLine(it[0] == 'Y', it.substring(2)) }
}

@Composable
fun CallLogCard(seconds: Int, lines: List<CallLine>, whenText: String, onLong: () -> Unit = {}) {
    val c = LocalNook.current
    var open by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(Rad.bubble)
    Column(Modifier.widthIn(max = 300.dp).clip(shape).background(c.bg2).border(1.dp, c.line, shape).animateContentSize().tap { open = !open }.padding(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(40.dp).clip(CircleShape).background(c.fill), contentAlignment = Alignment.Center) { NIcon("phone", 20.dp, tint = androidx.compose.ui.graphics.Color.White) }
            Column {
                T("Call with Zenith", Fs.base, FontWeight.SemiBold, c.fg)
                T("%d:%02d".format(seconds / 60, seconds % 60) + " · " + whenText + (if (open) "" else "  ·  tap to read"), Fs.sm, color = c.muted)
            }
        }
        if (open) {
            Spacer(Modifier.height(10.dp))
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (lines.isEmpty()) T("Nothing was written down", Fs.sm, color = c.muted)
                lines.forEach { l ->
                    Column(Modifier.fillMaxWidth(), horizontalAlignment = if (l.mine) Alignment.End else Alignment.Start) {
                        Box(Modifier.clip(RoundedCornerShape(Rad.bubble)).background(if (l.mine) c.accent else c.bg).padding(horizontal = 11.dp, vertical = 7.dp)) {
                            T(l.text, Fs.sm, color = if (l.mine) c.on else c.fg)
                        }
                    }
                }
            }
        }
    }
}

private fun Modifier.fillMaxWidth() = this.then(Modifier.fillMaxWidth())

// the end of the chat the call belongs to (and the lines of an earlier call), so he is not starting from nothing
fun callContext(app: AppState): String {
    val chat = app.store.chats.firstOrNull { it.id == app.callChatId } ?: app.store.chats.filter { it.zc || it.msgs.any { m -> m.ai } }.maxByOrNull { it.t } ?: return ""
    val out = ArrayList<String>()
    for (m in chat.msgs.takeLast(16)) {
        val log = callLogOf(m.text)
        if (log != null) { out.add("(an earlier call, the end of it:)"); log.second.takeLast(8).forEach { out.add((if (it.mine) "Him: " else "You: ") + it.text.take(160)) } }
        else if (m.text.isNotBlank()) out.add((if (m.ai) "You: " else "Him: ") + m.text.replace(Regex("\\s+"), " ").take(160))
    }
    var txt = out.joinToString("\n")
    if (txt.length > 1800) txt = txt.takeLast(1800)
    return txt
}
