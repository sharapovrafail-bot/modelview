package ru.sharapov.raflink

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.core.content.FileProvider
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** «Поделиться → На ПК (RafLink)» из галереи, Telegram, почты и т.д. */
class ShareActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!Prefs.isPaired(this)) {
            Toast.makeText(this, "Сначала подключите ПК в приложении RafLink", Toast.LENGTH_LONG).show()
            startActivity(Intent(this, MainActivity::class.java))
            finish(); return
        }
        val uris = collect(intent)
        if (uris.isEmpty()) {
            Toast.makeText(this, "Нечего отправлять", Toast.LENGTH_SHORT).show()
            finish(); return
        }
        Toast.makeText(this, "Отправляю на ПК: ${uris.size} шт.…", Toast.LENGTH_SHORT).show()
        Sender.sendAll(this, uris) { r ->
            val msg = Sender.message(r)
            Toast.makeText(applicationContext, msg, Toast.LENGTH_LONG).show()
            finish()
        }
    }

    @Suppress("DEPRECATION")
    private fun collect(i: Intent): List<Uri> {
        val list = ArrayList<Uri>()
        when (i.action) {
            Intent.ACTION_SEND -> {
                val u: Uri? = if (Build.VERSION.SDK_INT >= 33)
                    i.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                else i.getParcelableExtra(Intent.EXTRA_STREAM)
                if (u != null) list.add(u)
                else i.getStringExtra(Intent.EXTRA_TEXT)?.let { list.add(textFile(it)) }
            }
            Intent.ACTION_SEND_MULTIPLE -> {
                val l: List<Uri>? = if (Build.VERSION.SDK_INT >= 33)
                    i.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
                else i.getParcelableArrayListExtra(Intent.EXTRA_STREAM)
                l?.let { list.addAll(it) }
            }
        }
        return list
    }

    /** Текст или ссылку отправляем на ПК файлом .txt */
    private fun textFile(text: String): Uri {
        val dir = File(cacheDir, "share").apply { mkdirs() }
        val name = "Текст_" + SimpleDateFormat("yyyy-MM-dd_HH-mm-ss", Locale.US).format(Date()) + ".txt"
        val f = File(dir, name)
        f.writeText(text)
        return FileProvider.getUriForFile(this, "$packageName.files", f)
    }
}
