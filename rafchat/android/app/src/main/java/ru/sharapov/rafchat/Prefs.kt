package ru.sharapov.rafchat

import android.content.Context
import android.content.SharedPreferences
import java.util.UUID

object Prefs {
    private fun sp(ctx: Context): SharedPreferences =
        ctx.applicationContext.getSharedPreferences("rafchat", Context.MODE_PRIVATE)

    fun id(ctx: Context): String {
        val s = sp(ctx)
        return s.getString("id", null) ?: UUID.randomUUID().toString().replace("-", "").also {
            s.edit().putString("id", it).apply()
        }
    }

    fun name(ctx: Context) = sp(ctx).getString("name", "") ?: ""
    fun dept(ctx: Context) = sp(ctx).getString("dept", "") ?: ""
    fun org(ctx: Context) = sp(ctx).getString("org", "") ?: ""
    fun extra(ctx: Context) = sp(ctx).getString("extra", "") ?: ""
    /** Сервер для работы через интернет; если не задан — встроенный в установщик. */
    fun server(ctx: Context): String =
        sp(ctx).getString("server", null)?.takeIf { it.isNotBlank() } ?: BuildConfig.DEFAULT_SERVER
    fun setServer(ctx: Context, v: String) = sp(ctx).edit().putString("server", v).apply()
    /** Хэш своего фото профиля (пусто — фото нет) и когда оно последний раз выложено на сервер. */
    fun avh(ctx: Context) = sp(ctx).getString("avh", "") ?: ""
    fun setAvh(ctx: Context, v: String) = sp(ctx).edit().putString("avh", v).putLong("avh_up", 0).apply()
    fun avhUp(ctx: Context) = sp(ctx).getLong("avh_up", 0)
    fun setAvhUp(ctx: Context, t: Long) = sp(ctx).edit().putLong("avh_up", t).apply()
    /** Удалённые чаты: не возвращать их из списка сервера, пока устройство само не выйдет на связь. */
    fun hidden(ctx: Context): Set<String> = sp(ctx).getStringSet("hidden", emptySet()) ?: emptySet()
    fun setHidden(ctx: Context, id: String, on: Boolean) {
        val s = HashSet(hidden(ctx))
        if (if (on) s.add(id) else s.remove(id)) sp(ctx).edit().putStringSet("hidden", s).apply()
    }
    /** Запомненный рабочий порт сервера (0 — основной) и шифрованный ли он. */
    fun relayAlt(ctx: Context): Pair<Int, Boolean> = sp(ctx).getInt("relay_alt_port", 0) to sp(ctx).getBoolean("relay_alt_tls", false)
    fun setRelayAlt(ctx: Context, port: Int, tls: Boolean) =
        sp(ctx).edit().putInt("relay_alt_port", port).putBoolean("relay_alt_tls", tls).apply()
    fun isSetUp(ctx: Context) = name(ctx).length >= 2 && org(ctx).length >= 4

    fun save(ctx: Context, name: String, dept: String, org: String, extra: String) {
        sp(ctx).edit().putString("name", name).putString("dept", dept).putString("org", org)
            .putString("extra", extra).apply()
    }
}
