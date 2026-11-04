package ru.sharapov.raflink

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

object Notify {
    const val CH_SERVICE = "service"
    const val CH_FILES = "files"
    const val CH_REQ = "requests"

    fun channels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CH_SERVICE, "Связь с ПК", NotificationManager.IMPORTANCE_LOW)
                .apply { description = "Постоянное уведомление, пока RafLink на связи" }
        )
        nm.createNotificationChannel(
            NotificationChannel(CH_FILES, "Полученные файлы", NotificationManager.IMPORTANCE_DEFAULT)
        )
        nm.createNotificationChannel(
            NotificationChannel(CH_REQ, "Запросы с ПК", NotificationManager.IMPORTANCE_HIGH)
                .apply { description = "ПК просит показать экран телефона" }
        )
    }

    fun openApp(ctx: Context): PendingIntent = PendingIntent.getActivity(
        ctx, 0, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

    fun delivered(ctx: Context, name: String) = show(ctx, "Получено на ПК", name)

    fun clip(ctx: Context, text: String) = show(ctx, "Текст с ПК в буфере", text.take(80).replace('\n', ' '))

    /** ПК просит показать экран: нажатие открывает системный запрос «Начать». */
    fun screenRequest(ctx: Context) {
        val i = Intent(ctx, ScreenConsentActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try { ctx.startActivity(i) } catch (_: Exception) {}   // сработает, если RafLink открыт
        if (!Perms.hasNotifications(ctx)) return
        val pi = PendingIntent.getActivity(ctx, 5, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(ctx, CH_REQ)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("ПК просит показать экран")
            .setContentText("Нажмите, затем «Начать»")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setTimeoutAfter(60_000)
            .build()
        try { NotificationManagerCompat.from(ctx).notify(77, n) } catch (_: SecurityException) {}
    }

    fun received(ctx: Context, name: String) = show(ctx, "Файл с ПК", "$name — в «Загрузки/RafLink»")

    private fun show(ctx: Context, title: String, text: String) {
        if (!Perms.hasNotifications(ctx)) return
        val n = NotificationCompat.Builder(ctx, CH_FILES)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(openApp(ctx))
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(ctx).notify(text.hashCode(), n)
        } catch (_: SecurityException) {}
    }
}
