package ru.sharapov.rafchat

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

object Notify {
    const val CH_SERVICE = "service"
    const val CH_MSG = "messages"

    fun channels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_SERVICE, "RafChat в сети", NotificationManager.IMPORTANCE_LOW))
        nm.createNotificationChannel(NotificationChannel(CH_MSG, "Сообщения", NotificationManager.IMPORTANCE_HIGH))
    }

    fun openChat(ctx: Context, chat: String): PendingIntent = PendingIntent.getActivity(
        ctx, chat.hashCode(),
        Intent(ctx, ChatActivity::class.java).putExtra("chat", chat).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

    fun message(ctx: Context, m: Msg) {
        val title = if (m.chat == Node.ALL) "Общий чат · ${m.senderName}" else m.senderName
        val body = if (m.file != null && m.text.isEmpty()) "📎 ${m.file.name}" else m.text
        val n = NotificationCompat.Builder(ctx, CH_MSG)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setContentIntent(openChat(ctx, m.chat))
            .setAutoCancel(true)
            .build()
        try { NotificationManagerCompat.from(ctx).notify(m.chat.hashCode(), n) } catch (_: SecurityException) {}
    }

    fun cancel(ctx: Context, chat: String) = NotificationManagerCompat.from(ctx).cancel(chat.hashCode())
}
