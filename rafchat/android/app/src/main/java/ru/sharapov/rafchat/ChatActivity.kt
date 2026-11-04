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
    private val d = { v: Float -> Ui.dpi(this, v) }

    private val pick = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isEmpty()) return@registerForActivityResult
        Toast.makeText(this, "Отправляю файлов: ${uris.size}", Toast.LENGTH_SHORT).show()
        thread {
            for (u in uris) Ui.importUri(this, u)?.let { (f, name) -> Node.send(chat, "", f, name) }
        }
    }

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
            Node.send(chat, "", out, name)
        }
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
        super.onCreate(savedInstanceState)
        chat = intent.getStringExtra("chat") ?: Node.ALL
        savedInstanceState?.getString("shot")?.let { shot = java.io.File(it) }
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(0xFFF2F2F7.toInt()) }
        val head = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Ui.SURFACE); setPadding(d(4f), d(8f), d(16f), d(8f))
        }
        head.addView(ImageView(this).apply {
            setImageResource(R.drawable.ic_back); setPadding(d(12f), d(12f), d(12f), d(12f)); setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(d(48f), d(48f)))
        val peer = if (chat == Node.ALL) null else Node.db.peer(chat)
        head.addView(Ui.avatar(this, peer?.name ?: "", chat, 40f, false, chat == Node.ALL,
            if (chat == Node.ALL) null else Node.avatarFile(chat)))
        val hc = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(d(12f), 0, 0, 0) }
        title = TextView(this).apply { textSize = 17f; setTypeface(typeface, Typeface.BOLD); setTextColor(Ui.TEXT); maxLines = 1 }
        sub = TextView(this).apply { textSize = 13f; setTextColor(Ui.MUTED); maxLines = 1 }
        hc.addView(title); hc.addView(sub)
        head.addView(hc, LinearLayout.LayoutParams(0, -2, 1f))
        root.addView(head)
        root.addView(View(this).apply { setBackgroundColor(Ui.LINE) }, LinearLayout.LayoutParams(-1, 1))
        scroll = ScrollView(this).apply {
            descendantFocusability = android.view.ViewGroup.FOCUS_BLOCK_DESCENDANTS
            background = Ui.chatBackground(this@ChatActivity)
        }
        msgs = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(d(12f), d(8f), d(12f), d(8f)) }
        scroll.addView(msgs)
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        root.addView(View(this).apply { setBackgroundColor(Ui.LINE) }, LinearLayout.LayoutParams(-1, 1))
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
        input = EditText(this).apply {
            hint = "Сообщение"; textSize = 16f; background = getDrawable(R.drawable.bg_input)
            setPadding(d(14f), d(10f), d(14f), d(10f)); maxLines = 6
            imeOptions = EditorInfo.IME_FLAG_NO_ENTER_ACTION
        }
        bar.addView(input, LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = d(2f); marginEnd = d(4f) })
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
        Node.visibleChat = null
        try { unregisterReceiver(changed) } catch (_: Exception) {}
        super.onPause()
    }

    private fun sendText() {
        val t = input.text.toString().trim()
        if (t.isEmpty()) return
        if (!Node.running) { Toast.makeText(this, "RafChat ещё не в сети", Toast.LENGTH_SHORT).show(); return }
        input.setText("")
        thread { Node.send(chat, t) }
    }

    private fun refresh() {
        if (!Node.running) { sub.text = "подключаюсь…"; return }
        Node.db.markRead(chat)
        if (chat == Node.ALL) {
            val peers = Node.db.peers()
            title.text = "Общий чат"
            sub.text = "Участников: ${peers.size + 1}, в сети: ${peers.count { it.online } + 1}"
        } else {
            val p = Node.db.peer(chat)
            title.text = p?.title ?: "?"
            sub.text = when {
                p?.lan == true -> "в сети"
                p?.relay == true -> "в сети через интернет"
                else -> "не в сети — сообщения дойдут, когда появится"
            }
        }
        val history = Node.db.history(chat)
        // перерисовываем переписку, только если в ней что-то изменилось (иначе мешаем набору текста)
        val sig = history.joinToString("|") { m ->
            m.id + m.status + (m.local ?: "") + (Node.progress[m.id]?.first ?: "")
        }
        if (sig == shownSig) return
        shownSig = sig
        val atBottom = scroll.getChildAt(0)?.let { scroll.scrollY + scroll.height >= it.height - d(40f) } ?: true
        msgs.removeAllViews()
        var lastDay = ""
        for (m in history) {
            val day = Ui.day(m.ts)
            if (day != lastDay) {
                lastDay = day
                msgs.addView(TextView(this).apply {
                    text = day; textSize = 12f; setTextColor(Ui.MUTED); setTypeface(typeface, Typeface.BOLD)
                    background = Ui.roundBg(0xFFE5E5EA.toInt(), Ui.dp(this@ChatActivity, 10f))
                    setPadding(d(10f), d(3f), d(10f), d(3f))
                }, LinearLayout.LayoutParams(-2, -2).apply { gravity = Gravity.CENTER_HORIZONTAL; topMargin = d(10f); bottomMargin = d(6f) })
            }
            msgs.addView(bubble(m))
        }
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
        } else if (f != null) {
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            row.addView(Ui.fileBadge(this, f.name), LinearLayout.LayoutParams(d(38f), d(44f)))
            val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(d(10f), 0, 0, 0) }
            col.addView(TextView(this).apply { text = f.name; textSize = 15f; setTypeface(typeface, Typeface.BOLD); setTextColor(fg) })
            val prog = Node.progress[m.id]
            col.addView(TextView(this).apply {
                text = if (prog != null && m.local == null) "${Ui.human(prog.first)} из ${Ui.human(prog.second)}" else Ui.human(f.size)
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
        if (jumbo) b.addView(TextView(this).apply { text = m.text.trim(); textSize = 46f })
        else if (m.text.isNotEmpty()) b.addView(TextView(this).apply {
            text = m.text; textSize = 16f; setTextColor(fg); setTextIsSelectable(true)
            android.text.util.Linkify.addLinks(this, android.text.util.Linkify.WEB_URLS)
            if (me) setLinkTextColor(0xFFFFFFFF.toInt())
        })
        var st = ""
        if (me) st = when {
            m.status == "queued" -> "  🕓"
            m.status == "relay" -> "  ✓ на сервере"
            m.status == "delivered" -> "  ✓✓"
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
