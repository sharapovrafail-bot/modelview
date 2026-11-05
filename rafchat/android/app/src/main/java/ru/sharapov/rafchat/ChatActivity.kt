package ru.sharapov.rafchat

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import kotlin.concurrent.thread

/** Переписка: облачка (мои — синие справа), файлы, поле ввода. */
class ChatActivity : AppCompatActivity() {
    private lateinit var chat: String
    private lateinit var msgs: LinearLayout
    private lateinit var scroll: ScrollView
    private lateinit var title: TextView
    private lateinit var sub: TextView
    private lateinit var input: EditText
    private var shown = -1
    private var shownSig = ""
    private var replyTo: org.json.JSONObject? = null
    private lateinit var replyBar: LinearLayout
    private lateinit var replyName: TextView
    private lateinit var replyText: TextView
    private val views = HashMap<String, View>()
    private var focusId: String? = null
    private val d = { v: Float -> Ui.dpi(this, v) }

    private val pick = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isEmpty()) return@registerForActivityResult
        collect?.let { list ->                           // файлы для нового задания — пока только собираем
            thread {
                for (u in uris) Ui.importUri(this, u)?.let { list.add(it) }
                runOnUiThread { onCollected?.invoke() }
            }
            return@registerForActivityResult
        }
        Toast.makeText(this, "Отправляю файлов: ${uris.size}", Toast.LENGTH_SHORT).show()
        var rp = pendingReply ?: takeReply()
        pendingReply = null
        thread {
            for (u in uris) Ui.importUri(this, u)?.let { (f, name) -> Node.send(chat, "", f, name, rp); rp = null }
        }
    }

    /** Файлы к заданию: collect — собираем для нового задания; pendingReply — отправить ответом на карточку. */
    private var collect: MutableList<Pair<java.io.File, String>>? = null
    private var onCollected: (() -> Unit)? = null
    private var pendingReply: org.json.JSONObject? = null

    /** Камера: снимок → сжать (как в WhatsApp) → сразу в чат. */
    private var shot: java.io.File? = null
    private val camera = registerForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val f = shot ?: return@registerForActivityResult
        if (!ok || !f.isFile || f.length() == 0L) { f.delete(); return@registerForActivityResult }
        thread {
            val name = "Фото_" + java.text.SimpleDateFormat("yyyyMMdd_HHmmss", java.util.Locale.US).format(java.util.Date()) + ".jpg"
            val dir = java.io.File(filesDir, "sent").apply { mkdirs() }
            val out = java.io.File(dir, java.util.UUID.randomUUID().toString().take(8) + "_" + name)
            val jpg = Ui.jpeg(this, android.net.Uri.fromFile(f), 2048, false)
            if (jpg != null) out.writeBytes(jpg) else f.copyTo(out, true)
            f.delete()
            val list = collect
            if (list != null) { list.add(out to name); runOnUiThread { onCollected?.invoke() } }
            else { val rp = pendingReply; pendingReply = null; Node.send(chat, "", out, name, rp) }
        }
    }

    // ---------- голосовые
    private lateinit var micBtn: TextView
    private val askMic = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) toggleVoice() else Toast.makeText(this, "Без доступа к микрофону голосовые не записать", Toast.LENGTH_LONG).show()
    }
    private val recTick = object : Runnable {
        override fun run() {
            if (!Voice.isRecording) return
            input.hint = "🔴 Запись ${fmtSecs(Voice.seconds)} — нажмите ⏹, чтобы отправить"
            input.postDelayed(this, 500)
        }
    }

    private fun toggleVoice() {
        if (!Voice.isRecording) {
            if (androidx.core.content.ContextCompat.checkSelfPermission(this, android.Manifest.permission.RECORD_AUDIO) !=
                android.content.pm.PackageManager.PERMISSION_GRANTED) { askMic.launch(android.Manifest.permission.RECORD_AUDIO); return }
            if (!Voice.start(this)) { Toast.makeText(this, "Не удалось включить микрофон", Toast.LENGTH_SHORT).show(); return }
            micBtn.text = "⏹"; micBtn.background = Ui.roundBg(0xFFFF3B30.toInt(), Ui.dp(this, 20f))
            input.isEnabled = false
            recTick.run()
            return
        }
        micBtn.text = "🎤"; micBtn.background = null
        input.isEnabled = true; input.hint = "Сообщение"
        val rp = takeReply()
        val to = chat
        Thread { Voice.stop(true)?.let { (f, secs) -> Node.send(to, "", f, f.name, rp, voice = secs) } }.start()
    }


    private fun takePhoto() {
        if (!Node.running) { Toast.makeText(this, "RafChat ещё не в сети", Toast.LENGTH_SHORT).show(); return }
        val dir = java.io.File(cacheDir, "camera").apply { mkdirs() }
        val f = java.io.File(dir, "shot_${System.currentTimeMillis()}.jpg")
        shot = f
        try {
            camera.launch(androidx.core.content.FileProvider.getUriForFile(this, "$packageName.files", f))
        } catch (e: Exception) {
            Toast.makeText(this, "Не удалось открыть камеру", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onSaveInstanceState(out: Bundle) {
        super.onSaveInstanceState(out)
        shot?.let { out.putString("shot", it.path) }
    }

    private val changed = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) = refresh()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        Ui.applyTheme(this)
        super.onCreate(savedInstanceState)
        chat = intent.getStringExtra("chat") ?: Node.ALL
        focusId = intent.getStringExtra("focus")
        savedInstanceState?.getString("shot")?.let { shot = java.io.File(it) }
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Ui.BG) }
        val head = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Ui.SURFACE); setPadding(d(4f), d(8f), d(16f), d(8f))
        }
        head.addView(ImageView(this).apply {
            setImageResource(R.drawable.ic_back); setPadding(d(12f), d(12f), d(12f), d(12f)); setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(d(48f), d(48f)))
        val peer = if (chat == Node.ALL) null else Node.account(chat)
        head.addView(Ui.avatar(this, peer?.name ?: "", chat, 40f, false, chat == Node.ALL,
            if (chat == Node.ALL) null else Node.accountPhoto(chat)))
        val hc = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(d(12f), 0, 0, 0) }
        title = TextView(this).apply { textSize = 17f; setTypeface(typeface, Typeface.BOLD); setTextColor(Ui.TEXT); maxLines = 1 }
        sub = TextView(this).apply { textSize = 13f; setTextColor(Ui.MUTED); maxLines = 1 }
        hc.addView(title); hc.addView(sub)
        head.addView(hc, LinearLayout.LayoutParams(0, -2, 1f))
        root.addView(head)
        root.addView(View(this).apply { setBackgroundColor(Ui.LINE) }, LinearLayout.LayoutParams(-1, 1))
        scroll = ScrollView(this).apply {
            descendantFocusability = android.view.ViewGroup.FOCUS_BLOCK_DESCENDANTS
            background = Ui.chatBackground(this@ChatActivity, chat == Node.ALL)
        }
        msgs = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(d(12f), d(8f), d(12f), d(8f)) }
        scroll.addView(msgs)
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        root.addView(View(this).apply { setBackgroundColor(Ui.LINE) }, LinearLayout.LayoutParams(-1, 1))
        // полоска «ответ на сообщение»
        replyBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Ui.SURFACE); setPadding(d(14f), d(8f), d(6f), 0); visibility = View.GONE
        }
        val rq = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(d(10f), d(4f), d(10f), d(4f))
            background = android.graphics.drawable.LayerDrawable(arrayOf(
                Ui.roundBg(Ui.QUOTE, Ui.dp(this@ChatActivity, 6f)),
                android.graphics.drawable.ColorDrawable(Ui.ACCENT))).apply { setLayerWidth(1, d(3f)); setLayerGravity(1, Gravity.START or Gravity.FILL_VERTICAL) }
        }
        replyName = TextView(this).apply { textSize = 13f; setTypeface(typeface, Typeface.BOLD); setTextColor(Ui.ACCENT) }
        replyText = TextView(this).apply { textSize = 14f; setTextColor(Ui.MUTED); maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END }
        rq.addView(replyName); rq.addView(replyText)
        replyBar.addView(rq, LinearLayout.LayoutParams(0, -2, 1f))
        replyBar.addView(TextView(this).apply {
            text = "✕"; textSize = 20f; setTextColor(Ui.MUTED); gravity = Gravity.CENTER
            setOnClickListener { cancelReply() }
        }, LinearLayout.LayoutParams(d(44f), d(40f)))
        root.addView(replyBar)
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.BOTTOM
            setBackgroundColor(Ui.SURFACE); setPadding(d(6f), d(8f), d(10f), d(10f))
        }
        bar.addView(ImageView(this).apply {
            setImageResource(R.drawable.ic_attach); setPadding(d(10f), d(10f), d(10f), d(10f))
            setOnClickListener { pick.launch(arrayOf("*/*")) }
        }, LinearLayout.LayoutParams(d(46f), d(46f)))
        bar.addView(TextView(this).apply {
            text = "🙂"; textSize = 23f; gravity = Gravity.CENTER
            setOnClickListener {
                Ui.emojiDialog(this@ChatActivity) { e ->
                    val s = maxOf(input.selectionStart, 0); val en = maxOf(input.selectionEnd, 0)
                    input.text.replace(minOf(s, en), maxOf(s, en), e)
                }
            }
        }, LinearLayout.LayoutParams(d(42f), d(46f)))
        bar.addView(TextView(this).apply {
            text = "📋"; textSize = 21f; gravity = Gravity.CENTER
            contentDescription = "Новое задание"
            setOnClickListener { taskDialog() }
        }, LinearLayout.LayoutParams(d(40f), d(46f)))
        input = EditText(this).apply {
            hint = "Сообщение"; textSize = 16f; background = getDrawable(R.drawable.bg_input)
            setPadding(d(14f), d(10f), d(14f), d(10f)); maxLines = 6
            imeOptions = EditorInfo.IME_FLAG_NO_ENTER_ACTION
            addTextChangedListener(object : android.text.TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun afterTextChanged(s: android.text.Editable?) {
                    if (!s.isNullOrBlank() && Node.running) Node.sendTyping(chat)
                }
            })
        }
        bar.addView(input, LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = d(2f); marginEnd = d(4f) })
        micBtn = TextView(this).apply {
            text = "🎤"; textSize = 20f; gravity = Gravity.CENTER; contentDescription = "Голосовое сообщение"
            setOnClickListener { toggleVoice() }
        }
        bar.addView(micBtn, LinearLayout.LayoutParams(d(40f), d(40f)).apply { marginEnd = d(2f) })
        bar.addView(ImageView(this).apply {
            setImageResource(R.drawable.ic_camera); setPadding(d(9f), d(9f), d(9f), d(9f))
            contentDescription = "Сфотографировать и отправить"
            setOnClickListener { takePhoto() }
        }, LinearLayout.LayoutParams(d(44f), d(46f)).apply { marginEnd = d(4f) })
        bar.addView(ImageView(this).apply {
            setImageResource(R.drawable.ic_send); setBackgroundResource(R.drawable.bg_round_accent)
            setPadding(d(9f), d(9f), d(9f), d(9f)); setOnClickListener { sendText() }
        }, LinearLayout.LayoutParams(d(42f), d(42f)))
        root.addView(bar)
        setContentView(root)
        intent.getStringExtra("text")?.let { input.setText(it) }
    }

    override fun onResume() {
        super.onResume()
        Node.visibleChat = chat
        Notify.cancel(this, chat)
        ContextCompat.registerReceiver(this, changed, IntentFilter(Node.ACTION_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED)
        refresh()
    }

    override fun onPause() {
        if (Voice.isRecording) {
            Thread { Voice.stop(false) }.start()
            micBtn.text = "🎤"; micBtn.background = null; input.isEnabled = true; input.hint = "Сообщение"
        }
        Voice.stopPlay()
        Node.visibleChat = null
        try { unregisterReceiver(changed) } catch (_: Exception) {}
        super.onPause()
    }

    private fun sendText() {
        val t = input.text.toString().trim()
        if (t.isEmpty()) return
        if (!Node.running) { Toast.makeText(this, "RafChat ещё не в сети", Toast.LENGTH_SHORT).show(); return }
        input.setText("")
        val rp = takeReply()
        thread { Node.send(chat, t, reply = rp) }
    }

    // ---------- ответ на сообщение
    private fun startReply(m: Msg) {
        replyTo = org.json.JSONObject().put("id", m.id).put("name", m.senderName).put("text", Ui.snippet(m))
        replyName.text = "Ответ: " + replyTo!!.optString("name")
        replyText.text = replyTo!!.optString("text")
        replyBar.visibility = View.VISIBLE
        input.requestFocus()
        (getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager)
            .showSoftInput(input, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT)
    }

    private fun cancelReply() { replyTo = null; replyBar.visibility = View.GONE }

    private fun takeReply(): org.json.JSONObject? = replyTo.also { cancelReply() }

    private fun msgMenu(m: Msg) {
        val items = arrayListOf("Ответить", "Переслать")
        if (m.text.isNotEmpty() && m.task == null) items.add("Копировать текст")
        androidx.appcompat.app.AlertDialog.Builder(this).setItems(items.toTypedArray()) { _, i ->
            when (items[i]) {
                "Ответить" -> startReply(m)
                "Переслать" -> forward(m)
                else -> {
                    (getSystemService(CLIPBOARD_SERVICE) as android.content.ClipboardManager)
                        .setPrimaryClip(android.content.ClipData.newPlainText("RafChat", m.text))
                    Toast.makeText(this, "Скопировано", Toast.LENGTH_SHORT).show()
                }
            }
        }.show()
    }

    /** Переслать сообщение (текст, файл, задание) в другой чат. */
    private fun forward(m: Msg) {
        if (m.file != null && m.local == null) {
            Toast.makeText(this, "Сначала скачайте файл — потом его можно переслать", Toast.LENGTH_LONG).show(); return
        }
        val keys = if (Node.joined()) arrayListOf(Node.ALL) else arrayListOf()
        val names = if (Node.joined()) arrayListOf("Общий чат") else arrayListOf()
        for (a in (Node.visibleChats() + Node.accounts().sortedBy { it.name.lowercase() }).distinctBy { it.id }) {
            if (a.id == chat) continue
            keys.add(a.id); names.add(a.title + if (a.ext) "  🌐" else "")
        }
        androidx.appcompat.app.AlertDialog.Builder(this).setTitle("Переслать").setItems(names.toTypedArray()) { _, i ->
            val to = keys[i]
            val who = m.fwd ?: if (m.mine) Prefs.name(this) else m.senderName
            val task = m.taskObj?.put("status", Node.TASK_NEW)
            Thread {
                var file: java.io.File? = null
                var fname: String? = null
                if (m.file != null && m.local != null) {
                    val loc = m.local
                    if (loc.startsWith("content:")) Ui.importUri(this, android.net.Uri.parse(loc))?.let { (f, n) -> file = f; fname = n }
                    else { file = java.io.File(loc); fname = m.file.name }
                }
                Node.openChatWith(to)
                Node.send(to, m.text, file, fname, null, task, who)
                runOnUiThread {
                    startActivity(Intent(this, ChatActivity::class.java).putExtra("chat", to)); finish()
                }
            }.start()
        }.setNegativeButton("Отмена", null).show()
    }

    private fun jumpTo(mid: String) {
        val v = views[mid] ?: return
        scroll.post {
            scroll.smoothScrollTo(0, maxOf(0, v.top - d(80f)))
            v.setBackgroundColor(0x55FFCC00)
            v.postDelayed({ v.setBackgroundColor(0) }, 1500)
        }
    }

    // ---------- задание
    private fun taskDialog() {
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(d(20f), d(6f), d(20f), 0) }
        fun field(label: String, hint: String, num: Boolean = false, list: List<String>? = null): EditText {
            col.addView(TextView(this).apply { text = label; textSize = 13f; setTextColor(Ui.MUTED); setPadding(0, d(8f), 0, d(2f)) })
            val e: EditText = if (list != null) android.widget.AutoCompleteTextView(this).apply {
                setAdapter(android.widget.ArrayAdapter(this@ChatActivity, android.R.layout.simple_dropdown_item_1line, list))
                threshold = 0
                setOnFocusChangeListener { v, f -> if (f) (v as android.widget.AutoCompleteTextView).showDropDown() }
            } else EditText(this)
            e.hint = hint; e.textSize = 16f
            if (num) e.inputType = android.text.InputType.TYPE_CLASS_NUMBER
            col.addView(e)
            return e
        }
        val title = field("Деталь / что сделать *", "например: Вал Ø32 h6")
        val drawing = field("Чертёж / номер программы", "например: ВЛ-032.01, O1025")
        val material = field("Материал", "40Х, 45, Д16Т…", list = listOf("40Х", "45", "45Х", "Ст3", "12Х18Н10Т", "20Х13", "Д16Т", "АМг6", "Латунь ЛС59"))
        val qty = field("Количество, шт", "1", num = true).apply { setText("1") }
        col.addView(TextView(this).apply { text = "Срок"; textSize = 13f; setTextColor(Ui.MUTED); setPadding(0, d(8f), 0, d(2f)) })
        val cal = java.util.Calendar.getInstance().apply { add(java.util.Calendar.DAY_OF_MONTH, 3) }
        val fmt = java.text.SimpleDateFormat("dd.MM.yyyy", java.util.Locale.US)
        var due: String? = fmt.format(cal.time)
        val dueBtn = TextView(this).apply {
            text = "до $due  ›"; textSize = 16f; setTextColor(Ui.ACCENT); setPadding(0, d(6f), 0, d(6f))
        }
        dueBtn.setOnClickListener {
            val dlg = android.app.DatePickerDialog(this, { _, y, mo, dd ->
                cal.set(y, mo, dd); due = fmt.format(cal.time); dueBtn.text = "до $due  ›"
            }, cal.get(java.util.Calendar.YEAR), cal.get(java.util.Calendar.MONTH), cal.get(java.util.Calendar.DAY_OF_MONTH))
            dlg.setButton(android.content.DialogInterface.BUTTON_NEUTRAL, "Без срока") { _, _ -> due = null; dueBtn.text = "без срока  ›" }
            dlg.show()
        }
        col.addView(dueBtn)
        val who = field("Исполнитель", "кто делает", list = Node.accounts().map { it.name }.distinct().sorted())
        val note = field("Примечание", "допуски, квалитет, шероховатость…")
        val files = ArrayList<Pair<java.io.File, String>>()
        collect = files
        val filesLbl = TextView(this).apply {
            text = "Модель, УП, чертёж, фото — уйдут вместе с заданием"; textSize = 13f; setTextColor(Ui.MUTED)
            setPadding(0, d(6f), 0, 0)
        }
        onCollected = {
            filesLbl.text = "Прикреплено: " + files.joinToString(", ") { it.second }.let { if (it.length > 120) it.take(119) + "…" else it }
            filesLbl.setTextColor(Ui.TEXT)
        }
        val ab = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, d(12f), 0, 0) }
        fun abtn(t: String, fn: () -> Unit) = ab.addView(TextView(this).apply {
            text = t; textSize = 15f; setTypeface(typeface, Typeface.BOLD); setTextColor(Ui.ACCENT); gravity = Gravity.CENTER
            background = Ui.roundBg(Ui.WASH, Ui.dp(this@ChatActivity, 10f)); setPadding(d(12f), d(9f), d(12f), d(9f))
            setOnClickListener { fn() }
        }, LinearLayout.LayoutParams(-2, -2).apply { marginEnd = d(8f) })
        abtn("📎 Файлы") { pick.launch(arrayOf("*/*")) }
        abtn("📷 Фото чертежа") { takePhoto() }
        col.addView(ab)
        col.addView(filesLbl)
        val dlg = androidx.appcompat.app.AlertDialog.Builder(this).setTitle("📋 Новое задание")
            .setView(ScrollView(this).apply { addView(col) })
            .setPositiveButton("Отправить", null).setNegativeButton("Отмена", null).create()
        dlg.setOnDismissListener { collect = null; onCollected = null }
        dlg.setOnShowListener {
            dlg.getButton(androidx.appcompat.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val tt = title.text.toString().trim()
                if (tt.length < 2) { title.error = "Укажите деталь"; return@setOnClickListener }
                val t = org.json.JSONObject().put("title", tt.take(120))
                fun opt(k: String, v: String) { if (v.isNotBlank()) t.put(k, v.trim()) }
                opt("drawing", drawing.text.toString().take(80)); opt("material", material.text.toString().take(40))
                qty.text.toString().toIntOrNull()?.takeIf { it > 0 }?.let { t.put("qty", it) }
                due?.let { t.put("due", it) }
                opt("who", who.text.toString().take(60)); opt("note", note.text.toString().take(600))
                val rp = takeReply()
                val att = ArrayList(files)
                thread {
                    val tid = Node.send(chat, Ui.taskFallback(t), reply = rp, task0 = t)
                    val tr = org.json.JSONObject().put("id", tid).put("name", Prefs.name(this)).put("text", "📋 $tt")
                    for ((f, n) in att) Node.send(chat, "", f, n, tr)     // файлы — ответом на карточку
                }
                dlg.dismiss()
            }
        }
        dlg.show()
    }

    private fun taskCard(b: LinearLayout, m: Msg, me: Boolean) {
        val t = m.taskObj ?: return
        val fg = if (me) 0xFFFFFFFF.toInt() else Ui.TEXT
        val mu = if (me) 0xCCFFFFFF.toInt() else Ui.MUTED
        b.minimumWidth = d(260f)
        b.addView(TextView(this).apply { text = "📋 ЗАДАНИЕ"; textSize = 12f; setTypeface(typeface, Typeface.BOLD); setTextColor(mu); letterSpacing = 0.08f })
        b.addView(TextView(this).apply { text = t.optString("title"); textSize = 18f; setTypeface(typeface, Typeface.BOLD); setTextColor(fg) })
        val st = t.optString("status").ifEmpty { Node.TASK_NEW }
        val rows = ArrayList<String>()
        if (t.optString("drawing").isNotEmpty()) rows.add("Чертёж / УП: <b>${t.optString("drawing")}</b>")
        val mq = listOf(t.optString("material"), t.optString("qty").let { if (it.isEmpty()) "" else "$it шт" }).filter { it.isNotEmpty() }
        if (mq.isNotEmpty()) rows.add("Материал: <b>${mq.joinToString(" · ")}</b>")
        if (t.optString("due").isNotEmpty()) {
            val (txt, hot) = Ui.dueInfo(t.optString("due"))
            val late = hot && st != Node.TASK_DONE && st != Node.TASK_OK
            rows.add(if (late && !me) "Срок: <b><font color='#FF3B30'>⚠ $txt</font></b>" else "Срок: <b>${if (late) "⚠ " else ""}$txt</b>")
        }
        if (t.optString("who").isNotEmpty()) rows.add("Исполнитель: <b>${t.optString("who")}</b>")
        if (t.optString("note").isNotEmpty()) rows.add(android.text.TextUtils.htmlEncode(t.optString("note")).replace("\n", "<br>"))
        b.addView(TextView(this).apply {
            text = androidx.core.text.HtmlCompat.fromHtml(rows.joinToString("<br>"), androidx.core.text.HtmlCompat.FROM_HTML_MODE_LEGACY)
            textSize = 15f; setTextColor(fg); setPadding(0, d(2f), 0, d(4f))
        })
        val sr = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val col = Ui.TASK_COLORS[st] ?: Ui.MUTED
        sr.addView(TextView(this).apply {
            text = st; textSize = 13f; setTypeface(typeface, Typeface.BOLD)
            setTextColor(if (me) col else 0xFFFFFFFF.toInt())
            background = Ui.roundBg(if (me) 0xFFFFFFFF.toInt() else col, Ui.dp(this@ChatActivity, 10f))
            setPadding(d(9f), d(2f), d(9f), d(2f))
        })
        val at = t.optLong("at", m.ts)
        sr.addView(TextView(this).apply {
            text = "  ${t.optString("by")} · " + java.text.SimpleDateFormat("dd.MM HH:mm", java.util.Locale.US).format(java.util.Date(at))
            textSize = 12f; setTextColor(mu)
        })
        b.addView(sr)
        val btns = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, d(6f), 0, 0) }
        for ((label, next) in Ui.TASK_NEXT[st] ?: emptyList()) btns.addView(TextView(this).apply {
            text = label; textSize = 15f; setTypeface(typeface, Typeface.BOLD); gravity = Gravity.CENTER
            setTextColor(Ui.ACCENT); background = Ui.roundBg(if (me) 0xFFFFFFFF.toInt() else 0xFFE5F0FF.toInt(), Ui.dp(this@ChatActivity, 10f))
            setPadding(d(12f), d(7f), d(12f), d(7f))
            setOnClickListener { thread { Node.taskUpdate(m.id, next) } }
        }, LinearLayout.LayoutParams(-2, -2).apply { marginEnd = d(6f) })
        btns.addView(TextView(this).apply {
            text = "📎 Файл"; textSize = 15f; setTypeface(typeface, Typeface.BOLD); gravity = Gravity.CENTER
            setTextColor(Ui.ACCENT); background = Ui.roundBg(if (me) 0xFFFFFFFF.toInt() else 0xFFE5F0FF.toInt(), Ui.dp(this@ChatActivity, 10f))
            setPadding(d(12f), d(7f), d(12f), d(7f))
            setOnClickListener {
                pendingReply = org.json.JSONObject().put("id", m.id).put("name", m.senderName).put("text", "📋 " + t.optString("title"))
                androidx.appcompat.app.AlertDialog.Builder(this@ChatActivity).setTitle("Прикрепить к заданию")
                    .setItems(arrayOf("📎 Файл или фото из галереи", "📷 Сфотографировать")) { _, i ->
                        if (i == 0) pick.launch(arrayOf("*/*")) else takePhoto()
                    }.setOnCancelListener { pendingReply = null }.show()
            }
        })
        b.addView(btns)
    }

    private fun refresh() {
        if (!Node.running) { sub.text = "подключаюсь…"; return }
        Node.markRead(chat)
        if (chat == Node.ALL) {
            val peers = Node.accounts()
            title.text = "Общий чат"
            title.setTextColor(Ui.ORANGE_TEXT)
            sub.text = (if (Ui.COMPANY.isNotEmpty()) "${Ui.COMPANY} · " else "Корпоративный · ") +
                "участников: ${peers.size + 1}, в сети: ${peers.count { it.online } + 1}"
        } else {
            val p = Node.account(chat)
            title.text = p?.title ?: "?"
            if (p?.ext == true) {
                sub.text = "внешний контакт · код ${fmtCode(p.code)} · через сервер, зашифровано"
            } else {
            val kinds = (p?.plats ?: emptySet()).map { mapOf("android" to "телефон", "ios" to "iPhone", "pc" to "ПК")[it] ?: it }
                .sorted().joinToString(", ")
            sub.text = when {
                p?.lan == true -> "в сети"
                p?.relay == true -> "в сети через интернет"
                else -> "не в сети — сообщения дойдут, когда появится"
            } + (if (p?.online == true && kinds.isNotEmpty()) " · $kinds" else "")
            }
            Node.typing[chat]?.let { (_, t) ->
                val left = 6500 - (System.currentTimeMillis() - t)
                if (left > 0) { sub.text = "печатает…"; sub.postDelayed({ refresh() }, left) }
            }
        }
        val history = Node.db.history(chat)
        // перерисовываем переписку, только если в ней что-то изменилось (иначе мешаем набору текста)
        val sig = history.joinToString("|") { m ->
            m.id + m.status + (m.local ?: "") + (Node.progress[m.id]?.first ?: "") + (m.task ?: "")
        }
        if (sig == shownSig) return
        shownSig = sig
        val atBottom = scroll.getChildAt(0)?.let { scroll.scrollY + scroll.height >= it.height - d(40f) } ?: true
        msgs.removeAllViews()
        views.clear()
        var lastDay = ""
        for (m in history) {
            val day = Ui.day(m.ts)
            if (day != lastDay) {
                lastDay = day
                msgs.addView(TextView(this).apply {
                    text = day; textSize = 12f; setTextColor(Ui.MUTED); setTypeface(typeface, Typeface.BOLD)
                    background = Ui.roundBg(Ui.CHIP, Ui.dp(this@ChatActivity, 10f))
                    setPadding(d(10f), d(3f), d(10f), d(3f))
                }, LinearLayout.LayoutParams(-2, -2).apply { gravity = Gravity.CENTER_HORIZONTAL; topMargin = d(10f); bottomMargin = d(6f) })
            }
            msgs.addView(bubble(m).also { views[m.id] = it })
        }
        focusId?.let { f -> focusId = null; scroll.post { jumpTo(f) }; return }
        // прокрутка вниз БЕЗ смены фокуса (fullScroll уводил фокус из поля ввода — курсор «вылетал»)
        if (atBottom || history.size != shown) scroll.post { scroll.scrollTo(0, msgs.height) }
        shown = history.size
    }

    private fun bubble(m: Msg): View {
        val me = m.mine
        val fg = if (me) 0xFFFFFFFF.toInt() else Ui.TEXT
        val jumbo = m.file == null && Ui.isJumbo(m.text)
        val meta = if (jumbo) Ui.MUTED else if (me) 0xBFFFFFFF.toInt() else Ui.MUTED
        val b = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            if (!jumbo) {
                background = Ui.roundBg(if (me) Ui.ACCENT else Ui.SURFACE, Ui.dp(this@ChatActivity, 18f))
                setPadding(d(14f), d(8f), d(14f), d(7f))
            } else setPadding(d(4f), d(2f), d(4f), d(2f))
        }
        if (!me && chat == Node.ALL) b.addView(TextView(this).apply {
            text = m.senderName; textSize = 13f; setTypeface(typeface, Typeface.BOLD); setTextColor(Ui.color(m.sender))
        })
        b.setOnLongClickListener { msgMenu(m); true }
        m.fwd?.let { w -> b.addView(TextView(this).apply {
            text = "↪ Переслано от $w"; textSize = 12f; setTypeface(typeface, Typeface.ITALIC); setTextColor(meta)
        }) }
        m.replyObj?.let { rp ->                         // цитата сообщения, на которое ответили
            val q = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL; setPadding(d(9f), d(3f), d(9f), d(4f))
                background = android.graphics.drawable.LayerDrawable(arrayOf(
                    Ui.roundBg(if (me) 0x30FFFFFF else Ui.QUOTE, Ui.dp(this@ChatActivity, 6f)),
                    android.graphics.drawable.ColorDrawable(if (me) 0xFFFFFFFF.toInt() else Ui.ACCENT))).apply { setLayerWidth(1, d(3f)); setLayerGravity(1, Gravity.START or Gravity.FILL_VERTICAL) }
                setOnClickListener { jumpTo(rp.optString("id")) }
            }
            q.addView(TextView(this).apply {
                text = rp.optString("name"); textSize = 12f; setTypeface(typeface, Typeface.BOLD)
                setTextColor(if (me) 0xFFFFFFFF.toInt() else Ui.ACCENT)
            })
            q.addView(TextView(this).apply {
                text = rp.optString("text"); textSize = 14f; maxLines = 2; ellipsize = android.text.TextUtils.TruncateAt.END
                setTextColor(if (me) 0xDDFFFFFF.toInt() else Ui.MUTED)
            })
            b.addView(q, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = d(4f) })
        }
        if (m.task != null) taskCard(b, m, me)
        val f = m.file
        val photo = if (f != null && m.local != null && Ui.ext(f.name) in Ui.IMAGE_EXT)
            Ui.thumb(this, m.local, d(260f) * 2) else null
        if (f != null && photo != null) {
            // фото — прямо в переписке, нажатие — открыть крупно
            b.addView(ImageView(this).apply {
                val dr = androidx.core.graphics.drawable.RoundedBitmapDrawableFactory.create(resources, photo)
                dr.cornerRadius = Ui.dp(this@ChatActivity, 12f)
                setImageDrawable(dr)
                adjustViewBounds = true
                maxWidth = d(240f); maxHeight = d(300f)
                scaleType = ImageView.ScaleType.FIT_CENTER
                setOnClickListener { Ui.open(this@ChatActivity, m.local!!, f.name) }
            }, LinearLayout.LayoutParams(-2, -2).apply { bottomMargin = d(4f) })
            b.setPadding(d(5f), d(5f), d(5f), d(5f))
        } else if (f != null && f.isVoice()) {
            // голосовое: ▶ и длительность
            val playing = Voice.playingId == m.id
            b.addView(TextView(this).apply {
                text = when {
                    m.local == null && !me -> "🎤 Голосовое ${fmtSecs(f.voice)} · скачивается…"
                    playing -> "⏹  🎤 ${fmtSecs(f.voice)}"
                    else -> "▶  🎤 Голосовое ${fmtSecs(f.voice)}"
                }
                textSize = 17f; setTypeface(typeface, Typeface.BOLD); setTextColor(fg); setPadding(0, d(4f), d(6f), d(2f))
                setOnClickListener {
                    val loc = m.local ?: run { Node.download(m.id); return@setOnClickListener }
                    if (!Voice.toggle(this@ChatActivity, m.id, loc) { runOnUiThread { shownSig = ""; refresh() } } && Voice.playingId == null && playing.not())
                        Toast.makeText(this@ChatActivity, "Не удалось проиграть", Toast.LENGTH_SHORT).show()
                    shownSig = ""; refresh()
                }
            })
        } else if (f != null) {
            if (m.local != null && Ui.ext(f.name) in Previews.EXT) {
                Previews.thumb(this, f.fid, m.local, f.name, d(240f) * 2)?.let { bm ->
                    b.addView(ImageView(this).apply {
                        setImageBitmap(bm); adjustViewBounds = true; maxWidth = d(240f); maxHeight = d(260f)
                        scaleType = ImageView.ScaleType.FIT_CENTER; setBackgroundColor(0xFFD0D0D5.toInt()); setPadding(2, 2, 2, 2)
                        setOnClickListener { Ui.open(this@ChatActivity, m.local, f.name) }
                    }, LinearLayout.LayoutParams(-2, -2).apply { bottomMargin = d(6f) })
                }
            }
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            row.addView(Ui.fileBadge(this, f.name), LinearLayout.LayoutParams(d(38f), d(44f)))
            val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(d(10f), 0, 0, 0) }
            col.addView(TextView(this).apply { text = f.name; textSize = 15f; setTypeface(typeface, Typeface.BOLD); setTextColor(fg) })
            val prog = Node.progress[m.id]
            col.addView(TextView(this).apply {
                text = if (prog != null && m.local == null) "${Ui.human(prog.first)} из ${Ui.human(prog.second)}"
                    else if (m.local != null && Ui.ext(f.name) in setOf("step", "stp")) Ui.human(f.size) + " · " + Previews.stepInfo(this@ChatActivity, m.local)
                    else Ui.human(f.size)
                textSize = 13f; setTextColor(meta)
            })
            row.addView(col)
            b.addView(row)
            val action = TextView(this).apply {
                textSize = 15f; setTypeface(typeface, Typeface.BOLD); setTextColor(if (me) 0xFFFFFFFF.toInt() else Ui.ACCENT)
                setPadding(0, d(6f), 0, d(2f))
            }
            when {
                m.local != null -> {
                    action.text = "Открыть"
                    action.setOnClickListener { Ui.open(this, m.local, f.name) }
                }
                m.status == "gone" -> { action.text = "Файл больше недоступен у отправителя"; action.setTextColor(meta) }
                prog != null -> { action.text = "Скачивается…"; action.setTextColor(meta) }
                else -> {
                    action.text = "Скачать"
                    action.setOnClickListener { Node.download(m.id); action.text = "Жду отправителя…" }
                }
            }
            b.addView(action)
        }
        if (m.task != null) Unit
        else if (jumbo) b.addView(TextView(this).apply { text = m.text.trim(); textSize = 46f })
        else if (m.text.isNotEmpty()) b.addView(TextView(this).apply {
            text = m.text; textSize = 16f; setTextColor(fg)
            setOnLongClickListener { msgMenu(m); true }        // долгое нажатие — «Ответить / Копировать»
            android.text.util.Linkify.addLinks(this, android.text.util.Linkify.WEB_URLS)
            if (me) setLinkTextColor(0xFFFFFFFF.toInt())
        })
        var st = ""
        if (me) st = when {
            m.status == "queued" -> "  🕓"
            m.status == "relay" -> "  ✓ на сервере"
            m.status == "delivered" -> "  ✓✓"
            m.status == "read" -> "  ✓✓ прочитано " + Ui.time(if (m.readAt > 0) m.readAt else m.ts)
            m.status.contains('/') -> {
                val a = m.status.substringBefore('/'); val all = m.status.substringAfter('/')
                if (a == all && all != "0") "  ✓✓" else "  ✓ $a/$all"
            }
            else -> ""
        }
        b.addView(TextView(this).apply {
            text = Ui.time(m.ts) + st; textSize = 12f; setTextColor(meta); gravity = Gravity.END
            if (photo != null) setPadding(0, 0, d(8f), d(2f))
        }, LinearLayout.LayoutParams(-1, -2))
        val wrap = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = if (me) Gravity.END else Gravity.START }
        wrap.addView(b, LinearLayout.LayoutParams(-2, -2).apply {
            if (me) marginStart = d(56f) else marginEnd = d(56f)
            topMargin = d(3f); bottomMargin = d(3f)
        })
        return wrap
    }
}
