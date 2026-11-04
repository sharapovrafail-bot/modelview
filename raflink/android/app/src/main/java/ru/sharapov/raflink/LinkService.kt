package ru.sharapov.raflink

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import java.net.Inet4Address
import java.net.NetworkInterface

/** Фоновая служба: держит сервер, объявляет телефон в сети Wi-Fi (mDNS). */
class LinkService : Service() {

    companion object {
        const val PORT = 47700
        const val ACTION_STOP = "ru.sharapov.raflink.STOP"
        const val ACTION_CHANGED = "ru.sharapov.raflink.CHANGED"
        @Volatile var running = false

        fun start(ctx: Context) {
            ContextCompat.startForegroundService(ctx, Intent(ctx, LinkService::class.java))
        }

        fun localIp(): String? = try {
            NetworkInterface.getNetworkInterfaces().toList()
                .filter { it.isUp && !it.isLoopback }
                .sortedBy { if (it.name.startsWith("wlan")) 0 else 1 }
                .flatMap { it.inetAddresses.toList() }
                .firstOrNull { it is Inet4Address && it.isSiteLocalAddress }
                ?.hostAddress
        } catch (e: Exception) { null }
    }

    private var server: HttpServer? = null
    private var nsd: NsdManager? = null
    private var nsdListener: NsdManager.RegistrationListener? = null
    private var wifiLock: WifiManager.WifiLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Notify.channels(this)
        ServiceCompat.startForeground(
            this, 1, buildNotification(),
            if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        )
        running = true
        server = HttpServer(this, PORT) { changed() }.also {
            try { it.start() } catch (e: Exception) { Prefs.addEvent(this, "info", "Ошибка сервера: ${e.message}") }
        }
        registerNsd()
        @Suppress("DEPRECATION")
        wifiLock = (applicationContext.getSystemService(WIFI_SERVICE) as WifiManager)
            .createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "raflink").apply {
                setReferenceCounted(false); acquire()
            }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        server?.stop()
        try { nsdListener?.let { nsd?.unregisterService(it) } } catch (_: Exception) {}
        wifiLock?.release()
        sendBroadcast(Intent(ACTION_CHANGED).setPackage(packageName))
        super.onDestroy()
    }

    private fun registerNsd() {
        val info = NsdServiceInfo().apply {
            serviceName = "RafLink ${HttpServer.deviceName(this@LinkService)}"
            serviceType = "_raflink._tcp"
            port = PORT
        }
        val l = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(i: NsdServiceInfo) {}
            override fun onRegistrationFailed(i: NsdServiceInfo, e: Int) {}
            override fun onServiceUnregistered(i: NsdServiceInfo) {}
            override fun onUnregistrationFailed(i: NsdServiceInfo, e: Int) {}
        }
        nsd = getSystemService(NSD_SERVICE) as NsdManager
        try {
            nsd?.registerService(info, NsdManager.PROTOCOL_DNS_SD, l)
            nsdListener = l
        } catch (_: Exception) {}
    }

    private fun changed() {
        val nm = getSystemService(android.app.NotificationManager::class.java)
        nm.notify(1, buildNotification())
        sendBroadcast(Intent(ACTION_CHANGED).setPackage(packageName))
    }

    private fun buildNotification(): Notification {
        val pc = Prefs.pcName(this)
        val ip = localIp()
        val title = if (pc != null) "На связи с ПК «$pc»" else "Ждёт подключения ПК"
        val text = if (ip != null) "Адрес телефона: $ip" else "Нет Wi-Fi"
        val stop = PendingIntent.getService(
            this, 1, Intent(this, LinkService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, Notify.CH_SERVICE)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setContentIntent(Notify.openApp(this))
            .addAction(0, "Отключить", stop)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }
}
