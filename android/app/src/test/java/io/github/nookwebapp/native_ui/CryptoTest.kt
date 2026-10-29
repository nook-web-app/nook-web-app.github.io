package io.github.nookwebapp.native_ui

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

// The native message lock against vectors made by the web app's own WebCrypto code (tools/e2evec.mjs): what the web
// sealed opens here, and what is sealed here is written out for the node script to open (node tools/e2evec.mjs check).
class CryptoTest {
    private val v = JSONObject(File("../tools/fixture/e2e.json").readText())

    @Test fun opensWhatTheWebSealed() {
        val a = Crypto.fromJwk(v.getJSONObject("a").getJSONObject("jwk"))
        assertEquals(v.getJSONObject("a").getString("pub"), a.pubB64)
        val key = Crypto.shared(a.priv, Crypto.pubFromB64(v.getJSONObject("b").getString("pub")))
        assertEquals(v.getString("text"), Crypto.openText(key, v.getString("sealed")))
        assertEquals(v.getString("text"), Crypto.openText(key, v.getString("sealedAad"), "c:xyz"))
        assertEquals(v.getString("link"), Crypto.linkCode(a.pubB64))
        val k = Crypto.openBackup(v.getJSONObject("backup"), v.getString("pw"), v.getString("uid"))
        assertEquals(a.pubB64, k.pubB64)
        val old = Crypto.openBackup(v.getJSONObject("oldBackup"), v.getString("pw"), v.getString("uid"))
        assertEquals(a.pubB64, old.pubB64)
    }

    @Test fun sealsForTheWeb() {
        val me = Crypto.newKeys()
        val key = Crypto.shared(me.priv, Crypto.pubFromB64(v.getJSONObject("b").getString("pub")))
        val out = JSONObject().put("pub", me.pubB64)
            .put("sealed", Crypto.sealText(key, v.getString("text")))
            .put("sealedAad", Crypto.sealText(key, v.getString("text"), "m:abc"))
            .put("backup", Crypto.sealBackup(me, v.getString("pw"), v.getString("uid"), "login"))
        File("build").mkdirs()
        File("build/e2e-out.json").writeText(out.toString())
        // the JWK round trip keeps the same key
        assertEquals(me.pubB64, Crypto.fromJwk(Crypto.jwk(me)).pubB64)
    }
}
