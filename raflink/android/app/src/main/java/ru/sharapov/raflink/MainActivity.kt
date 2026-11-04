package ru.sharapov.raflink

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.ColorStateList
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {

    private lateinit var statusDot: View
    private lateinit var statusText: TextView
    private lateinit var statusSub: TextView
    private lateinit var pinCard: View
    private lateinit var pinText: TextView
    private lateinit var pinRowText: TextView
    private lateinit var events: LinearLayout
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
        pinCard = findViewById(R.id.pinCard)
        pinText = findViewById(R.id.pinText)
        pinRowText = findViewById(R.id.pinRowText)
        events = findViewById(R.id.events)

        findViewById<View>(R.id.btnSend).setOnClickListener { if (needPc()) pickFiles.launch(arrayOf("*/*")) }
        findViewById<View>(R.id.btnPhoto).setOnClickListener { if (needPc()) photo() }
        findViewById<View>(R.id.rowFiles).setOnClickListener { open(Perms.allFilesIntent(this)) }
        findViewById<View>(R.id.rowNotif).setOnClickListener {
            if (Build.VERSION.SDK_INT >= 33) askNotif.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        findViewById<View>(R.id.rowBattery).setOnClickListener { open(Perms.batteryIntent(this)) }
        findViewById<View>(R.id.rowAutostart).setOnClickListener {
            for (i in Perms.autostartIntents(this)) {
                try { startActivity(i); return@setOnClickListener } catch (_: Exception) {}
            }
        }
        findViewById<View>(R.id.rowPin).setOnClickListener { Prefs.newPin(this); refresh() }

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
            Toast.makeText(this, Sender.message(r), Toast.LENGTH_LONG).show()
            refresh()
        }
    }

    private fun color(id: Int) = ContextCompat.getColor(this, id)
    private fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, resources.displayMetrics)

    private fun refresh() {
        val ip = LinkService.localIp()
        val pc = Prefs.pcName(this)
        val recent = System.currentTimeMillis() - Prefs.lastSeen(this) < 15_000
        val (dot, title) = when {
            ip == null -> R.color.err to "Нет Wi-Fi"
            !LinkService.running -> R.color.err to "Связь выключена"
            pc != null && recent -> R.color.ok to "На связи с $pc"
            pc != null -> R.color.warn to "$pc не на связи"
            else -> R.color.warn to "Ждёт подключения ПК"
        }
        statusDot.backgroundTintList = ColorStateList.valueOf(color(dot))
        statusText.text = title
        val queued = Outbox.count(this)
        statusSub.text = (if (ip != null) "Wi-Fi · $ip" else "Подключитесь к той же сети, что и компьютер") +
            (if (queued > 0) "\nЖдут отправки на ПК: $queued" else "")
        val pin = Prefs.pin(this).chunked(3).joinToString(" ")
        pinText.text = pin
        pinCard.visibility = if (Prefs.isPaired(this)) View.GONE else View.VISIBLE
        pinRowText.text = "Код для другого ПК: $pin"

        fun state(id: Int, ok: Boolean) {
            val t = findViewById<TextView>(id)
            t.text = if (ok) "✓" else "Включить ›"
            t.setTextColor(color(if (ok) R.color.ok else R.color.accent))
            t.textSize = if (ok) 20f else 16f
        }
        state(R.id.stFiles, Perms.hasAllFiles())
        state(R.id.stNotif, Perms.hasNotifications(this))
        state(R.id.stBattery, Perms.ignoresBattery(this))

        fillEvents()
    }

    /** «Последние передачи» — как в макете: цветной значок, имя, направление, время. */
    private fun fillEvents() {
        events.removeAllViews()
        val list = Prefs.events(this).filter { it.kind != "info" }.take(8)
        if (list.isEmpty()) {
            events.addView(TextView(this).apply {
                text = "Пока ничего не передавали"
                setTextColor(color(R.color.text2))
                textSize = 16f
                setPadding(dp(18f).toInt(), dp(16f).toInt(), dp(18f).toInt(), dp(16f).toInt())
            })
            return
        }
        list.forEachIndexed { i, e ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(16f).toInt(), dp(12f).toInt(), dp(16f).toInt(), dp(12f).toInt())
            }
            row.addView(fileBadge(e.text), LinearLayout.LayoutParams(dp(42f).toInt(), dp(48f).toInt()))
            val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            col.addView(TextView(this).apply {
                text = e.text
                setTextColor(color(R.color.text))
                textSize = 17f
                setTypeface(typeface, Typeface.BOLD)
                maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.MIDDLE
            })
            col.addView(TextView(this).apply {
                text = if (e.kind == "out") "↑ Отправлено на ПК" else "↓ Получено с ПК"
                setTextColor(color(R.color.text2))
                textSize = 14f
            })
            row.addView(col, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = dp(14f).toInt(); marginEnd = dp(8f).toInt()
            })
            row.addView(TextView(this).apply {
                text = Prefs.timeText(e.time)
                setTextColor(color(R.color.text2))
                textSize = 14f
            })
            events.addView(row)
            if (i < list.size - 1) {
                events.addView(View(this).apply { setBackgroundColor(color(R.color.line)) },
                    LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(1f).toInt()).apply {
                        marginStart = dp(72f).toInt()
                    })
            }
        }
    }

    private fun fileBadge(name: String): TextView {
        val ext = name.substringAfterLast('.', "").lowercase()
        val c = when (ext) {
            "step", "stp", "igs", "iges", "f3d", "sldprt" -> 0xFFAF52DE
            "stl", "3mf", "obj" -> 0xFFFF9500
            "nc", "tap", "cnc", "ngc", "gcode", "mpf" -> 0xFF34C759
            "dxf", "dwg" -> 0xFF30B0C7
            "jpg", "jpeg", "png", "heic", "webp", "gif" -> 0xFF32ADE6
            "mp4", "mov", "3gp" -> 0xFFFF2D55
            "pdf" -> 0xFFFF3B30
            "zip", "rar", "7z" -> 0xFF8E8E93
            else -> 0xFF8E8E93
        }.toInt()
        return TextView(this).apply {
            text = if (ext.isEmpty()) "•" else ext.uppercase().take(4)
            setTextColor(0xFFFFFFFF.toInt())
            textSize = if (text.length > 3) 10f else 12f
            setTypeface(typeface, Typeface.BOLD)
            gravity = Gravity.CENTER
            background = GradientDrawable().apply { setColor(c); cornerRadius = dp(9f) }
        }
    }
}
