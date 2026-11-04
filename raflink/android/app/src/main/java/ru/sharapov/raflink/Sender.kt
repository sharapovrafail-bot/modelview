package ru.sharapov.raflink

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlin.concurrent.thread

/** Отправка файлов с телефона на сопряжённый ПК. */
object Sender {

    class Result(val ok: Int, val failed: Int, val error: String?)

    private val main = Handler(Looper.getMainLooper())

    fun sendAll(ctx: Context, uris: List<Uri>, done: (Result) -> Unit) {
        val app = ctx.applicationContext
        thread(name = "raflink-send") {
            var ok = 0
            var fail = 0
            var error: String? = null
            for (u in uris) {
                try {
                    val name = send(app, u)
                    Prefs.addEvent(app, "→ ПК: $name")
                    ok++
                } catch (e: Exception) {
                    fail++
                    error = e.message
                }
            }
            app.sendBroadcast(android.content.Intent(LinkService.ACTION_CHANGED).setPackage(app.packageName))
            main.post { done(Result(ok, fail, error)) }
        }
    }

    private fun meta(ctx: Context, uri: Uri): Pair<String, Long> {
        var name = uri.lastPathSegment?.substringAfterLast('/') ?: "file"
        var size = -1L
        try {
            ctx.contentResolver.query(uri, null, null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    val ni = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    val si = c.getColumnIndex(OpenableColumns.SIZE)
                    if (ni >= 0 && !c.isNull(ni)) name = c.getString(ni)
                    if (si >= 0 && !c.isNull(si)) size = c.getLong(si)
                }
            }
        } catch (_: Exception) {}
        return name to size
    }

    fun send(ctx: Context, uri: Uri): String {
        val host = Prefs.pcHost(ctx) ?: throw IllegalStateException("ПК не подключён")
        val token = Prefs.token(ctx) ?: throw IllegalStateException("ПК не подключён")
        val (name, size) = meta(ctx, uri)
        val url = URL("http://$host:${Prefs.pcPort(ctx)}/api/push?name=" + URLEncoder.encode(name, "UTF-8"))
        val c = url.openConnection() as HttpURLConnection
        c.connectTimeout = 5000
        c.readTimeout = 120_000
        c.requestMethod = "POST"
        c.doOutput = true
        c.setRequestProperty("X-Token", token)
        c.setRequestProperty("X-From", HttpServer.deviceName())
        c.setRequestProperty("Content-Type", "application/octet-stream")
        if (size >= 0) c.setFixedLengthStreamingMode(size) else c.setChunkedStreamingMode(65536)
        try {
            ctx.contentResolver.openInputStream(uri).use { inp ->
                requireNotNull(inp) { "Не удалось открыть файл" }
                c.outputStream.use { inp.copyTo(it, 65536) }
            }
            val code = c.responseCode
            if (code == 401) throw IllegalStateException("ПК не узнал телефон — подключите заново")
            if (code != 200) throw IllegalStateException("ПК ответил: $code")
        } catch (e: java.net.ConnectException) {
            throw IllegalStateException("Нет связи с ПК — программа RafLink на ПК запущена?")
        } catch (e: java.net.SocketTimeoutException) {
            throw IllegalStateException("ПК не отвечает")
        } finally {
            c.disconnect()
        }
        return name
    }

}
