package ru.sharapov.rafchat

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.widget.Toast
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/** Автообновление: смотрит последнюю сборку на GitHub; есть новее — кнопка «Обновить» на главном экране. */
object Updater {
    private const val API = "https://api.github.com/repos/sharapovrafail-bot/modelview/releases/tags/rafchat-latest"
    @Volatile var newVer: String? = null
    @Volatile var apkUrl: String? = null
    @Volatile var busy = false
    private var lastCheck = 0L

    private fun ver(v: String) = v.split('.').map { it.toIntOrNull() ?: 0 }
    private fun newer(a: String, b: String): Boolean {
        val x = ver(a); val y = ver(b)
        for (i in 0 until maxOf(x.size, y.size)) {
            val p = x.getOrElse(i) { 0 }; val q = y.getOrElse(i) { 0 }
            if (p != q) return p > q
        }
        return false
    }

    fun current(a: Activity): String = a.packageManager.getPackageInfo(a.packageName, 0).versionName ?: "0"

    /** Проверить (не чаще раза в 6 часов); onFound — в потоке интерфейса. */
    fun check(a: Activity, onFound: () -> Unit) {
        if (System.currentTimeMillis() - lastCheck < 3_600_000L && newVer == null) return   // при открытии, не чаще раза в час
        lastCheck = System.currentTimeMillis()
        val cur = current(a)
        thread(isDaemon = true) {
            try {
                val c = URL(API).openConnection() as HttpURLConnection
                c.connectTimeout = 10_000; c.readTimeout = 20_000
                c.setRequestProperty("User-Agent", "RafChat/$cur")
                c.setRequestProperty("Accept", "application/vnd.github+json")
                if (c.responseCode != 200) return@thread
                val rel = JSONObject(c.inputStream.bufferedReader().readText())
                val assets = rel.optJSONArray("assets") ?: return@thread
                for (i in 0 until assets.length()) {
                    val o = assets.getJSONObject(i)
                    val m = Regex("RafChat-(\\d+\\.\\d+\\.\\d+)\\.apk").matchEntire(o.optString("name")) ?: continue
                    if (newer(m.groupValues[1], cur)) {
                        newVer = m.groupValues[1]; apkUrl = o.getString("browser_download_url")
                        a.runOnUiThread(onFound)
                    }
                }
            } catch (_: Exception) {}
        }
    }

    /** Скачать APK и открыть установку (Android спросит «Обновить приложение?»). */
    fun install(a: Activity, onProgress: (String) -> Unit) {
        val url = apkUrl ?: return
        if (busy) return
        if (Build.VERSION.SDK_INT >= 26 && !a.packageManager.canRequestPackageInstalls()) {
            Toast.makeText(a, "Разрешите RafChat устанавливать обновления, затем снова нажмите «Обновить»", Toast.LENGTH_LONG).show()
            try {
                a.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${a.packageName}")))
            } catch (_: Exception) {}
            return
        }
        busy = true
        thread(isDaemon = true) {
            try {
                val dir = File(a.cacheDir, "update").apply { mkdirs() }
                val f = File(dir, "RafChat.apk")
                var c = URL(url).openConnection() as HttpURLConnection
                c.instanceFollowRedirects = true
                c.connectTimeout = 15_000; c.readTimeout = 60_000
                var hops = 0
                while (c.responseCode in 301..308 && hops++ < 5) {        // GitHub отдаёт файл через переадресацию
                    val loc = c.getHeaderField("Location"); c.disconnect()
                    c = URL(loc).openConnection() as HttpURLConnection
                    c.connectTimeout = 15_000; c.readTimeout = 60_000
                }
                val total = c.contentLengthLong
                var got = 0L
                var lastPct = -1
                c.inputStream.use { inp ->
                    f.outputStream().use { out ->
                        val buf = ByteArray(65536)
                        while (true) {
                            val n = inp.read(buf)
                            if (n < 0) break
                            out.write(buf, 0, n); got += n
                            val pct = if (total > 0) (got * 100 / total).toInt() else 0
                            if (pct != lastPct) { lastPct = pct; a.runOnUiThread { onProgress("Скачиваю… $pct%") } }
                        }
                    }
                }
                val uri = FileProvider.getUriForFile(a, a.packageName + ".files", f)
                a.runOnUiThread {
                    onProgress("Обновить до версии $newVer")
                    a.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
                }
            } catch (e: Exception) {
                a.runOnUiThread {
                    onProgress("Обновить до версии $newVer")
                    Toast.makeText(a, "Не удалось скачать обновление. Проверьте интернет.", Toast.LENGTH_LONG).show()
                }
            } finally { busy = false }
        }
    }
}
