package io.github.nookwebapp.native_ui

import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// What must not be readable from the phone's files (the logins of the saved accounts, the message key): sealed with
// AES-GCM under a key that lives in the phone's key store and can never be taken out of it, like rtSeal() in app.js.
object Vault {
    private const val ALIAS = "nook-vault"
    private val key: SecretKey? by lazy {
        runCatching {
            val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            (ks.getKey(ALIAS, null) as? SecretKey) ?: KeyGenerator.getInstance(android.security.keystore.KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
                init(android.security.keystore.KeyGenParameterSpec.Builder(ALIAS, android.security.keystore.KeyProperties.PURPOSE_ENCRYPT or android.security.keystore.KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256).build())
                generateKey()
            }
        }.getOrNull()
    }

    // only the unit tests on a computer (no Android key store there) switch this on
    @Volatile var plainForTests = false

    fun seal(plain: ByteArray): ByteArray {
        val k = key ?: if (plainForTests) return byteArrayOf(0) + plain else throw IllegalStateException("no key store")
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, k) }
        return byteArrayOf(1) + c.iv + c.doFinal(plain)
    }

    fun open(b: ByteArray): ByteArray? = runCatching {
        when (b[0].toInt()) {
            // files written before the key store was required; they are sealed again at their next write
            0 -> b.copyOfRange(1, b.size)
            1 -> {
                val k = key ?: return null
                val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, k, GCMParameterSpec(128, b, 1, 12)) }
                c.doFinal(b, 13, b.size - 13)
            }
            else -> null
        }
    }.getOrNull()

    fun write(f: File, text: String?) {
        if (text == null) { f.delete(); return }
        val tmp = File(f.parentFile, f.name + ".tmp")
        // without a key store nothing is written, never the plain text
        val sealed = runCatching { seal(text.toByteArray()) }.getOrNull() ?: return
        tmp.writeBytes(sealed)
        tmp.renameTo(f)
    }

    fun read(f: File): String? = if (!f.exists()) null else runCatching { f.readBytes() }.getOrNull()?.let { open(it) }?.let { String(it) }
}
