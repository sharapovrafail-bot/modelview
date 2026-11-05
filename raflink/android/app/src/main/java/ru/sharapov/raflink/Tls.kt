package ru.sharapov.raflink

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.spec.ECGenParameterSpec
import java.util.Date
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLServerSocketFactory
import javax.security.auth.x500.X500Principal

/**
 * Шифрование связи с ПК (TLS). Ключ создаётся один раз и хранится в защищённом хранилище
 * телефона (Android Keystore) — достать его оттуда нельзя. ПК запоминает «отпечаток»
 * сертификата при подключении и дальше не примет подменённый телефон.
 */
object Tls {
    private const val ALIAS = "raflink_tls"

    @Volatile
    var fingerprint: String? = null
        private set

    private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    fun ensureKey() {
        val ks = keyStore()
        if (!ks.containsAlias(ALIAS)) {
            val now = System.currentTimeMillis()
            val kpg = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
            kpg.initialize(
                KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
                    .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                    .setDigests(
                        KeyProperties.DIGEST_NONE, KeyProperties.DIGEST_SHA256,
                        KeyProperties.DIGEST_SHA384, KeyProperties.DIGEST_SHA512
                    )
                    .setCertificateSubject(X500Principal("CN=RafLink"))
                    .setCertificateSerialNumber(BigInteger.valueOf(now))
                    .setCertificateNotBefore(Date(now - 86_400_000L))
                    .setCertificateNotAfter(Date(now + 20L * 365 * 86_400_000L))
                    .build()
            )
            kpg.generateKeyPair()
        }
        val cert = ks.getCertificate(ALIAS)
        fingerprint = MessageDigest.getInstance("SHA-256").digest(cert.encoded)
            .joinToString("") { "%02x".format(it) }
    }

    fun serverSocketFactory(): SSLServerSocketFactory {
        val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm())
        kmf.init(keyStore(), null)
        val ctx = SSLContext.getInstance("TLS")
        ctx.init(kmf.keyManagers, null, null)
        return ctx.serverSocketFactory
    }
}
