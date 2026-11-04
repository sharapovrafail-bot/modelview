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

    /** Запись журнала: время, вид ("out" — на ПК, "in" — с ПК, "info"), имя/текст. */
    data class Event(val time: Long, val kind: String, val text: String)

    fun events(ctx: Context): List<Event> =
        sp(ctx).getString("events2", "")!!.split('\n').filter { it.isNotBlank() }.mapNotNull {
            val a = it.split('|', limit = 3)
            if (a.size == 3) Event(a[0].toLongOrNull() ?: 0, a[1], a[2]) else null
        }

    fun addEvent(ctx: Context, kind: String, text: String) {
        val line = "${System.currentTimeMillis()}|$kind|${text.replace('\n', ' ')}"
        val old = sp(ctx).getString("events2", "")!!.split('\n').filter { it.isNotBlank() }
        sp(ctx).edit().putString("events2", (listOf(line) + old).take(20).joinToString("\n")).apply()
    }

    fun timeText(t: Long): String {
        val now = java.util.Calendar.getInstance()
        val c = java.util.Calendar.getInstance().apply { timeInMillis = t }
        val hm = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(t))
        val sameDay = now.get(java.util.Calendar.DAY_OF_YEAR) == c.get(java.util.Calendar.DAY_OF_YEAR) &&
            now.get(java.util.Calendar.YEAR) == c.get(java.util.Calendar.YEAR)
        if (sameDay) return "Сегодня, $hm"
        now.add(java.util.Calendar.DAY_OF_YEAR, -1)
        val yday = now.get(java.util.Calendar.DAY_OF_YEAR) == c.get(java.util.Calendar.DAY_OF_YEAR) &&
            now.get(java.util.Calendar.YEAR) == c.get(java.util.Calendar.YEAR)
        if (yday) return "Вчера, $hm"
        return SimpleDateFormat("dd.MM, HH:mm", Locale.getDefault()).format(Date(t))
    }
}
