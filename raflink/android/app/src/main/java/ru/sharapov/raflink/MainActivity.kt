package ru.sharapov.raflink

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.ColorStateList
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.google.android.material.button.MaterialButton
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {

    private lateinit var statusDot: View
    private lateinit var statusText: TextView
    private lateinit var statusSub: TextView
    private lateinit var pinText: TextView
    private lateinit var logText: TextView
    private lateinit var btnFiles: MaterialButton
    private lateinit var btnNotif: MaterialButton
    private lateinit var btnBattery: MaterialButton
    private var photoUri: Uri? = null

    private val pickFiles = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty()) send(uris)
    }

    private val takePhoto = registerForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val u = photoUri
        if (ok && u != null) send(listOf(u))
    }

    private val askNotif = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        LinkService.start(this); refresh()
    }

    private val changed = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) = refresh()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        statusDot = findViewById(R.id.statusDot)
        statusText = findViewById(R.id.statusText)
        statusSub = findViewById(R.id.statusSub)
        pinText = findViewById(R.id.pinText)
        logText = findViewById(R.id.logText)
        btnFiles = findViewById(R.id.btnFiles)
        btnNotif = findViewById(R.id.btnNotif)
        btnBattery = findViewById(R.id.btnBattery)

        findViewById<MaterialButton>(R.id.btnNewPin).setOnClickListener { Prefs.newPin(this); refresh() }
        findViewById<MaterialButton>(R.id.btnSend).setOnClickListener {
            if (needPc()) pickFiles.launch(arrayOf("*/*"))
        }
        findViewById<MaterialButton>(R.id.btnPhoto).setOnClickListener { if (needPc()) photo() }
        btnFiles.setOnClickListener { open(Perms.allFilesIntent(this)) }
        btnNotif.setOnClickListener {
            if (Build.VERSION.SDK_INT >= 33) askNotif.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        btnBattery.setOnClickListener { open(Perms.batteryIntent(this)) }
        findViewById<MaterialButton>(R.id.btnAutostart).setOnClickListener {
            for (i in Perms.autostartIntents(this)) {
                try { startActivity(i); return@setOnClickListener } catch (_: Exception) {}
            }
        }

        if (!Perms.hasNotifications(this) && Build.VERSION.SDK_INT >= 33) {
            askNotif.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            LinkService.start(this)
        }
    }

    override fun onResume() {
        super.onResume()
        ContextCompat.registerReceiver(
            this, changed, IntentFilter(LinkService.ACTION_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED
        )
        if (!LinkService.running) LinkService.start(this)
        refresh()
    }

    override fun onPause() {
        unregisterReceiver(changed)
        super.onPause()
    }

    private fun open(i: Intent) {
        try { startActivity(i) } catch (_: Exception) { startActivity(Perms.appSettings(this)) }
    }

    private fun needPc(): Boolean {
        if (Prefs.isPaired(this)) return true
        Toast.makeText(this, "Сначала подключите ПК: введите код в программе на компьютере", Toast.LENGTH_LONG).show()
        return false
    }

    private fun photo() {
        val dir = File(cacheDir, "photos").apply { mkdirs() }
        dir.listFiles()?.forEach { if (System.currentTimeMillis() - it.lastModified() > 86_400_000) it.delete() }
        val name = "Фото_" + SimpleDateFormat("yyyy-MM-dd_HH-mm-ss", Locale.US).format(Date()) + ".jpg"
        val u = FileProvider.getUriForFile(this, "$packageName.files", File(dir, name))
        photoUri = u
        takePhoto.launch(u)
    }

    private fun send(uris: List<Uri>) {
        Toast.makeText(this, "Отправляю на ПК: ${uris.size} шт.…", Toast.LENGTH_SHORT).show()
        Sender.sendAll(this, uris) { r ->
            val msg = Sender.message(r)
            Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
            refresh()
        }
    }

    private fun color(id: Int) = ContextCompat.getColor(this, id)

    private fun refresh() {
        val ip = LinkService.localIp()
        val pc = Prefs.pcName(this)
        val recent = System.currentTimeMillis() - Prefs.lastSeen(this) < 15_000
        val (dot, title) = when {
            ip == null -> R.color.err to "Нет Wi-Fi"
            !LinkService.running -> R.color.err to "Связь выключена"
            pc != null && recent -> R.color.ok to "На связи с «$pc»"
            pc != null -> R.color.warn to "ПК «$pc» сейчас не на связи"
            else -> R.color.warn to "Ждёт подключения ПК"
        }
        statusDot.backgroundTintList = ColorStateList.valueOf(color(dot))
        statusText.text = title
        val queued = Outbox.count(this)
        statusSub.text = (if (ip != null) "Телефон в сети: $ip" else "Подключитесь к той же сети Wi-Fi, что и компьютер") +
            (if (queued > 0) "\nЖдут отправки на ПК: $queued" else "")
        pinText.text = Prefs.pin(this).chunked(3).joinToString(" ")

        fun mark(b: MaterialButton, ok: Boolean, text: String) {
            b.text = if (ok) "✓  $text" else "$text  →"
            b.setTextColor(color(if (ok) R.color.ok else R.color.text))
            b.isEnabled = !ok
        }
        mark(btnFiles, Perms.hasAllFiles(), "Доступ ко всем файлам")
        mark(btnNotif, Perms.hasNotifications(this), "Уведомления")
        mark(btnBattery, Perms.ignoresBattery(this), "Работа в фоне без ограничений")

        val ev = Prefs.events(this)
        logText.text = if (ev.isEmpty()) "Пока ничего не передавали" else ev.joinToString("\n")
        logText.setTextColor(color(if (ev.isEmpty()) R.color.text2 else R.color.text))
    }
}
