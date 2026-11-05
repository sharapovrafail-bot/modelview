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
    private lateinit var updBtn: TextView
    private lateinit var search: android.widget.EditText
    private var mode = ""
    private var myCodeView: TextView? = null          // "" — чаты, "search" — результаты поиска, "tasks" — все задания
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
        top.addView(TextView(this).apply {
            text = "✏️"; textSize = 22f; gravity = Gravity.CENTER; contentDescription = "Новый чат"
            setOnClickListener { newChat() }
        }, LinearLayout.LayoutParams(d(48f), d(48f)))
        top.addView(ImageView(this).apply {
            setImageResource(R.drawable.ic_gear); setPadding(d(10f), d(10f), d(10f), d(10f))
            setOnClickListener { startActivity(Intent(this@MainActivity, SetupActivity::class.java)) }
        }, LinearLayout.LayoutParams(d(48f), d(48f)))
        root.addView(top)
        root.addView(TextView(this).apply {
            text = "Вы: " + Prefs.name(this@MainActivity) + Prefs.dept(this@MainActivity).let { if (it.isNotEmpty()) " · $it" else "" }
            setTextColor(Ui.MUTED); textSize = 15f; setPadding(d(20f), 0, d(20f), 0)
        })
        root.addView(TextView(this).apply {
            text = "Мой код для внешних контактов: …"; setTextColor(Ui.ACCENT); textSize = 14f
            setPadding(d(20f), d(2f), d(20f), d(10f))
            setOnClickListener { showMyCode() }
            myCodeView = this
        })
        val sr = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(d(16f), 0, d(10f), d(8f))
        }
        search = android.widget.EditText(this).apply {
            hint = "🔍  Поиск по переписке"; textSize = 16f; isSingleLine = true
            background = getDrawable(R.drawable.bg_input); setPadding(d(14f), d(9f), d(14f), d(9f))
            addTextChangedListener(object : android.text.TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun afterTextChanged(s: android.text.Editable?) {
                    val n = s?.trim()?.length ?: 0
                    if (n >= 2) mode = "search" else if (mode == "search") mode = ""
                    refresh()
                }
            })
        }
        sr.addView(search, LinearLayout.LayoutParams(0, -2, 1f))
        sr.addView(TextView(this).apply {
            text = "📋"; textSize = 22f; gravity = Gravity.CENTER; contentDescription = "Все задания"
            setOnClickListener {
                mode = if (mode == "tasks") "" else "tasks"
                search.setText(""); refresh()
            }
        }, LinearLayout.LayoutParams(d(46f), d(46f)))
        root.addView(sr)
        val scroll = ScrollView(this)
        list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = Ui.roundBg(Ui.SURFACE, Ui.dp(this@MainActivity, 20f))
        }
        val wrap = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(d(16f), d(4f), d(16f), d(16f)) }
        updBtn = TextView(this).apply {
            textSize = 16f; setTypeface(typeface, Typeface.BOLD); setTextColor(0xFFFFFFFF.toInt()); gravity = Gravity.CENTER
            background = Ui.roundBg(Ui.ACCENT, Ui.dp(this@MainActivity, 14f)); setPadding(d(12f), d(13f), d(12f), d(13f))
            visibility = View.GONE
            setOnClickListener { Updater.install(this@MainActivity) { t -> text = t } }
        }
        wrap.addView(updBtn, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = d(12f) })
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
        val showUpd = {
            if (!Updater.busy) updBtn.text = "Обновить до версии ${Updater.newVer}"
            updBtn.visibility = View.VISIBLE
        }
        if (Updater.newVer != null) showUpd()
        Updater.check(this, showUpd)
    }

    override fun onPause() {
        if (::list.isInitialized) try { unregisterReceiver(changed) } catch (_: Exception) {}
        super.onPause()
    }

    /** Результаты поиска или список всех заданий вместо списка чатов. */
    private fun showResults() {
        val d = dp
        val tasks = mode == "tasks"
        var items = if (tasks) Node.db.tasks() else Node.db.search(search.text.toString().trim())
        if (tasks) {
            val order = mapOf(Node.TASK_REWORK to 0, Node.TASK_WORK to 1, Node.TASK_NEW to 2, Node.TASK_DONE to 3, Node.TASK_OK to 4)
            items = items.sortedWith(compareBy({ order[it.taskObj?.optString("status")] ?: 9 }, { -it.ts }))
        }
        status.text = if (tasks) "Все задания (нажмите 📋 ещё раз, чтобы вернуться к чатам)" else "Найдено: ${items.size}"
        if (items.isEmpty()) {
            list.addView(TextView(this).apply {
                text = if (tasks) "Заданий пока нет — создайте кнопкой 📋 в чате." else "Ничего не найдено."
                textSize = 16f; setTextColor(Ui.MUTED); setPadding(d(18f), d(18f), d(18f), d(18f))
            })
            return
        }
        val fmt = java.text.SimpleDateFormat("dd.MM HH:mm", java.util.Locale.US)
        items.forEachIndexed { i, m ->
            val chatTitle = if (m.chat == Node.ALL) "Общий чат" else Node.account(m.chat)?.name ?: Node.db.peer(m.chat)?.name ?: "?"
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL; setPadding(d(16f), d(10f), d(16f), d(10f))
                setBackgroundResource(android.R.drawable.list_selector_background)
                setOnClickListener {
                    startActivity(Intent(this@MainActivity, ChatActivity::class.java).putExtra("chat", m.chat).putExtra("focus", m.id))
                }
            }
            if (tasks) {
                val t = m.taskObj!!
                val st = t.optString("status").ifEmpty { Node.TASK_NEW }
                val l1 = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
                l1.addView(TextView(this).apply {
                    text = "📋 " + t.optString("title"); textSize = 16f; setTypeface(typeface, Typeface.BOLD); setTextColor(Ui.TEXT)
                    maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END
                }, LinearLayout.LayoutParams(0, -2, 1f))
                l1.addView(TextView(this).apply {
                    text = st; textSize = 12f; setTypeface(typeface, Typeface.BOLD); setTextColor(0xFFFFFFFF.toInt())
                    background = Ui.roundBg(Ui.TASK_COLORS[st] ?: Ui.MUTED, Ui.dp(this@MainActivity, 9f)); setPadding(d(8f), d(2f), d(8f), d(2f))
                })
                row.addView(l1)
                val due = t.optString("due").takeIf { it.isNotEmpty() && st != Node.TASK_DONE && st != Node.TASK_OK }
                row.addView(TextView(this).apply {
                    text = chatTitle + (due?.let { " · " + Ui.dueInfo(it).first } ?: "") + (t.optString("who").takeIf { it.isNotEmpty() }?.let { " · $it" } ?: "")
                    textSize = 14f; setTextColor(if (due != null && Ui.dueInfo(due).second) 0xFFFF3B30.toInt() else Ui.MUTED)
                })
            } else {
                row.addView(TextView(this).apply {
                    text = "$chatTitle · ${if (m.mine) "Вы" else m.senderName} · ${fmt.format(java.util.Date(m.ts))}"
                    textSize = 13f; setTextColor(Ui.MUTED)
                })
                row.addView(TextView(this).apply {
                    text = Ui.snippet(m, 90); textSize = 16f; setTextColor(Ui.TEXT); maxLines = 2
                    ellipsize = android.text.TextUtils.TruncateAt.END
                })
            }
            list.addView(row)
            if (i < items.size - 1) list.addView(View(this).apply { setBackgroundColor(Ui.LINE) },
                LinearLayout.LayoutParams(-1, 1).apply { marginStart = d(16f) })
        }
    }

    /** Долгое нажатие на чат: удалить (или очистить «Общий чат»). */
    private fun askDelete(key: String, title: String) {
        val all = key == Node.ALL
        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle(if (all) "Очистить «Общий чат»?" else "Удалить чат «$title»?")
            .setMessage(if (all) "История общего чата удалится на этом телефоне."
                else if (isExt(key)) "Внешний контакт и переписка с ним удалятся на этом телефоне."
                else "Переписка удалится на этом телефоне. Чат появится снова, если вам напишут.")
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
        if (mode.isNotEmpty()) { showResults(); return }
        myCodeView?.text = "Мой код для внешних контактов: ${fmtCode(Node.myCode)}"
        // как в WhatsApp: только чаты с перепиской (или открытые через «Новый чат»), свежие — выше
        val peers = Node.visibleChats().sortedWith(compareBy({ -(Node.db.last(it.id)?.ts ?: 0L) }, { it.name.lowercase() }))
        val rows = ArrayList<Triple<String, String, Boolean>>()
        rows.add(Triple(Node.ALL, "Общий чат", true))
        peers.forEach { rows.add(Triple(it.id, it.title + (if (it.ext) "  🌐" else ""), it.online)) }
        rows.forEachIndexed { i, (key, title, online) ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                setPadding(d(14f), d(10f), d(14f), d(10f))
                setBackgroundResource(android.R.drawable.list_selector_background)
                setOnClickListener { startActivity(Intent(this@MainActivity, ChatActivity::class.java).putExtra("chat", key)) }
            }
            row.setOnLongClickListener { askDelete(key, title); true }
            if (key == Node.ALL) row.background = GradientDrawableCompat.corp(this)
            row.addView(Ui.avatar(this, title, key, 48f, online && key != Node.ALL, key == Node.ALL,
                if (key == Node.ALL) null else Node.accountPhoto(key)))
            val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            val last = Node.db.last(key)
            val unread = Node.db.unread(key)
            val line1 = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            line1.addView(TextView(this).apply {
                text = title; textSize = 17f; setTypeface(typeface, Typeface.BOLD)
                setTextColor(if (key == Node.ALL) Ui.ORANGE_TEXT else Ui.TEXT)
                maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END
            }, LinearLayout.LayoutParams(0, -2, 1f))
            line1.addView(TextView(this).apply {
                text = last?.let { Ui.shortWhen(it.ts) } ?: ""; textSize = 13f; setTextColor(Ui.MUTED)
            })
            col.addView(line1)
            if (key == Node.ALL) col.addView(TextView(this).apply {
                text = "Корпоративный" + (if (Ui.COMPANY.isNotEmpty()) " · " + Ui.COMPANY else " чат организации")
                textSize = 13f; setTypeface(typeface, Typeface.BOLD); setTextColor(Ui.ORANGE_TEXT); maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.END
            })
            val line2 = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            val preview = if (last == null) {
                if (key == Node.ALL) "Сообщения для всех" else if (isExt(key)) "внешний контакт"
                else if (online) "в сети" else "не в сети"
            } else {
                val who = if (last.mine) "Вы: " else if (key == Node.ALL) "${last.senderName}: " else ""
                who + Ui.snippet(last)
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
        val q = Node.db.queued()
        val srv = when (Node.relayOk) { true -> "\nСервер: на связи ✓"; false -> "\nСервер: нет связи"; null -> "" }
        status.text = "Новый чат — кнопка ✏️ вверху" + (if (q > 0) " · в очереди: $q" else "") +
            "\nТелефон в сети: ${Node.localIp() ?: "нет Wi-Fi"}" + srv
    }

    private fun openChat(key: String) {
        Node.openChatWith(key)
        startActivity(Intent(this, ChatActivity::class.java).putExtra("chat", key))
    }

    /** «Новый чат»: сотрудник, внешний контакт или добавить внешний по коду. */
    private fun newChat() {
        if (!Node.running) return
        val keys = ArrayList<String>()
        val names = ArrayList<String>()
        keys.add("+"); names.add("➕  Добавить внешний контакт по коду")
        Node.accounts().sortedBy { it.name.lowercase() }.forEach { keys.add(it.id); names.add(it.title + if (it.online) "  ● в сети" else "") }
        val cs = Prefs.contacts(this)
        cs.keys().asSequence().toList().forEach { k ->
            keys.add("x$k"); names.add(cs.getJSONObject(k).optString("name").ifEmpty { fmtCode(k) } + "  🌐")
        }
        androidx.appcompat.app.AlertDialog.Builder(this).setTitle("Новый чат")
            .setItems(names.toTypedArray()) { _, i -> if (keys[i] == "+") addExternal() else openChat(keys[i]) }
            .setNegativeButton("Отмена", null).show()
    }

    private fun addExternal() {
        val d = dp
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(d(20f), d(8f), d(20f), 0) }
        box.addView(TextView(this).apply {
            text = "Попросите человека открыть RafChat и продиктовать «Мой код для внешних контактов» (под вашим именем на главном экране)."
            textSize = 14f; setTextColor(Ui.MUTED)
        })
        val code = android.widget.EditText(this).apply { hint = "Код: XXXX-XXXX-XXXX"; isSingleLine = true
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS }
        val name = android.widget.EditText(this).apply { hint = "Имя, например: Иванов, поставщик"; isSingleLine = true }
        box.addView(code); box.addView(name)
        val dlg = androidx.appcompat.app.AlertDialog.Builder(this).setTitle("Внешний контакт").setView(box)
            .setPositiveButton("Добавить", null).setNegativeButton("Отмена", null).show()
        dlg.getButton(androidx.appcompat.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener {
            val c = normCode(code.text.toString())
            when {
                c == Node.myCode -> code.error = "Это ваш собственный код"
                c.length != 12 -> code.error = "Код — 12 букв и цифр, например ABCD-EF23-4567"
                else -> { val k = Node.addContact(c, name.text.toString().trim()); dlg.dismiss(); if (k.isNotEmpty()) openChat(k) }
            }
        }
    }

    private fun showMyCode() {
        if (!Node.running) return
        val c = fmtCode(Node.myCode)
        androidx.appcompat.app.AlertDialog.Builder(this).setTitle("Мой код: $c")
            .setMessage("Это ваш личный код — как номер телефона. Передайте его человеку не из вашей организации " +
                "(заказчику, поставщику): он добавит вас в RafChat через ✏️ «Новый чат → Добавить внешний контакт», " +
                "и вы сможете переписываться и пересылать файлы. Переписка идёт через сервер и зашифрована. " +
                "Код один на все ваши устройства.")
            .setPositiveButton("Поделиться") { _, _ ->
                startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain")
                    .putExtra(Intent.EXTRA_TEXT, "Мой код в RafChat: $c"), "Поделиться кодом"))
            }
            .setNeutralButton("Копировать") { _, _ ->
                (getSystemService(CLIPBOARD_SERVICE) as android.content.ClipboardManager)
                    .setPrimaryClip(android.content.ClipData.newPlainText("RafChat", c))
            }
            .setNegativeButton("Закрыть", null).show()
    }
}

/** Оранжевая подложка строки «Общий чат». */
private object GradientDrawableCompat {
    fun corp(ctx: android.content.Context) = android.graphics.drawable.GradientDrawable().apply {
        setColor(0xFFFFF1E0.toInt()); setStroke(Ui.dpi(ctx, 1f), 0xFFFFD199.toInt()); cornerRadius = Ui.dp(ctx, 16f)
    }
}
