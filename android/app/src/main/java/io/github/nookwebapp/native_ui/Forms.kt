package io.github.nookwebapp.native_ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// The small forms that open over everything (modal() in app.js): adding accounts, passwords, the authenticator,
// the message key, a nickname, deleting the account and the banned account's download.

// pwField(): a password box with Show / Hide
@Composable
fun PwField(value: String, onChange: (String) -> Unit, placeholder: String) {
    val c = LocalNook.current
    var show by remember { mutableStateOf(false) }
    Field(value, onChange, placeholder, border = true, password = !show, trailing = { Box(Modifier.tap { show = !show }) { T(if (show) "Hide" else "Show", Fs.md, FontWeight.SemiBold, c.muted) } })
}

@Composable private fun Note(t: String) = T(t, Fs.md, color = LocalNook.current.muted, modifier = Modifier.padding(bottom = 6.dp))
@Composable private fun Msg(t: String) { if (t.isNotEmpty()) T(t, Fs.md, color = LocalNook.current.muted, align = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) }
@Composable private fun Gap() = Spacer(Modifier.height(12.dp))

// a form whose button runs some work: the button is off while it runs, and an answer is shown under the fields
@Composable
private fun Form(p: Panel, title: String, action: String, top: Boolean = false, onCancel: (() -> Unit)? = null, inline: Boolean = false, run: suspend () -> String?, body: @Composable ColumnScope.(String) -> Unit) {
    val app = LocalApp.current
    var busy by remember { mutableStateOf(false) }
    var msg by remember { mutableStateOf("") }
    val fire = { if (!busy) { busy = true; msg = ""; app.scope.launch { val r = run(); if (r == null) app.closePanel(p) else msg = r; busy = false } }; Unit }
    // inline: the button is placed by the form itself (FormAction), not under the last field
    Modal(title, action, enabled = !busy, top = top, onCancel = { onCancel?.invoke(); app.closePanel(p) }, onAction = fire, showAction = !inline) {
        CompositionLocalProvider(LocalFormRun provides FormRun(busy, fire)) { body(msg); Msg(msg) }
    }
}

private class FormRun(val busy: Boolean, val fire: () -> Unit)
private val LocalFormRun = compositionLocalOf { FormRun(false) {} }

// the sign in screen of an account added next to the open one (addAccountModal)
@Composable
fun AddAccountPanel(app: AppState, p: Panel) {
    var email by remember { mutableStateOf("") }
    var pw by remember { mutableStateOf("") }
    Form(p, "", "Sign in", inline = true, run = {
        val e = email.trim()
        if (e.isEmpty() || pw.isEmpty()) "Enter the email and password"
        else app.on.addAccount(e, pw)?.let { it } ?: run { app.say("Account added"); app.scope.launch { delay(350); app.on.openAccounts() }; null }
    }) {
        T("Nook", Fs.x3, FontWeight.Bold, align = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 16.dp))
        T("Sign in to continue", color = LocalNook.current.muted, align = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp))
        Field(email, { email = it }, "Email", border = true); Gap()
        PwField(pw, { pw = it }, "Password"); Gap()
        val form = LocalFormRun.current
        Pill("Sign in", Btn.Pri, enabled = !form.busy, modifier = Modifier.fillMaxWidth()) { form.fire() }
        Gap()
        if (Passkey.ok()) {
            var busy by remember { mutableStateOf(false) }
            LaunchedEffect(Unit) { app.on.passkeyWarm() }
            Pill("Sign in with Fingerprint", Btn.Ghost, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                busy = true
                app.scope.launch {
                    val r = app.on.addAccountPasskey()
                    busy = false
                    if (r == null) { app.closePanel(p); app.say("Account added"); delay(350); app.on.openAccounts() } else if (r.isNotEmpty()) app.say(r)
                }
            }
            Gap()
        }
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { Box(Modifier.tap { app.panels.add(Panel.Recover(email.trim())) }.vpad(8.dp)) { T("Forgot password?", Fs.md, color = LocalNook.current.muted) } }
        Pill("Make an account", Btn.Ghost, modifier = Modifier.fillMaxWidth()) { app.closePanel(p); app.panels.add(Panel.NewAccount) }
    }
}

// newAccountModal(): a brand new account kept on this phone next to the open one; the open one stays open
@Composable
fun NewAccountPanel(app: AppState, p: Panel) {
    var dn by remember { mutableStateOf("") }
    var user by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var pw by remember { mutableStateOf("") }
    Form(p, "", "Create account", run = {
        val n = dn.trim(); val u = user.trim(); val e = email.trim()
        when {
            n.isEmpty() -> "Enter a display name"
            !Regex("^[A-Za-z0-9._]{1,15}$").matches(u) -> "Username: letters, numbers, dots or underscores, max 15"
            !EMAIL_RE.matches(e) -> "That email does not look right. Check for typos"
            pw.length < 8 -> "Password needs at least 8 characters"
            pwBytes(pw) > 72 -> "Password is too long (72 bytes at most)"
            else -> app.on.newAccount(n, u, e, pw)?.let { r -> if (r.isEmpty() || r.startsWith("Account created")) { app.say(r.ifEmpty { "Account created" }); app.scope.launch { delay(350); app.on.openAccounts() }; null } else r }
        }
    }) {
        T("Nook", Fs.x3, FontWeight.Bold, align = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 16.dp))
        T("Make your account", color = LocalNook.current.muted, align = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp))
        Hinted(dn, 15) { Field(dn, { if (it.length <= 15) dn = it }, "Display name", border = true) }; Gap()
        Hinted(user, 15, if (user.isNotEmpty() && !Regex("^[A-Za-z0-9._]*$").matches(user)) "Only letters, numbers, dots and underscores" else null) { Field(user, { if (it.length <= 15) user = it }, "Username", border = true) }; Gap()
        Field(email, { email = it }, "Email", border = true); Gap()
        Hinted(pw, 72, null, 8) { PwField(pw, { if (it.length <= 72) pw = it }, "Password") }
    }
}

@Composable
fun LinkedLoginPanel(app: AppState, p: Panel.LinkedLogin) {
    var pw by remember { mutableStateOf("") }
    Form(p, "@" + p.x.username, "Switch", run = { if (pw.isEmpty()) "Enter the password" else app.on.linkedLogin(p.x, pw) }) {
        PwField(pw, { pw = it }, "Password")
        if (Passkey.ok()) {
            var busy by remember { mutableStateOf(false) }
            LaunchedEffect(Unit) { app.on.passkeyWarm() }
            Gap()
            Pill("Use Fingerprint", Btn.Ghost, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                busy = true
                app.scope.launch { val r = app.on.linkedLoginPasskey(p.x); busy = false; if (r == null) app.closePanel(p) else if (r.isNotEmpty()) app.say(r) }
            }
        }
    }
}

// newPasswordModal(): opened from the link in the reset email; the person is signed in just for this
@Composable
fun NewPasswordPanel(app: AppState, p: Panel) {
    var a by remember { mutableStateOf("") }
    var b by remember { mutableStateOf("") }
    Form(p, "New password", "Save", onCancel = { app.scope.launch { Sb.signOut(); app.on.restart() } }, run = { app.on.setNewPassword(a, b) }) {
        Note("Choose a new password for your account.")
        PwField(a, { a = it }, "New password"); Gap(); PwField(b, { b = it }, "New password again")
    }
}

@Composable
fun RecoverPanel(app: AppState, p: Panel.Recover) {
    var ident by remember { mutableStateOf(p.prefill) }
    var code by remember { mutableStateOf("") }
    Form(p, "Reset password", "Send link", run = { app.on.sendReset(ident.trim(), code) }) {
        Note("We will email you a link to choose a new password. If you turned on an authenticator app, type its code too.")
        Field(ident, { ident = it }, "Email or username", border = true); Gap()
        Field(code, { code = it.take(7) }, "Authenticator code (only if you use one)", border = true)
        Box(Modifier.fillMaxWidth().padding(top = 8.dp), contentAlignment = Alignment.Center) { Box(Modifier.tap { app.closePanel(p); app.panels.add(Panel.RecoverCode(ident.trim())) }.vpad(8.dp)) { T("Use my authenticator code instead", Fs.md, color = LocalNook.current.muted) } }
    }
}

@Composable
fun RecoverCodePanel(app: AppState, p: Panel.RecoverCode) {
    var ident by remember { mutableStateOf(p.prefill) }
    var code by remember { mutableStateOf("") }
    var a by remember { mutableStateOf("") }
    var b by remember { mutableStateOf("") }
    Form(p, "Authenticator code", "Reset", run = { app.on.recoverWithCode(ident.trim(), code, a, b) }) {
        Note("Type the 6 digit code from your authenticator app.")
        Field(ident, { ident = it }, "Email or username", border = true); Gap()
        Field(code, { code = it.take(7) }, "6 digit code", border = true); Gap()
        PwField(a, { a = it }, "New password"); Gap(); PwField(b, { b = it }, "New password again")
    }
}

@Composable
fun ChangePasswordPanel(app: AppState, p: Panel) {
    var cur by remember { mutableStateOf("") }
    var a by remember { mutableStateOf("") }
    var b by remember { mutableStateOf("") }
    Form(p, "Change password", "Save", run = { app.on.changePassword(cur, a, b) }) {
        PwField(cur, { cur = it }, "Current password"); Gap(); PwField(a, { a = it }, "New password"); Gap(); PwField(b, { b = it }, "New password again")
    }
}

@Composable
fun ChangeEmailPanel(app: AppState, p: Panel) {
    var cur by remember { mutableStateOf("") }
    var e by remember { mutableStateOf("") }
    Form(p, "Change email", "Save", run = { app.on.changeEmail(cur, e) }) { PwField(cur, { cur = it }, "Current password"); Gap(); Field(e, { e = it }, "New email", border = true) }
}

// authenticatorSetup(): first the password, then the key is shown (and opens the authenticator app), then the code
@Composable
fun TotpSetupPanel(app: AppState, p: Panel) {
    val c = LocalNook.current
    val uri = LocalUriHandler.current
    var pw by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var secret by remember { mutableStateOf<Pair<String, String>?>(null) }
    Form(p, "Authenticator app", if (secret == null) "Continue" else "Turn on", run = {
        val sct = secret
        if (sct == null) {
            if (pw.isEmpty()) return@Form "Type your password"
            val r = Sb.fn("totp", org.json.JSONObject().put("action", "begin").put("password", pw))
            if (!r.ok) return@Form failText(r, "Could not start the setup.")
            secret = r.body.optString("uri") to r.body.optString("secret")
            "Then type the 6 digit code it shows"
        } else {
            val cc = code.replace(Regex("\\s+"), "")
            if (!Regex("^\\d{6}$").matches(cc)) return@Form "Type the 6 digit code from the app"
            val r = Sb.fn("totp", org.json.JSONObject().put("action", "enable").put("code", cc))
            if (!r.ok) failText(r, "That code did not work") else { totpOn = true; app.say("Authenticator is on"); null }
        }
    }) {
        val sct = secret
        if (sct == null) { Note("Type your password to start."); PwField(pw, { pw = it }, "Your password") }
        else {
            Pill("Add Nook to the app", Btn.Pri, modifier = Modifier.fillMaxWidth()) { runCatching { uri.openUri(sct.first) } }
            Note("If that does not open the app, add it by hand with this key. Tap the key to copy it.")
            Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(Rad.s)).background(c.bg2).tap { app.clipboard(sct.second) }.padding(14.dp), contentAlignment = Alignment.Center) { T(sct.second, Fs.lg, FontWeight.Bold) }
            Gap()
            Fld("Then type the 6 digit code it shows") { Field(code, { code = it.take(7) }, "6 digit code") }
        }
    }
}

@Composable
fun TotpOffPanel(app: AppState, p: Panel) {
    var code by remember { mutableStateOf("") }
    Form(p, "Turn off authenticator", "Turn off", run = {
        val cc = code.replace(Regex("\\s+"), "")
        if (!Regex("^\\d{6}$").matches(cc)) return@Form "Type the 6 digit code from the app"
        val r = Sb.fn("totp", org.json.JSONObject().put("action", "disable").put("code", cc))
        if (!r.ok) failText(r, "That code did not work") else { totpOn = false; app.say("Authenticator is off"); null }
    }) { Note("Type the 6 digit code from your authenticator app. Without it you can not reset a forgotten password."); Field(code, { code = it.take(7) }, "6 digit code", border = true) }
}

// waitForApprovalModal(): this phone shows twenty digits; the other phone shows the same and approves
@Composable
fun WaitApprovalPanel(app: AppState, p: Panel) {
    var code by remember { mutableStateOf("...") }
    var msg by remember { mutableStateOf("") }
    var stop by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { app.on.waitForApproval({ code = it }, { msg = it }) { stop } }
    Modal("Approve on your other phone", "Done", onCancel = { stop = true; app.closePanel(p); app.on.unlockSheet() }, onAction = { stop = true; app.closePanel(p) }) {
        Note("On your other phone tap Approve. The code must match.")
        CodeBox(code)
        Msg(msg)
    }
}

@Composable
private fun CodeBox(t: String) = T(t, Fs.x2, FontWeight.Bold, align = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(vertical = 14.dp))

// approveLinkModal(): a new phone of this account asks for the messages; approve only if the code matches
@Composable
fun ApproveLinkPanel(app: AppState, p: Panel.ApproveLink) {
    Form(p, "New phone", "Approve", onCancel = { app.on.denyLink(p.id) }, run = { app.on.approveLink(p.id, p.pub) }) {
        Note("A new phone wants your messages. Approve only if the code matches.")
        CodeBox(Crypto.linkCode(p.pub))
    }
}

@Composable
fun RestoreKeysPanel(app: AppState, p: Panel.RestoreKeys) {
    var pw by remember { mutableStateOf("") }
    Form(p, if (p.login) "Login password" else "Recovery password", "Unlock", run = { app.on.restoreKeys(p.login, pw) }) {
        Note(if (p.login) "Type your login password." else "Type your recovery password.")
        PwField(pw, { pw = it }, if (p.login) "Login password" else "Recovery password")
    }
}

@Composable
fun BackupSetupPanel(app: AppState, p: Panel.BackupSetup) {
    var a by remember { mutableStateOf("") }
    var b by remember { mutableStateOf("") }
    Form(p, if (p.changing) "New recovery password" else "Message key backup", "Save", run = { app.on.backupSetup(a, b, p.changing) }) {
        Note("A password only you know. Nook never sees it. Write it down, nobody can recover it.")
        PwField(a, { a = it }, "Recovery password"); Gap(); PwField(b, { b = it }, "Type it again")
    }
}

@Composable
fun StartSavingPanel(app: AppState, p: Panel) {
    var pw by remember { mutableStateOf("") }
    Form(p, "Save my key", "Save", run = { app.on.startSaving(pw) }) {
        Note("A new phone opens your messages when you sign in. Less private than a recovery password.")
        PwField(pw, { pw = it }, "Your login password")
    }
}

@Composable
fun NicknamePanel(app: AppState, p: Panel.Nickname) {
    var v by remember { mutableStateOf(app.on.nickOf(p.other)) }
    Form(p, "Nickname", "Save", run = { if (app.on.saveNickname(p.other, v)) null else "" }) {
        Fld("Only you can see this") { Field(v, { if (it.length <= 30) v = it }, p.name.ifEmpty { "Nickname" }) }
        Note("Leave it empty to remove the nickname.")
    }
}

// confirmLogin(): deleting the account asks for its email and password first
@Composable
fun DeleteAccountPanel(app: AppState, p: Panel) {
    var email by remember { mutableStateOf("") }
    var pw by remember { mutableStateOf("") }
    Form(p, "", "Delete", run = { app.on.deleteAccount(email, pw) }) {
        T("Delete account", Fs.x3, FontWeight.Bold, align = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 16.dp))
        T("Your account is hidden and kept for 30 days. Sign in any time in that period to get it back. After that it is deleted for good.", color = LocalNook.current.muted, align = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp))
        Field(email, { email = it }, "Email", border = true); Gap(); PwField(pw, { pw = it }, "Password")
    }
}

// bannedDownload(): the banned account's email and password bring its data as a zip
@Composable
fun BanDownloadPanel(app: AppState, p: Panel) {
    var email by remember { mutableStateOf(app.banEmail) }
    var pw by remember { mutableStateOf("") }
    var say by remember { mutableStateOf("") }
    Form(p, "Download my data", "Download", run = {
        val e = email.trim()
        if (e.isEmpty() || pw.isEmpty()) return@Form "Fill in your email and password"
        say = "Checking..."
        val f = app.on.banExport(e, pw) { say = it }
        if (f == null) say else { app.shareFile(f, "application/zip"); null }
    }) {
        Note("Type the email and password of the banned account. You get a zip with your posts, photos, profile and chats.")
        Field(email, { email = it }, "Email", border = true); Gap(); PwField(pw, { pw = it }, "Password")
        if (say.isNotEmpty()) T(say, Fs.md, color = LocalNook.current.muted, align = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
    }
}

// zenEdit(): the owner changes how Zenith looks: his picture and banner style
@Composable
fun ZenEditPanel(app: AppState, p: Panel) {
    val c = LocalNook.current
    var pfp by remember { mutableStateOf(app.store.zen.optStr("pfp")) }
    var blurred by remember { mutableStateOf(app.store.zen.optString("bn") == "avatar") }
    val pick = rememberPicker(1) { got -> got.firstOrNull()?.let { src -> app.panels.add(Panel.Crop(src, true, 320, 320, "Crop picture") { out -> if (out != null) pfp = out }) } }
    Modal("Edit Zenith", "Save", top = true, onCancel = { app.closePanel(p) }, onAction = { app.on.saveZen(pfp, blurred); app.closePanel(p) }) {
        Box(Modifier.fillMaxWidth().aspectRatio(1000f / 330f).clip(RoundedCornerShape(Rad.m))) {
            BannerPic(null, pfp?.takeIf { blurred }, "avatar")
        }
        Box(Modifier.padding(start = 12.dp).layoutOffsetUp(44.dp).width(88.dp)) {
            Box(Modifier.size(88.dp).clip(androidx.compose.foundation.shape.CircleShape).background(c.bg).padding(4.dp)) {
                if (pfp != null) RoundPic(pfp, 80.dp, androidx.compose.ui.graphics.SolidColor(LocalNook.current.bg2)) {} else ZenAv(80.dp)
            }
            PickBtn(Modifier.align(Alignment.BottomEnd).offset(x = 6.dp, y = (-2).dp), icon = 16.dp) { pick.gallery() }
        }
        Fld("Banner style") { Seg(listOf("Default", "Blurred photo"), if (blurred) 1 else 0, Modifier.padding(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 14.dp)) { if (it == 1 && pfp == null) app.say("Pick a picture first") else blurred = it == 1 } }
        if (pfp != null) Box(Modifier.tap { pfp = null; blurred = false }.vpad(8.dp)) { T("Use default picture", color = c.danger) }
    }
}
