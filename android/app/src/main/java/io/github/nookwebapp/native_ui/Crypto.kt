package io.github.nookwebapp.native_ui

import org.json.JSONArray
import org.json.JSONObject
import java.math.BigInteger
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.interfaces.ECPrivateKey
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPrivateKeySpec
import java.security.spec.ECPublicKeySpec
import java.text.Normalizer
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

// The message lock of the web app, byte for byte, so a message sealed on one side opens on the other: P-256 key pairs
// (the public half as the 65 raw bytes, the private half carried as a JWK), ECDH whose 32 byte secret is the AES-GCM
// key, PBKDF2 for the password copies, and the "e2e1:" text format (base64 iv "." base64 ciphertext with its tag).
object Crypto {
    private val rnd = SecureRandom()
    val P256: ECParameterSpec by lazy { AlgorithmParameters.getInstance("EC").apply { init(ECGenParameterSpec("secp256r1")) }.getParameterSpec(ECParameterSpec::class.java) }

    fun random(n: Int) = ByteArray(n).also { rnd.nextBytes(it) }

    fun b64(b: ByteArray): String = java.util.Base64.getEncoder().encodeToString(b)
    fun unb64(s: String): ByteArray = java.util.Base64.getDecoder().decode(s.trim())
    private fun b64u(b: ByteArray): String = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(b)
    private fun unb64u(s: String): ByteArray = java.util.Base64.getUrlDecoder().decode(s.trimEnd('='))

    class Keys(val priv: ECPrivateKey, val pub: ECPublicKey) {
        // the public half as the account shows it (accounts.public_key)
        val pubB64: String get() = b64(raw(pub))
    }

    fun newKeys(): Keys {
        val kp = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1"), rnd) }.generateKeyPair()
        return Keys(kp.private as ECPrivateKey, kp.public as ECPublicKey)
    }

    private fun fixed(n: BigInteger): ByteArray {
        val b = n.toByteArray()
        return when {
            b.size == 32 -> b
            b.size > 32 -> b.copyOfRange(b.size - 32, b.size)
            else -> ByteArray(32 - b.size) + b
        }
    }

    fun raw(pub: ECPublicKey): ByteArray = byteArrayOf(4) + fixed(pub.w.affineX) + fixed(pub.w.affineY)

    fun pubFromRaw(raw: ByteArray): ECPublicKey {
        require(raw.size == 65 && raw[0].toInt() == 4) { "bad key" }
        val pt = ECPoint(BigInteger(1, raw.copyOfRange(1, 33)), BigInteger(1, raw.copyOfRange(33, 65)))
        return KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(pt, P256)) as ECPublicKey
    }
    fun pubFromB64(s: String) = pubFromRaw(unb64(s))

    // exportKey("jwk", priv) of WebCrypto
    fun jwk(k: Keys): JSONObject = JSONObject().put("crv", "P-256").put("d", b64u(fixed(k.priv.s))).put("ext", true)
        .put("key_ops", JSONArray().put("deriveKey")).put("kty", "EC").put("x", b64u(fixed(k.pub.w.affineX))).put("y", b64u(fixed(k.pub.w.affineY)))

    fun fromJwk(j: JSONObject): Keys {
        val kf = KeyFactory.getInstance("EC")
        val priv = kf.generatePrivate(ECPrivateKeySpec(BigInteger(1, unb64u(j.getString("d"))), P256)) as ECPrivateKey
        val pub = kf.generatePublic(ECPublicKeySpec(ECPoint(BigInteger(1, unb64u(j.getString("x"))), BigInteger(1, unb64u(j.getString("y")))), P256)) as ECPublicKey
        return Keys(priv, pub)
    }

    // deriveKey({ name: "ECDH", public }, priv, { name: "AES-GCM", length: 256 }): the raw shared secret is the key
    fun shared(priv: ECPrivateKey, peer: ECPublicKey): ByteArray = KeyAgreement.getInstance("ECDH").run { init(priv); doPhase(peer, true); generateSecret() }

    fun seal(key: ByteArray, iv: ByteArray, plain: ByteArray, aad: ByteArray? = null): ByteArray =
        Cipher.getInstance("AES/GCM/NoPadding").run {
            init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
            if (aad != null) updateAAD(aad)
            doFinal(plain)
        }

    fun open(key: ByteArray, iv: ByteArray, ct: ByteArray, aad: ByteArray? = null): ByteArray =
        Cipher.getInstance("AES/GCM/NoPadding").run {
            init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
            if (aad != null) updateAAD(aad)
            doFinal(ct)
        }

    // "e2e1:" + base64(iv) + "." + base64(ciphertext): sealText() / noteSeal()
    fun sealText(key: ByteArray, text: String, aad: String? = null): String {
        val iv = random(12)
        return "e2e1:" + b64(iv) + "." + b64(seal(key, iv, text.toByteArray(), aad?.toByteArray()))
    }
    fun openText(key: ByteArray, raw: String, aad: String? = null): String {
        val parts = raw.substring(5).split(".")
        return String(open(key, unb64(parts[0]), unb64(parts[1]), aad?.toByteArray()))
    }

    fun sha256(b: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(b)
    fun sha1Hex(s: String): String = MessageDigest.getInstance("SHA-1").digest(s.toByteArray()).joinToString("") { "%02X".format(it) }

    // PBKDF2 with HMAC-SHA-512 (or -256), 32 bytes out, from the UTF-8 bytes of the password: made by hand so the bytes
    // are exactly the ones WebCrypto uses, whatever the phone's own PBKDF2 does with characters
    fun pbkdf2(pw: ByteArray, salt: ByteArray, iters: Int, sha512: Boolean): ByteArray {
        val alg = if (sha512) "HmacSHA512" else "HmacSHA256"
        val mac = Mac.getInstance(alg).apply { init(SecretKeySpec(pw, alg)) }
        mac.update(salt); mac.update(byteArrayOf(0, 0, 0, 1))
        var u = mac.doFinal()
        val t = u.copyOf()
        for (i in 1 until iters) {
            u = mac.doFinal(u)
            for (k in t.indices) t[k] = (t[k].toInt() xor u[k].toInt()).toByte()
        }
        return t.copyOf(32)
    }

    // the backup format is told apart by its iteration count: 600000 and below is the old PBKDF2-SHA256 copy, above that
    // PBKDF2-SHA512 with the account and mode bound in as extra data
    const val KDF_ITERS = 1_000_000
    private const val KDF_OLD_MAX = 600_000
    fun kbV2(iters: Int) = iters > KDF_OLD_MAX
    private fun kbAad(uid: String, mode: String) = "nook-key-backup-v2:$uid:$mode".toByteArray()
    private fun recoveryKey(pw: String, salt: ByteArray, iters: Int) = pbkdf2(Normalizer.normalize(pw, Normalizer.Form.NFKC).toByteArray(), salt, iters, kbV2(iters))

    // sealKeyBackup(): the key goes into a row locked with the password; the server only ever holds the sealed copy
    fun sealBackup(k: Keys, pw: String, uid: String, mode: String): JSONObject {
        if (mode == "login" && pw.length < 8) throw IllegalArgumentException("weak lock")
        val salt = random(16); val iv = random(12)
        val ct = seal(recoveryKey(pw, salt, KDF_ITERS), iv, jwk(k).toString().toByteArray(), kbAad(uid, mode))
        return JSONObject().put("user_id", uid).put("mode", mode).put("salt", b64(salt)).put("iv", b64(iv)).put("ct", b64(ct))
            .put("iters", KDF_ITERS).put("pub", k.pubB64).put("updated_at", isoNow())
    }

    // openKeyBackup(): throws when the password is wrong or the copy is not the key it says it is
    fun openBackup(row: JSONObject, pw: String, uid: String): Keys {
        val iters = row.getInt("iters")
        val plain = open(recoveryKey(pw, unb64(row.getString("salt")), iters), unb64(row.getString("iv")), unb64(row.getString("ct")),
            if (kbV2(iters)) kbAad(uid, row.optString("mode", "recovery").ifEmpty { "recovery" }) else null)
        val k = fromJwk(JSONObject(String(plain)))
        if (k.pubB64 != row.optString("pub")) throw IllegalStateException("mismatch")
        return k
    }

    // twenty digits made from the public half of the temporary key: both phones show them, so a swapped request is seen
    fun linkCode(pubB64: String): String {
        val d = sha256(unb64(pubB64))
        var n = BigInteger.ZERO
        for (i in 0 until 9) n = n.shiftLeft(8).or(BigInteger.valueOf((d[i].toInt() and 255).toLong()))
        val s = n.mod(BigInteger.TEN.pow(20)).toString().padStart(20, '0')
        return s.chunked(4).joinToString(" ")
    }
}

fun isoNow(): String = isoOf(System.currentTimeMillis())
fun isoOf(t: Long): String = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US).apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }.format(java.util.Date(t))
// Date.parse() of the times the server hands out ("2026-10-28T09:15:02.123456+00:00")
fun parseIso(s: String?): Long {
    if (s.isNullOrEmpty()) return 0
    return runCatching { java.time.OffsetDateTime.parse(s.replace(" ", "T")).toInstant().toEpochMilli() }.getOrNull()
        ?: runCatching { java.time.Instant.parse(s).toEpochMilli() }.getOrNull()
        ?: runCatching { java.time.LocalDateTime.parse(s.replace(" ", "T")).toInstant(java.time.ZoneOffset.UTC).toEpochMilli() }.getOrNull() ?: 0
}
