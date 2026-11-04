package ru.sharapov.raflink

import android.content.Context
import android.content.SharedPreferences
import java.security.SecureRandom
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Настройки: код подключения, сопряжённый ПК, журнал передач. */
object Prefs {
    private const val NAME = "raflink"
    private val rnd = SecureRandom()

    fun sp(ctx: Context): SharedPreferences =
        ctx.applicationContext.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    fun pin(ctx: Context): String {
        val p = sp(ctx).getString("pin", null)
        return p ?: newPin(ctx)
    }

    fun newPin(ctx: Context): String {
        val p = (100000 + rnd.nextInt(900000)).toString()
        sp(ctx).edit().putString("pin", p).apply()
        return p
    }

    fun newToken(): String {
        val b = ByteArray(24)
        rnd.nextBytes(b)
        return b.joinToString("") { "%02x".format(it) }
    }

    fun token(ctx: Context): String? = sp(ctx).getString("token", null)
    fun pcName(ctx: Context): String? = sp(ctx).getString("pcName", null)
    fun pcHost(ctx: Context): String? = sp(ctx).getString("pcHost", null)
    fun pcPort(ctx: Context): Int = sp(ctx).getInt("pcPort", 47701)
    fun isPaired(ctx: Context) = token(ctx) != null

    fun savePairing(ctx: Context, token: String, pcName: String, host: String, port: Int) {
        sp(ctx).edit()
            .putString("token", token)
            .putString("pcName", pcName)
            .putString("pcHost", host)
            .putInt("pcPort", port)
            .apply()
    }

    fun updatePcHost(ctx: Context, host: String) {
        if (pcHost(ctx) != host) sp(ctx).edit().putString("pcHost", host).apply()
    }

    fun lastSeen(ctx: Context): Long = sp(ctx).getLong("lastSeen", 0)
    fun touch(ctx: Context) = sp(ctx).edit().putLong("lastSeen", System.currentTimeMillis()).apply()

    fun events(ctx: Context): List<String> =
        sp(ctx).getString("events", "")!!.split('\n').filter { it.isNotBlank() }

    fun addEvent(ctx: Context, text: String) {
        val t = SimpleDateFormat("dd.MM HH:mm", Locale.getDefault()).format(Date())
        val list = (listOf("$t  $text") + events(ctx)).take(15)
        sp(ctx).edit().putString("events", list.joinToString("\n")).apply()
    }
}
