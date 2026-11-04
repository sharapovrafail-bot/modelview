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

    fun channels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CH_SERVICE, "Связь с ПК", NotificationManager.IMPORTANCE_LOW)
                .apply { description = "Постоянное уведомление, пока RafLink на связи" }
        )
        nm.createNotificationChannel(
            NotificationChannel(CH_FILES, "Полученные файлы", NotificationManager.IMPORTANCE_DEFAULT)
        )
    }

    fun openApp(ctx: Context): PendingIntent = PendingIntent.getActivity(
        ctx, 0, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

    fun received(ctx: Context, name: String) {
        if (!Perms.hasNotifications(ctx)) return
        val n = NotificationCompat.Builder(ctx, CH_FILES)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("Файл с ПК")
            .setContentText("$name — в «Загрузки/RafLink»")
            .setContentIntent(openApp(ctx))
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(ctx).notify(name.hashCode(), n)
        } catch (_: SecurityException) {}
    }
}
