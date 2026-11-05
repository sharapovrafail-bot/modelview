package ru.sharapov.raflink

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Запуск связи после перезагрузки телефона и после обновления приложения. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (Prefs.isPaired(ctx)) {
            try { LinkService.start(ctx) } catch (_: Exception) {}
        }
    }
}
