package ru.sharapov.rafchat

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/** Держит RafChat в сети: маяк, приём сообщений и файлов, очередь доставки. */
class ChatService : Service() {
    companion object {
        fun start(ctx: Context) {
            if (Prefs.isSetUp(ctx)) ContextCompat.startForegroundService(ctx, Intent(ctx, ChatService::class.java))
        }

        fun restart(ctx: Context) {
            Node.stop()
            ctx.stopService(Intent(ctx, ChatService::class.java))
            start(ctx)
        }
    }

    private var mlock: WifiManager.MulticastLock? = null
    private var wlock: WifiManager.WifiLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Notify.channels(this)
        ServiceCompat.startForeground(
            this, 1, notification(),
            if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        )
        val wm = applicationContext.getSystemService(WIFI_SERVICE) as WifiManager
        mlock = wm.createMulticastLock("rafchat").apply { setReferenceCounted(false); acquire() }
        @Suppress("DEPRECATION")
        wlock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "rafchat").apply {
            setReferenceCounted(false); acquire()
        }
        try { Node.start(this) } catch (e: Exception) { stopSelf() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int) = START_STICKY

    override fun onDestroy() {
        Node.stop()
        mlock?.release()
        wlock?.release()
        super.onDestroy()
    }

    private fun notification(): Notification = NotificationCompat.Builder(this, Notify.CH_SERVICE)
        .setSmallIcon(R.drawable.ic_stat)
        .setContentTitle("RafChat в сети")
        .setContentText("Сообщения и файлы приходят, даже когда приложение закрыто")
        .setOngoing(true)
        .setContentIntent(
            PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        )
        .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        .build()
}
