package ru.sharapov.rafchat

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

/** Список чатов: «Общий чат» и коллеги (в сети — сверху). */
class MainActivity : AppCompatActivity() {
    private lateinit var list: LinearLayout
    private lateinit var status: TextView
    private val dp get() = { v: Float -> Ui.dpi(this, v) }

    private val askNotif = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}
    private val changed = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) = refresh()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!Prefs.isSetUp(this)) {
            startActivity(Intent(this, SetupActivity::class.java).putExtra("first", true))
            finish(); return
        }
        val d = dp
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(0xFFF2F2F7.toInt()) }
        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(d(20f), d(18f), d(12f), d(4f))
        }
        top.addView(TextView(this).apply {
            text = "Чаты"; textSize = 34f; setTypeface(typeface, Typeface.BOLD); setTextColor(Ui.TEXT)
        }, LinearLayout.LayoutParams(0, -2, 1f))
        top.addView(ImageView(this).apply {
            setImageResource(R.drawable.ic_gear); setPadding(d(10f), d(10f), d(10f), d(10f))
            setOnClickListener { startActivity(Intent(this@MainActivity, SetupActivity::class.java)) }
        }, LinearLayout.LayoutParams(d(48f), d(48f)))
        root.addView(top)
        root.addView(TextView(this).apply {
            text = "Вы: " + Prefs.name(this@MainActivity) + Prefs.dept(this@MainActivity).let { if (it.isNotEmpty()) " · $it" else "" }
            setTextColor(Ui.MUTED); textSize = 15f; setPadding(d(20f), 0, d(20f), d(10f))
        })
        val scroll = ScrollView(this)
        list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = Ui.roundBg(Ui.SURFACE, Ui.dp(this@MainActivity, 20f))
        }
        val wrap = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(d(16f), d(4f), d(16f), d(16f)) }
        wrap.addView(list)
        status = TextView(this).apply { setTextColor(Ui.MUTED); textSize = 14f; setPadding(d(8f), d(14f), d(8f), 0) }
        wrap.addView(status)
        wrap.addView(TextView(this).apply {
            text = "RafChat ${packageManager.getPackageInfo(packageName, 0).versionName} · Автор: Рафаил Шарапов\nrafail@sharapov-cnc.ru"
            setTextColor(Ui.MUTED); textSize = 13f; gravity = Gravity.CENTER; setPadding(0, d(26f), 0, 0)
        })
        scroll.addView(wrap)
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) askNotif.launch(Manifest.permission.POST_NOTIFICATIONS)
        ChatService.start(this)
    }

    override fun onResume() {
        super.onResume()
        if (!::list.isInitialized) return
        ContextCompat.registerReceiver(this, changed, IntentFilter(Node.ACTION_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED)
        refresh()
    }

    override fun onPause() {
        if (::list.isInitialized) try { unregisterReceiver(changed) } catch (_: Exception) {}
        super.onPause()
    }

    /** Долгое нажатие на чат: удалить (или очистить «Общий чат»). */
    private fun askDelete(key: String, title: String) {
        val all = key == Node.ALL
        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle(if (all) "Очистить «Общий чат»?" else "Удалить чат «$title»?")
            .setMessage(if (all) "История общего чата удалится на этом телефоне."
                else "Переписка удалится на этом телефоне. Если человек снова появится в сети, чат вернётся.")
            .setPositiveButton(if (all) "Очистить" else "Удалить") { _, _ -> if (Node.running) Node.deleteChat(key); refresh() }
            .setNegativeButton("Отмена", null)
            .show()
    }

    private fun refresh() {
        if (!Node.running || !::list.isInitialized) {
            if (::status.isInitialized) status.text = "Подключаюсь к сети…"
            return
        }
        val d = dp
        list.removeAllViews()
        val peers = Node.db.peers().sortedWith(compareBy({ !it.online }, { it.name.lowercase() }))
        val rows = ArrayList<Triple<String, String, Boolean>>()
        rows.add(Triple(Node.ALL, "Общий чат", true))
        peers.forEach { rows.add(Triple(it.id, it.title, it.online)) }
        rows.forEachIndexed { i, (key, title, online) ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                setPadding(d(14f), d(10f), d(14f), d(10f))
                setBackgroundResource(android.R.drawable.list_selector_background)
                setOnClickListener { startActivity(Intent(this@MainActivity, ChatActivity::class.java).putExtra("chat", key)) }
            }
            row.setOnLongClickListener { askDelete(key, title); true }
            row.addView(Ui.avatar(this, title, key, 48f, online && key != Node.ALL, key == Node.ALL,
                if (key == Node.ALL) null else Node.avatarFile(key)))
            val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            val last = Node.db.last(key)
            val unread = Node.db.unread(key)
            val line1 = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            line1.addView(TextView(this).apply {
                text = title; textSize = 17f; setTypeface(typeface, Typeface.BOLD); setTextColor(Ui.TEXT)
                maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END
            }, LinearLayout.LayoutParams(0, -2, 1f))
            line1.addView(TextView(this).apply {
                text = last?.let { Ui.shortWhen(it.ts) } ?: ""; textSize = 13f; setTextColor(Ui.MUTED)
            })
            col.addView(line1)
            val line2 = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            val preview = if (last == null) {
                if (key == Node.ALL) "Сообщения для всех" else if (online) "в сети" else "не в сети"
            } else {
                val who = if (last.mine) "Вы: " else if (key == Node.ALL) "${last.senderName}: " else ""
                who + (if (last.file != null && last.text.isEmpty()) "📎 ${last.file.name}" else last.text)
            }
            line2.addView(TextView(this).apply {
                text = preview; textSize = 15f; setTextColor(Ui.MUTED); maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.END
            }, LinearLayout.LayoutParams(0, -2, 1f))
            if (unread > 0) line2.addView(TextView(this).apply {
                text = unread.toString(); setTextColor(0xFFFFFFFF.toInt()); textSize = 13f
                setTypeface(typeface, Typeface.BOLD); gravity = Gravity.CENTER
                setPadding(d(7f), d(1f), d(7f), d(1f)); minWidth = d(22f)
                background = Ui.roundBg(Ui.ACCENT, Ui.dp(this@MainActivity, 11f))
            })
            col.addView(line2)
            row.addView(col, LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = d(12f) })
            list.addView(row)
            if (i < rows.size - 1) list.addView(View(this).apply { setBackgroundColor(Ui.LINE) },
                LinearLayout.LayoutParams(-1, 1).apply { marginStart = d(74f) })
        }
        val on = peers.count { it.online }
        val q = Node.db.queued()
        val srv = when (Node.relayOk) { true -> "\nСервер: на связи ✓"; false -> "\nСервер: нет связи"; null -> "" }
        status.text = "В сети: $on из ${peers.size}" + (if (q > 0) " · в очереди: $q" else "") +
            "\nТелефон в сети: ${Node.localIp() ?: "нет Wi-Fi"}" + srv
    }
}
