package ru.sharapov.rafchat

import android.content.ComponentName
import android.content.Intent
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity

/** Профиль: имя, отдел, код организации (одинаковый у всех), запасные адреса; настройка Xiaomi. */
class SetupActivity : AppCompatActivity() {
    private val d = { v: Float -> Ui.dpi(this, v) }
    private var avRedraw: (() -> Unit)? = null
    private val pickPhoto = registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri == null) return@registerForActivityResult
        kotlin.concurrent.thread {
            val jpg = Ui.jpeg(this, uri, 256, true)
            runOnUiThread {
                if (jpg == null) { android.widget.Toast.makeText(this, "Не удалось открыть фото", android.widget.Toast.LENGTH_SHORT).show(); return@runOnUiThread }
                if (Node.running) Node.setAvatar(jpg) else {
                    java.io.File(filesDir, "avatar.jpg").writeBytes(jpg)
                    Prefs.setAvh(this, java.security.MessageDigest.getInstance("MD5").digest(jpg).joinToString("") { "%02x".format(it) })
                }
                avRedraw?.invoke()
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val first = intent.getBooleanExtra("first", false)
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(d(20f), d(24f), d(20f), d(30f)) }
        col.addView(TextView(this).apply {
            text = if (first) "Добро пожаловать в RafChat" else "Профиль и сеть"
            textSize = 28f; setTypeface(typeface, Typeface.BOLD); setTextColor(Ui.TEXT)
        })
        col.addView(TextView(this).apply {
            text = "Чат и файлы по локальной сети организации — без сервера и интернета."
            textSize = 15f; setTextColor(Ui.MUTED); setPadding(0, d(4f), 0, d(14f))
        })
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; background = Ui.roundBg(Ui.SURFACE, Ui.dp(this@SetupActivity, 20f))
            setPadding(d(16f), d(14f), d(16f), d(16f))
        }
        fun field(label: String, value: String, hint: String): EditText {
            card.addView(TextView(this).apply { text = label; textSize = 13f; setTextColor(Ui.MUTED); setPadding(0, d(8f), 0, d(4f)) })
            val e = EditText(this).apply {
                setText(value); this.hint = hint; textSize = 17f; background = getDrawable(R.drawable.bg_input)
                setPadding(d(14f), d(10f), d(14f), d(10f)); inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS
            }
            card.addView(e)
            return e
        }
        // фото профиля: нажмите на кружок
        val avWrap = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, d(4f), 0, d(6f)) }
        fun drawAv() {
            avWrap.removeAllViews()
            val f = java.io.File(filesDir, "avatar.jpg")
            avWrap.addView(Ui.avatar(this, Prefs.name(this).ifEmpty { "?" }, Prefs.id(this), 64f, false, false, f.takeIf { it.isFile }))
            avWrap.addView(TextView(this).apply {
                text = if (f.isFile) "Сменить фото профиля" else "Поставить фото профиля"
                textSize = 17f; setTextColor(Ui.ACCENT); setPadding(d(14f), 0, 0, 0)
            })
        }
        avRedraw = ::drawAv
        drawAv()
        avWrap.setOnClickListener { pickPhoto.launch(androidx.activity.result.PickVisualMediaRequest(
            ActivityResultContracts.PickVisualMedia.ImageOnly)) }
        card.addView(avWrap)
        val name = field("Ваше имя (как вас увидят коллеги)", Prefs.name(this), "например: Иван Петров")
        val dept = field("Отдел или участок (необязательно)", Prefs.dept(this), "например: Цех ЧПУ")
        val org = field("Код организации — одинаковый у всех", Prefs.org(this), "узнайте у коллег")
        org.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
        val extra = field("Адреса ПК, если они не находятся сами", Prefs.extra(this), "например: 192.168.1.20, 192.168.1.21")
        extra.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
        val server = field("Сервер для работы через интернет (из дома, в дороге)", Prefs.server(this), "адрес:порт, например 203.0.113.5:47888")
        server.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
        card.addView(TextView(this).apply {
            text = "Одинаковый у всех. Переписка шифруется кодом организации — сервер её не видит."
            textSize = 13f; setTextColor(Ui.MUTED); setPadding(0, d(6f), 0, 0)
        })
        col.addView(card)
        val err = TextView(this).apply { setTextColor(0xFFFF3B30.toInt()); textSize = 15f; setPadding(d(4f), d(10f), 0, 0) }
        col.addView(err)
        col.addView(Button(this).apply {
            text = if (first) "Начать" else "Сохранить"; textSize = 17f; isAllCaps = false; setTextColor(0xFFFFFFFF.toInt())
            background = getDrawable(R.drawable.bg_primary)
            setOnClickListener {
                val n = name.text.toString().trim(); val o = org.text.toString().trim()
                when {
                    n.length < 2 -> err.text = "Укажите имя."
                    o.length < 4 -> err.text = "Код организации — не короче 4 символов."
                    else -> {
                        val orgChanged = o != Prefs.org(this@SetupActivity)
                        Prefs.save(this@SetupActivity, n.take(60), dept.text.toString().trim().take(40), o, extra.text.toString().trim())
                        Prefs.setServer(this@SetupActivity, server.text.toString().trim())
                        if (orgChanged || first) ChatService.restart(this@SetupActivity) else ChatService.start(this@SetupActivity)
                        if (first) startActivity(Intent(this@SetupActivity, MainActivity::class.java))
                        finish()
                    }
                }
            }
        }, LinearLayout.LayoutParams(-1, d(56f)).apply { topMargin = d(14f) })

        col.addView(TextView(this).apply {
            text = "Чтобы сообщения приходили, когда телефон в кармане (Xiaomi):"
            textSize = 15f; setTextColor(Ui.MUTED); setPadding(d(4f), d(26f), 0, d(6f))
        })
        fun link(t: String, vararg intents: Intent) = col.addView(TextView(this).apply {
            text = "$t  ›"; textSize = 17f; setTextColor(Ui.ACCENT); setPadding(d(4f), d(10f), 0, d(10f))
            setOnClickListener {
                for (i in intents) try { startActivity(i); return@setOnClickListener } catch (_: Exception) {}
            }
        })
        val appSettings = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))
        link("Уведомления: включите «Всплывающие» и «На экране блокировки»",
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName), appSettings)
        link("Работа в фоне без ограничений",
            Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")), appSettings)
        link("Автозапуск",
            Intent().setComponent(ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")),
            appSettings)
        col.addView(TextView(this).apply {
            text = "RafChat · Автор: Рафаил Шарапов · rafail@sharapov-cnc.ru"
            textSize = 13f; setTextColor(Ui.MUTED); gravity = Gravity.CENTER; setPadding(0, d(26f), 0, 0)
        })
        setContentView(ScrollView(this).apply { setBackgroundColor(0xFFF2F2F7.toInt()); addView(col) })
    }
}
