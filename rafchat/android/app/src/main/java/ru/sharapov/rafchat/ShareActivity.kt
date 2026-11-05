package ru.sharapov.rafchat

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import kotlin.concurrent.thread

/** «Поделиться → В RafChat»: выбрать чат и отправить файлы или текст. */
class ShareActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!Prefs.isSetUp(this) || !Node.running) {
            Toast.makeText(this, "Откройте RafChat и подождите, пока он подключится к сети", Toast.LENGTH_LONG).show()
            ChatService.start(this)
            finish(); return
        }
        val uris = collect(intent)
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)
        val peers = (Node.visibleChats() + Node.accounts()).distinctBy { it.id }
            .sortedWith(compareBy({ -(Node.db.last(it.id)?.ts ?: 0L) }, { it.name.lowercase() }))
        val keys = listOf(Node.ALL) + peers.map { it.id }
        val names = listOf("Общий чат") + peers.map { (if (it.online) "● " else "○ ") + it.title }
        AlertDialog.Builder(this)
            .setTitle("Кому отправить?")
            .setItems(names.toTypedArray()) { _, i ->
                val chat = keys[i]
                Node.openChatWith(chat)
                thread {
                    for (u in uris) Ui.importUri(this, u)?.let { (f, n) -> Node.send(chat, "", f, n) }
                    if (uris.isEmpty() && !text.isNullOrEmpty()) Node.send(chat, text)
                }
                Toast.makeText(this, "Отправлено в «${names[i].removePrefix("● ").removePrefix("○ ")}»", Toast.LENGTH_SHORT).show()
                finish()
            }
            .setOnCancelListener { finish() }
            .show()
    }

    @Suppress("DEPRECATION")
    private fun collect(i: Intent): List<Uri> = when (i.action) {
        Intent.ACTION_SEND -> listOfNotNull(
            if (Build.VERSION.SDK_INT >= 33) i.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
            else i.getParcelableExtra(Intent.EXTRA_STREAM)
        )
        Intent.ACTION_SEND_MULTIPLE ->
            (if (Build.VERSION.SDK_INT >= 33) i.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
            else i.getParcelableArrayListExtra(Intent.EXTRA_STREAM)) ?: emptyList()
        else -> emptyList()
    }
}
