package ru.sharapov.raflink

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import kotlin.concurrent.thread

/** Отправка файлов с телефона на ПК: файлы встают в очередь, ПК забирает их сам. */
object Sender {

    class Result(val ok: Int, val failed: Int, val error: String?, val pcOnline: Boolean)

    private val main = Handler(Looper.getMainLooper())

    fun sendAll(ctx: Context, uris: List<Uri>, done: (Result) -> Unit) {
        val app = ctx.applicationContext
        thread(name = "raflink-send") {
            var ok = 0
            var fail = 0
            var error: String? = null
            for (u in uris) {
                try {
                    Outbox.add(app, u)
                    ok++
                } catch (e: Exception) {
                    fail++
                    error = e.message
                }
            }
            app.sendBroadcast(Intent(LinkService.ACTION_CHANGED).setPackage(app.packageName))
            val online = System.currentTimeMillis() - Prefs.lastSeen(app) < 15_000
            main.post { done(Result(ok, fail, error, online)) }
        }
    }

    fun message(r: Result): String = when {
        r.ok == 0 -> "Не отправлено: ${r.error}"
        !r.pcOnline -> "ПК сейчас не на связи. Файлов в очереди: ${r.ok} — уйдут, как только ПК появится"
        r.failed > 0 -> "Отправляю на ПК: ${r.ok}, не удалось: ${r.failed} (${r.error})"
        else -> "Отправляю на ПК: ${r.ok} шт. — придут через пару секунд"
    }
}
