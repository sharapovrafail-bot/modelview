package ru.sharapov.raflink

import android.app.Activity
import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.DisplayMetrics
import android.view.Display
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import java.io.ByteArrayOutputStream

/** Показ экрана телефона на ПК (MediaProjection → JPEG-кадры). */
class ScreenService : Service() {

    companion object {
        const val ACTION_STOP = "ru.sharapov.raflink.SCREEN_STOP"
        private const val MAX_SIDE = 1280
        private const val FRAME_MS = 70L

        fun stop(ctx: Context) {
            if (ScreenState.running) {
                ctx.startService(Intent(ctx, ScreenService::class.java).setAction(ACTION_STOP))
            }
        }
    }

    private var projection: MediaProjection? = null
    private var display: VirtualDisplay? = null
    private var reader: ImageReader? = null
    private lateinit var thread: HandlerThread
    private lateinit var handler: Handler
    private var lastFrame = 0L
    private var pending = false
    private var bmp: Bitmap? = null
    private var w = 0
    private var h = 0

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (projection != null) return START_NOT_STICKY
        val code = intent?.getIntExtra("code", Activity.RESULT_CANCELED) ?: Activity.RESULT_CANCELED
        @Suppress("DEPRECATION")
        val data: Intent? = if (Build.VERSION.SDK_INT >= 33) intent?.getParcelableExtra("data", Intent::class.java)
        else intent?.getParcelableExtra("data")
        // Android 14: сначала службу переднего плана нужного типа, потом MediaProjection
        ServiceCompat.startForeground(
            this, 2, notification(),
            if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION else 0
        )
        if (code != Activity.RESULT_OK || data == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        thread = HandlerThread("raflink-screen").apply { start() }
        handler = Handler(thread.looper)
        val mpm = getSystemService(MediaProjectionManager::class.java)
        val mp = mpm.getMediaProjection(code, data)
        if (mp == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        projection = mp
        mp.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                stopSelf()
            }
        }, handler)
        val (sw, sh, dpi) = size()
        w = sw
        h = sh
        val r = newReader()
        display = mp.createVirtualDisplay(
            "RafLink", w, h, dpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, r.surface, null, handler
        )
        ScreenState.width = w
        ScreenState.height = h
        ScreenState.running = true
        Prefs.addEvent(this, "info", "Экран показывается на ПК")
        sendBroadcast(Intent(LinkService.ACTION_CHANGED).setPackage(packageName))
        return START_NOT_STICKY
    }

    private fun size(): Triple<Int, Int, Int> {
        val dm = getSystemService(DisplayManager::class.java)
        val m = DisplayMetrics()
        @Suppress("DEPRECATION")
        dm.getDisplay(Display.DEFAULT_DISPLAY).getRealMetrics(m)
        val scale = minOf(1f, MAX_SIDE.toFloat() / maxOf(m.widthPixels, m.heightPixels))
        val sw = ((m.widthPixels * scale).toInt() / 2) * 2
        val sh = ((m.heightPixels * scale).toInt() / 2) * 2
        return Triple(sw, sh, m.densityDpi)
    }

    private fun newReader(): ImageReader {
        val r = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 2)
        r.setOnImageAvailableListener({ schedule() }, handler)
        reader = r
        return r
    }

    /** Не чаще ~14 кадров/с; последний кадр после остановки движения тоже уходит. */
    private fun schedule() {
        if (pending) return
        pending = true
        val wait = maxOf(0L, FRAME_MS - (System.currentTimeMillis() - lastFrame))
        handler.postDelayed({ capture() }, wait)
    }

    private fun capture() {
        pending = false
        val r = reader ?: return
        val img = try { r.acquireLatestImage() } catch (e: Exception) { null } ?: return
        lastFrame = System.currentTimeMillis()
        try {
            if (ScreenState.watchers.get() == 0) return
            val plane = img.planes[0]
            val ps = plane.pixelStride
            val rowW = plane.rowStride / ps
            var b = bmp
            if (b == null || b.width != rowW || b.height != img.height) {
                b = Bitmap.createBitmap(rowW, img.height, Bitmap.Config.ARGB_8888)
                bmp = b
            }
            b.copyPixelsFromBuffer(plane.buffer)
            val crop = if (rowW != img.width) Bitmap.createBitmap(b, 0, 0, img.width, img.height) else b
            val bo = ByteArrayOutputStream(120_000)
            crop.compress(Bitmap.CompressFormat.JPEG, 62, bo)
            if (crop !== b) crop.recycle()
            ScreenState.publish(bo.toByteArray())
        } catch (_: Exception) {
        } finally {
            img.close()
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (projection == null || !::handler.isInitialized) return
        handler.post {
            val (sw, sh, dpi) = size()
            if (sw == w && sh == h) return@post
            w = sw
            h = sh
            val old = reader
            val r = newReader()
            display?.resize(w, h, dpi)
            display?.surface = r.surface
            old?.close()
            ScreenState.width = w
            ScreenState.height = h
        }
    }

    override fun onDestroy() {
        ScreenState.running = false
        ScreenState.clear()
        try { display?.release() } catch (_: Exception) {}
        try { reader?.close() } catch (_: Exception) {}
        try { projection?.stop() } catch (_: Exception) {}
        projection = null
        if (::thread.isInitialized) thread.quitSafely()
        sendBroadcast(Intent(LinkService.ACTION_CHANGED).setPackage(packageName))
        super.onDestroy()
    }

    private fun notification(): Notification {
        Notify.channels(this)
        val stop = PendingIntent.getService(
            this, 3, Intent(this, ScreenService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, Notify.CH_SERVICE)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("Экран показывается на ПК")
            .setContentText("Нажмите «Остановить», чтобы прекратить показ")
            .setOngoing(true)
            .setContentIntent(Notify.openApp(this))
            .addAction(0, "Остановить", stop)
            .build()
    }
}
