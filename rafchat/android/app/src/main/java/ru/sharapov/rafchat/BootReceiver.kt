package ru.sharapov.rafchat

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        try { ChatService.start(ctx) } catch (_: Exception) {}
    }
}
