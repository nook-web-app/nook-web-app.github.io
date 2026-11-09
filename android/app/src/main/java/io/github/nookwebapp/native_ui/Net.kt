package io.github.nookwebapp.native_ui

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.Callback
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

// The same server the web app talks to, and the same calls it makes through supabase-js: the table reads and writes
// (PostgREST), the stored functions (rpc), the edge functions, the file storage and the login. Every call runs off the
// main thread and answers with a result instead of throwing, like supabase-js does ({ data, error }).

const val SB_URL = "https://cimyolsipjdpibzaebmx.supabase.co"
const val SB_KEY = "sb_publishable_BzsW9TXvMRjUQf5BZj3pLg_197wdNpq"
// only the public columns of a profile are read; the moderation flags are not visible to other people
const val ACC_COLS = "id, username, display_name, bio, avatar, banner, banner_theme, public_key, deactivated, handle_changed_at, pinned_post_id, created_at"
const val OWNER_EMAIL = "haythamzoubi960@gmail.com"
const val OWNER_ID = "8a5d16ec-1050-40d2-8a7d-bcb75dc75bba"

// an error as PostgREST, the login server or the network gives it: code is the Postgres code ("23505") when there is one,
// status the HTTP status (0 when the server was never reached)
data class Err(val code: String, val message: String, val status: Int)

class Res(val data: Any?, val error: Err?, val count: Int? = null) {
    val ok get() = error == null
    // the rows of a list answer (an empty list for anything else)
    val rows: List<JSONObject> get() = (data as? JSONArray)?.let { a -> (0 until a.length()).mapNotNull { a.optJSONObject(it) } } ?: (data as? JSONObject)?.let { listOf(it) } ?: emptyList()
    // maybeSingle(): the first row, or null
    val one: JSONObject? get() = rows.firstOrNull()
}

// what an edge function answered: the status (0 when it could not be reached) and the JSON body ({} when there was none)
class Fn(val ok: Boolean, val status: Int, val body: JSONObject)

data class SbUser(val id: String, val email: String)
class Session(val access: String, val refresh: String, val expiresAt: Long, val user: SbUser) {
    fun json(): JSONObject = JSONObject().put("access_token", access).put("refresh_token", refresh).put("expires_at", expiresAt)
        .put("user", JSONObject().put("id", user.id).put("email", user.email))
    companion object {
        fun of(j: JSONObject?): Session? {
            if (j == null) return null
            val u = j.optJSONObject("user") ?: return null
            val at = j.optString("access_token"); val rt = j.optString("refresh_token")
            if (at.isEmpty() || rt.isEmpty() || u.optString("id").isEmpty()) return null
            val exp = j.optLong("expires_at").takeIf { it > 0 } ?: jwtExp(at) ?: (System.currentTimeMillis() / 1000 + j.optLong("expires_in", 3600))
            return Session(at, rt, exp, SbUser(u.optString("id"), u.optString("email")))
        }
    }
}

// the claims of a login ticket, read without checking it (the server checks it)
fun jwtClaims(t: String): JSONObject? = runCatching { JSONObject(String(java.util.Base64.getUrlDecoder().decode(t.split(".")[1].trimEnd('=')))) }.getOrNull()
fun jwtExp(t: String): Long? = jwtClaims(t)?.optLong("exp")?.takeIf { it > 0 }
fun jwtSub(t: String): String? = jwtClaims(t)?.optString("sub")?.ifEmpty { null }

// a table query, built the way supabase-js builds it: sb.from("posts").select(...).eq(...).order(...).limit(...)
class Q(val table: String) {
    internal val params = mutableListOf<Pair<String, String>>()
    private val orders = mutableListOf<String>()
    fun select(cols: String) = apply { params.add("select" to cols.replace(" ", "")) }
    fun eq(col: String, v: Any) = f(col, "eq.$v")
    fun neq(col: String, v: Any) = f(col, "neq.$v")
    fun gt(col: String, v: Any) = f(col, "gt.$v")
    fun gte(col: String, v: Any) = f(col, "gte.$v")
    fun lt(col: String, v: Any) = f(col, "lt.$v")
    fun isNull(col: String) = f(col, "is.null")
    fun inList(col: String, vs: Collection<Any>) = f(col, "in.(" + vs.joinToString(",") { quote(it.toString()) } + ")")
    fun or(expr: String) = apply { params.add("or" to "($expr)") }
    fun order(col: String, asc: Boolean = true) = apply { orders.add(col + if (asc) ".asc" else ".desc") }
    fun limit(n: Int) = apply { params.add("limit" to n.toString()) }
    fun range(from: Int, to: Int) = apply { params.add("offset" to from.toString()); params.add("limit" to (to - from + 1).toString()) }
    private fun f(col: String, v: String) = apply { params.add(col to v) }
    private fun quote(s: String) = if (SAFE.matches(s)) s else "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
    private companion object { val SAFE = Regex("^[A-Za-z0-9_.:-]+$") }
    fun query(): String {
        val all = params + (if (orders.isEmpty()) emptyList() else listOf("order" to orders.joinToString(",")))
        return all.joinToString("&") { (k, v) -> enc(k) + "=" + enc(v) }
    }
}

fun enc(s: String): String = URLEncoder.encode(s, "UTF-8").replace("+", "%20").replace("%2C", ",").replace("%28", "(").replace("%29", ")").replace("%3A", ":")

object Sb {
    // the default of 5 calls at a time to one host made the server calls, the photos and the live connection wait for each other
    val http: OkHttpClient = OkHttpClient.Builder().dispatcher(okhttp3.Dispatcher().apply { maxRequests = 64; maxRequestsPerHost = 24 }).connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).writeTimeout(60, TimeUnit.SECONDS).build()
    private val JSON_T = "application/json".toMediaType()

    // the login of the account that is open; saved (sealed) on this phone by whoever sets onSession
    @Volatile var session: Session? = null
    var onSession: (Session?) -> Unit = {}
    // true once the app has set its own onSession, so a background worker never replaces it
    @Volatile var wired = false
    // the server said this login is no longer valid (it was signed out somewhere, or the refresh token is spent)
    var onSignedOut: () -> Unit = {}
    private val refreshLock = Mutex()

    val user: SbUser? get() = session?.user
    fun isOwner() = session?.user?.let { it.id == OWNER_ID || it.email == OWNER_EMAIL } == true

    // ---- the login ----

    fun useSession(s: Session?) { session = s; onSession(s) }

    // a fresh access token when the one held runs out within a minute (autoRefreshToken)
    suspend fun token(): String? {
        val s = session ?: return null
        if (s.expiresAt - System.currentTimeMillis() / 1000 > 60) return s.access
        return refreshLock.withLock {
            val cur = session ?: return@withLock null
            if (cur.expiresAt - System.currentTimeMillis() / 1000 > 60) return@withLock cur.access
            val r = refresh(cur.refresh)
            when {
                r.first != null -> { useSession(r.first); r.first!!.access }
                // only a real refusal ends the login; a lost connection keeps the old token for the next try
                r.second in listOf(400, 401, 403) -> { useSession(null); onSignedOut(); null }
                else -> cur.access
            }
        }
    }

    // refreshSession({ refresh_token }): the new session, or the status the server gave (0 for no connection)
    suspend fun refresh(rt: String): Pair<Session?, Int> = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder().url("$SB_URL/auth/v1/token?grant_type=refresh_token").header("apikey", SB_KEY)
                .post(JSONObject().put("refresh_token", rt).toString().toRequestBody(JSON_T)).build()
            http.newCall(req).execute().use { res ->
                val txt = res.body?.string() ?: ""
                if (!res.isSuccessful) return@use null to res.code
                Session.of(runCatching { JSONObject(txt) }.getOrNull()) to res.code
            }
        } catch (e: Exception) { null to 0 }
    }

    // useSession({ access_token, refresh_token }): the user is read with the token (and the token renewed when it ran out)
    suspend fun takeSession(access: String, refresh: String): Session? {
        val exp = jwtExp(access) ?: 0
        if (exp * 1000 < System.currentTimeMillis() + 60_000) {
            val r = refresh(refresh).first ?: return null
            useSession(r); return r
        }
        val u = getUser(access) ?: return null
        val s = Session(access, refresh, exp, u)
        useSession(s)
        return s
    }

    suspend fun getUser(access: String): SbUser? = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder().url("$SB_URL/auth/v1/user").header("apikey", SB_KEY).header("Authorization", "Bearer $access").get().build()
            http.newCall(req).execute().use { res ->
                if (!res.isSuccessful) return@use null
                val j = JSONObject(res.body?.string() ?: "{}")
                SbUser(j.optString("id"), j.optString("email")).takeIf { it.id.isNotEmpty() }
            }
        } catch (e: Exception) { null }
    }

    // the login of this phone is dropped on the server too (scope=local); a failure there never keeps anyone signed in here
    suspend fun signOut() {
        val tok = session?.access
        useSession(null)
        if (tok != null) withContext(Dispatchers.IO) {
            runCatching {
                http.newCall(Request.Builder().url("$SB_URL/auth/v1/logout?scope=local").header("apikey", SB_KEY).header("Authorization", "Bearer $tok")
                    .post("{}".toRequestBody(JSON_T)).build()).execute().close()
            }
        }
    }

    // the account as the login server holds it now (email, created_at ...), or null. The login held here follows it, so a changed
    // email shows at once instead of after the next sign in
    suspend fun me(): JSONObject? {
        val tok = token() ?: return null
        val j = withContext(Dispatchers.IO) {
            runCatching {
                http.newCall(Request.Builder().url("$SB_URL/auth/v1/user").header("apikey", SB_KEY).header("Authorization", "Bearer $tok").get().build()).execute().use { r ->
                    if (r.isSuccessful) JSONObject(r.body?.string() ?: "{}") else null
                }
            }.getOrNull()
        } ?: return null
        val e = j.optString("email")
        session?.let { s -> if (e.isNotEmpty() && !e.equals(s.user.email, true) && j.optString("id") == s.user.id) useSession(Session(s.access, s.refresh, s.expiresAt, SbUser(s.user.id, e))) }
        return j
    }

    // updateUser({ email }): the login server sends the confirmation link
    suspend fun updateEmail(email: String, redirect: String = "https://nook-web-app.github.io/reset/?rn=email"): Err? {
        val tok = token() ?: return Err("", "not signed in", 401)
        return withContext(Dispatchers.IO) {
            try {
                val req = Request.Builder().url("$SB_URL/auth/v1/user?redirect_to=" + java.net.URLEncoder.encode(redirect, "UTF-8")).header("apikey", SB_KEY).header("Authorization", "Bearer $tok")
                    .put(JSONObject().put("email", email).toString().toRequestBody(JSON_T)).build()
                http.newCall(req).execute().use { res ->
                    if (res.isSuccessful) null else {
                        val j = runCatching { JSONObject(res.body?.string() ?: "{}") }.getOrNull() ?: JSONObject()
                        Err(j.optString("error_code", j.optString("code")), j.optString("msg", j.optString("message")), res.code)
                    }
                }
            } catch (e: Exception) { Err("", "network", 0) }
        }
    }

    // ---- tables ----

    private suspend fun headers(b: Request.Builder, token: String? = null): Request.Builder {
        b.header("apikey", SB_KEY)
        (token ?: token())?.let { b.header("Authorization", "Bearer $it") }
        return b
    }

    // the call runs on OkHttp's own threads and is cancelled with the coroutine that asked for it; `use` reads the answer
    private suspend fun <T> Call.go(use: (Response) -> T): T = suspendCancellableCoroutine { k ->
        k.invokeOnCancellation { cancel() }
        enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { k.resumeWithException(e) }
            override fun onResponse(call: Call, response: Response) {
                response.use { r -> try { k.resume(use(r)) } catch (e: Throwable) { k.resumeWithException(e) } }
            }
        })
    }

    private suspend fun exec(retried: Boolean = false, build: suspend () -> Request): Triple<Int, String, Response?> = withContext(Dispatchers.IO) {
        try {
            val req = build()
            val got = http.newCall(req).go { res -> Triple(res.code, res.body?.string() ?: "", res) }
            // a token that ran out between the check and the call is renewed once and the call made again
            if (got.first == 401 && !retried && session != null && got.second.contains("JWT", true)) {
                session?.let { s -> useSession(Session(s.access, s.refresh, 0, s.user)) }
                return@withContext exec(true, build)
            }
            got
        } catch (e: Exception) {
            // after a long time away the pooled connections are dead: they are dropped and a read is tried once more
            if (!retried && e is java.io.IOException) {
                val again = runCatching { build() }.getOrNull()
                if (again != null && (again.method == "GET" || again.method == "HEAD")) { dropConnections(); return@withContext exec(true, build) }
            }
            Triple(0, e.message ?: "network", null)
        }
    }

    // the connections kept from before the phone slept or changed network are closed
    fun dropConnections() { runCatching { http.connectionPool.evictAll() } }

    // the answer of a big call is parsed off the main thread
    private suspend fun parsed(code: Int, txt: String, res: Response?): Res =
        if (txt.length < 8192) parse(code, txt, res) else withContext(Dispatchers.IO) { parse(code, txt, res) }

    private fun parse(code: Int, txt: String, res: Response?): Res {
        if (code == 0) return Res(null, Err("", "network: $txt", 0))
        val body = if (txt.isBlank()) null else runCatching { JSONTokener(txt).nextValue() }.getOrNull()
        if (code !in 200..299) {
            val j = body as? JSONObject
            return Res(null, Err(j?.optString("code").orEmpty(), j?.optString("message")?.ifEmpty { null } ?: j?.optString("msg").orEmpty().ifEmpty { txt.take(200) }, code))
        }
        val count = res?.header("Content-Range")?.substringAfter("/", "")?.toIntOrNull()
        return Res(body, null, count)
    }

    suspend fun get(q: Q): Res {
        val (c, t, r) = exec { headers(Request.Builder().url("$SB_URL/rest/v1/${q.table}?${q.query()}")).get().build() }
        return parsed(c, t, r)
    }

    // select(col, { count: "exact", head: true })
    suspend fun count(q: Q): Res {
        val (c, t, r) = exec { headers(Request.Builder().url("$SB_URL/rest/v1/${q.table}?${q.query()}")).header("Prefer", "count=exact").head().build() }
        return parsed(c, t, r)
    }

    // insert / upsert; select names the columns to hand back (null: nothing comes back)
    suspend fun insert(table: String, rows: Any, select: String? = null, onConflict: String? = null, ignoreDuplicates: Boolean = false): Res {
        val p = mutableListOf<String>()
        if (select != null) p.add("select=" + enc(select.replace(" ", "")))
        if (onConflict != null) p.add("on_conflict=" + enc(onConflict))
        val prefer = listOfNotNull(if (select != null) "return=representation" else "return=minimal",
            if (onConflict != null) (if (ignoreDuplicates) "resolution=ignore-duplicates" else "resolution=merge-duplicates") else null).joinToString(",")
        val (c, t, r) = exec {
            headers(Request.Builder().url("$SB_URL/rest/v1/$table" + (if (p.isEmpty()) "" else "?" + p.joinToString("&")))).header("Prefer", prefer)
                .post(rows.toString().toRequestBody(JSON_T)).build()
        }
        return parsed(c, t, r)
    }
    suspend fun upsert(table: String, rows: Any, onConflict: String, ignoreDuplicates: Boolean = false, select: String? = null) = insert(table, rows, select, onConflict, ignoreDuplicates)

    suspend fun update(q: Q, values: JSONObject, select: String? = null): Res {
        if (select != null) q.select(select)
        val (c, t, r) = exec {
            headers(Request.Builder().url("$SB_URL/rest/v1/${q.table}?${q.query()}")).header("Prefer", if (select != null) "return=representation" else "return=minimal")
                .patch(values.toString().toRequestBody(JSON_T)).build()
        }
        return parsed(c, t, r)
    }

    suspend fun delete(q: Q, select: String? = null): Res {
        if (select != null) q.select(select)
        val (c, t, r) = exec {
            headers(Request.Builder().url("$SB_URL/rest/v1/${q.table}?${q.query()}")).header("Prefer", if (select != null) "return=representation" else "return=minimal").delete().build()
        }
        return parsed(c, t, r)
    }

    suspend fun rpc(fn: String, args: JSONObject = JSONObject(), token: String? = null): Res {
        val (c, t, r) = exec { headers(Request.Builder().url("$SB_URL/rest/v1/rpc/$fn"), token).post(args.toString().toRequestBody(JSON_T)).build() }
        return parsed(c, t, r)
    }

    // pageAll(): a long list read 1000 rows at a time (the server hands out at most 1000 per call)
    suspend fun pageAll(mk: () -> Q): Res {
        val out = JSONArray()
        var from = 0
        while (from < 20000) {
            val r = get(mk().range(from, from + 999))
            if (!r.ok) return Res(null, r.error)
            val a = r.data as? JSONArray ?: JSONArray()
            withContext(Dispatchers.IO) { for (i in 0 until a.length()) out.put(a.get(i)) }
            if (a.length() < 1000) return Res(out, null)
            from += 1000
        }
        return Res(null, Err("", "too many rows", 0))
    }

    // a write made with another account's login (an account being added next to the open one): status and body
    suspend fun asUser(token: String, method: String, path: String, body: Any?, prefer: String = "return=minimal"): Pair<Int, String> = withContext(Dispatchers.IO) {
        try {
            val b = Request.Builder().url("$SB_URL/rest/v1/$path").header("apikey", SB_KEY).header("Authorization", "Bearer $token").header("Prefer", prefer)
            val rb = (body?.toString() ?: "{}").toRequestBody(JSON_T)
            when (method) { "POST" -> b.post(rb); "PATCH" -> b.patch(rb); else -> b.get() }
            http.newCall(b.build()).execute().use { r -> r.code to (r.body?.string() ?: "") }
        } catch (e: Exception) { 0 to "" }
    }

    // ---- edge functions ----

    // callFn(): a lost connection or a timeout is an answer with status 0, never a thrown error
    suspend fun fn(name: String, body: JSONObject = JSONObject(), token: String? = null, timeoutS: Long = 25): Fn = withContext(Dispatchers.IO) {
        try {
            // an empty token means the call is made without any login (the banned page)
            val tok = token ?: token()
            val b = Request.Builder().url("$SB_URL/functions/v1/$name").header("apikey", SB_KEY).post(body.toString().toRequestBody(JSON_T))
            if (!tok.isNullOrEmpty()) b.header("Authorization", "Bearer $tok")
            http.newBuilder().callTimeout(timeoutS, TimeUnit.SECONDS).build().newCall(b.build()).go { res ->
                val j = runCatching { JSONObject(res.body?.string() ?: "") }.getOrNull() ?: JSONObject()
                Fn(res.isSuccessful, res.code, j)
            }
        } catch (e: Exception) { Fn(false, 0, JSONObject().put("error", "network")) }
    }

    // the raw answer of an edge function, for the ones that stream (Zenith) or answer with something else than JSON
    suspend fun fnRaw(name: String, body: JSONObject, timeoutS: Long = 90, onLine: ((String) -> Unit)? = null): Pair<Int, String> = withContext(Dispatchers.IO) {
        try {
            val tok = token()
            val b = Request.Builder().url("$SB_URL/functions/v1/$name").header("apikey", SB_KEY).post(body.toString().toRequestBody(JSON_T))
            if (tok != null) b.header("Authorization", "Bearer $tok")
            http.newBuilder().callTimeout(timeoutS, TimeUnit.SECONDS).readTimeout(timeoutS, TimeUnit.SECONDS).build().newCall(b.build()).go { res ->
                if (onLine == null || !res.isSuccessful) return@go res.code to (res.body?.string() ?: "")
                val src = res.body!!.source()
                val all = StringBuilder()
                while (!src.exhausted()) { val ln = src.readUtf8Line() ?: break; all.append(ln).append('\n'); onLine(ln) }
                res.code to all.toString()
            }
        } catch (e: Exception) { 0 to "" }
    }

    // ---- file storage ----

    fun publicUrl(bucket: String, path: String) = "$SB_URL/storage/v1/object/public/$bucket/" + path.split("/").joinToString("/") { enc(it) }

    suspend fun upload(bucket: String, path: String, bytes: ByteArray, type: String, cache: String = "3600"): Err? {
        val (c, t, r) = exec {
            headers(Request.Builder().url("$SB_URL/storage/v1/object/$bucket/" + path.split("/").joinToString("/") { enc(it) }))
                .header("x-upsert", "false").header("cache-control", "max-age=$cache")
                .post(bytes.toRequestBody(type.toMediaType())).build()
        }
        val res = parse(c, t, r)
        return res.error?.let { e -> Err((runCatching { JSONObject(t).optString("statusCode") }.getOrNull() ?: e.code), e.message, e.status) }
    }

    suspend fun remove(bucket: String, paths: List<String>): Err? {
        if (paths.isEmpty()) return null
        val (c, t, r) = exec {
            headers(Request.Builder().url("$SB_URL/storage/v1/object/$bucket"))
                .delete(JSONObject().put("prefixes", JSONArray(paths)).toString().toRequestBody(JSON_T)).build()
        }
        return parse(c, t, r).error
    }

    // createSignedUrl(path, seconds)
    suspend fun signedUrl(bucket: String, path: String, seconds: Int = 3600): String? {
        val (c, t, r) = exec {
            headers(Request.Builder().url("$SB_URL/storage/v1/object/sign/$bucket/" + path.split("/").joinToString("/") { enc(it) }))
                .post(JSONObject().put("expiresIn", seconds).toString().toRequestBody(JSON_T)).build()
        }
        val j = parse(c, t, r).data as? JSONObject ?: return null
        val u = j.optString("signedURL", j.optString("signedUrl")).ifEmpty { return null }
        return if (u.startsWith("http")) u else "$SB_URL/storage/v1$u"
    }

    // createSignedUrls(paths, seconds): path -> link
    suspend fun signedUrls(bucket: String, paths: List<String>, seconds: Int = 3600): Map<String, String> {
        if (paths.isEmpty()) return emptyMap()
        val (c, t, r) = exec {
            headers(Request.Builder().url("$SB_URL/storage/v1/object/sign/$bucket"))
                .post(JSONObject().put("expiresIn", seconds).put("paths", JSONArray(paths)).toString().toRequestBody(JSON_T)).build()
        }
        val a = parse(c, t, r).data as? JSONArray ?: return emptyMap()
        val out = HashMap<String, String>()
        for (i in 0 until a.length()) {
            val o = a.optJSONObject(i) ?: continue
            val u = o.optString("signedURL", o.optString("signedUrl"))
            if (u.isEmpty()) continue
            out[o.optString("path")] = if (u.startsWith("http")) u else "$SB_URL/storage/v1$u"
        }
        return out
    }

    // the bytes behind a link (photos of this app's own storage, or a signed link to the private chat files)
    suspend fun bytes(url: String, limit: Long = 30L shl 20): ByteArray? = withContext(Dispatchers.IO) {
        try {
            http.newCall(Request.Builder().url(url).get().build()).go { res ->
                if (!res.isSuccessful) return@go null
                val b = res.body ?: return@go null
                if (b.contentLength() > limit) return@go null
                b.bytes().takeIf { it.size <= limit }
            }
        } catch (e: Exception) { null }
    }

    // a plain GET for other sites (the leaked password check, the link previews of YouTube)
    suspend fun text(url: String, headers: Map<String, String> = emptyMap(), timeoutS: Long = 9): String? = withContext(Dispatchers.IO) {
        try {
            val b = Request.Builder().url(url).get()
            headers.forEach { (k, v) -> b.header(k, v) }
            http.newBuilder().callTimeout(timeoutS, TimeUnit.SECONDS).build().newCall(b.build()).go { res -> if (res.isSuccessful) res.body?.string() else null }
        } catch (e: Exception) { null }
    }

    // the path of a file of the given bucket inside one of its links (storagePath / dmPathOf in app.js)
    fun pathOf(url: String?, bucket: String): String? {
        if (url == null) return null
        for (k in listOf("public", "sign", "authenticated")) {
            val pre = "$SB_URL/storage/v1/object/$k/$bucket/"
            if (url.startsWith(pre)) return runCatching { java.net.URLDecoder.decode(url.substring(pre.length).split('?', '#')[0], "UTF-8") }.getOrNull()
        }
        return null
    }
}
