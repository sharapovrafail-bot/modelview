package ru.sharapov.rafchat

import android.content.Context
import android.content.Intent
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.util.TypedValue
import android.view.Gravity
import android.webkit.MimeTypeMap
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.FileProvider
import java.io.File
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/** Общие мелочи интерфейса: аватары, значки файлов, время. */
object Ui {
    const val ACCENT = 0xFF007AFF.toInt()
    const val TEXT = 0xFF1C1C1E.toInt()
    const val MUTED = 0xFF8A8A8E.toInt()
    const val OK = 0xFF34C759.toInt()
    const val LINE = 0xFFE5E5EA.toInt()
    const val SURFACE = 0xFFFFFFFF.toInt()
    /** «Общий чат» организации выделен оранжевым */
    const val ORANGE = 0xFFFF8A00.toInt()
    const val ORANGE_TEXT = 0xFFD96F00.toInt()
    val COMPANY: String get() = BuildConfig.COMPANY
    private val COLORS = intArrayOf(
        0xFFFF9500.toInt(), 0xFF34C759.toInt(), 0xFFAF52DE.toInt(), 0xFFFF2D55.toInt(),
        0xFF5AC8FA.toInt(), 0xFFFF3B30.toInt(), 0xFF5856D6.toInt(), 0xFF30B0C7.toInt()
    )

    fun dp(ctx: Context, v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, ctx.resources.displayMetrics)
    fun dpi(ctx: Context, v: Float) = dp(ctx, v).toInt()

    fun color(key: String): Int {
        val h = java.security.MessageDigest.getInstance("MD5").digest(key.toByteArray())
        val n = java.math.BigInteger(1, h)
        return COLORS[n.mod(java.math.BigInteger.valueOf(COLORS.size.toLong())).toInt()]
    }

    fun initials(name: String): String =
        name.replace('.', ' ').split(' ').filter { it.isNotEmpty() }.take(2).joinToString("") { it.take(1) }
            .uppercase().ifEmpty { "?" }

    fun roundBg(color: Int, radius: Float) = GradientDrawable().apply { setColor(color); cornerRadius = radius }

    /** Круглый аватар с инициалами и зелёной точкой «в сети». */
    fun avatar(ctx: Context, name: String, key: String, sizeDp: Float, online: Boolean, group: Boolean = false,
               photo: File? = null): FrameLayout {
        val size = dpi(ctx, sizeDp)
        val f = FrameLayout(ctx)
        val bmp = photo?.takeIf { it.isFile }?.let { try { android.graphics.BitmapFactory.decodeFile(it.path) } catch (_: Exception) { null } }
        if (bmp != null) {
            val img = android.widget.ImageView(ctx).apply {
                setImageDrawable(androidx.core.graphics.drawable.RoundedBitmapDrawableFactory.create(ctx.resources, bmp)
                    .apply { isCircular = true; setAntiAlias(true) })
                scaleType = android.widget.ImageView.ScaleType.CENTER_CROP
            }
            f.addView(img, FrameLayout.LayoutParams(size, size))
        } else if (group) {                    // «Общий чат»: логотип организации на белом круге с оранжевой каймой
            val img = android.widget.ImageView(ctx).apply {
                setImageResource(R.drawable.corp_logo)
                scaleType = android.widget.ImageView.ScaleType.FIT_CENTER
                val pad = (size * 0.13f).toInt()
                setPadding(pad, pad, pad, pad)
                background = GradientDrawable().apply {
                    shape = GradientDrawable.OVAL; setColor(SURFACE); setStroke(dpi(ctx, 1.5f), ORANGE)
                }
            }
            f.addView(img, FrameLayout.LayoutParams(size, size))
        } else {
        val t = TextView(ctx).apply {
            text = if (group) "👥" else initials(name)
            gravity = Gravity.CENTER
            setTextColor(0xFFFFFFFF.toInt())
            textSize = sizeDp * 0.36f
            setTypeface(typeface, Typeface.BOLD)
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL; setColor(if (group) ORANGE else color(key))
            }
        }
        f.addView(t, FrameLayout.LayoutParams(size, size))
        }
        if (online) {
            val d = dpi(ctx, sizeDp * 0.3f)
            val dot = android.view.View(ctx).apply {
                background = GradientDrawable().apply {
                    shape = GradientDrawable.OVAL; setColor(OK); setStroke(dpi(ctx, 2f), SURFACE)
                }
            }
            f.addView(dot, FrameLayout.LayoutParams(d, d).apply { gravity = Gravity.BOTTOM or Gravity.END })
        }
        return f
    }

    /** Узор фона переписки (шестерни, гайки, штангенциркуль…), как обои в WhatsApp. */
    fun chatBackground(ctx: Context, corp: Boolean = false): android.graphics.drawable.Drawable {
        // «Общий чат» — контуры логотипа организации, личные чаты — чертёжный узор
        val src = android.graphics.BitmapFactory.decodeResource(ctx.resources, if (corp) R.drawable.corp_pattern else R.drawable.chat_pattern)
        val side = dpi(ctx, 300f)
        val tile = android.graphics.drawable.BitmapDrawable(ctx.resources, android.graphics.Bitmap.createScaledBitmap(src, side, side, true))
        tile.setTileModeXY(android.graphics.Shader.TileMode.REPEAT, android.graphics.Shader.TileMode.REPEAT)
        return android.graphics.drawable.LayerDrawable(arrayOf(android.graphics.drawable.ColorDrawable(0xFFECEEF2.toInt()), tile))
    }

    /** Картинка → JPEG: поворот по EXIF учитывается, длинная сторона не больше maxSide, square — квадрат по центру. */
    fun jpeg(ctx: Context, uri: Uri, maxSide: Int, square: Boolean, quality: Int = 85): ByteArray? = try {
        var b: android.graphics.Bitmap = if (android.os.Build.VERSION.SDK_INT >= 28) {
            android.graphics.ImageDecoder.decodeBitmap(android.graphics.ImageDecoder.createSource(ctx.contentResolver, uri)) { dec, info, _ ->
                val s = info.size
                val k = maxOf(1, minOf(s.width, s.height) / (maxSide * 2))
                if (k > 1) dec.setTargetSampleSize(k)
                dec.allocator = android.graphics.ImageDecoder.ALLOCATOR_SOFTWARE
            }
        } else ctx.contentResolver.openInputStream(uri)!!.use { android.graphics.BitmapFactory.decodeStream(it) }
        if (square) {
            val side = minOf(b.width, b.height)
            b = android.graphics.Bitmap.createBitmap(b, (b.width - side) / 2, (b.height - side) / 2, side, side)
        }
        val k = maxSide.toFloat() / maxOf(b.width, b.height)
        if (k < 1f) b = android.graphics.Bitmap.createScaledBitmap(b, (b.width * k).toInt(), (b.height * k).toInt(), true)
        java.io.ByteArrayOutputStream().also { b.compress(android.graphics.Bitmap.CompressFormat.JPEG, quality, it) }.toByteArray()
    } catch (e: Exception) { null }

    /** Разбить строку смайликов на отдельные (учитывая ️, ‍ и оттенки кожи). */
    fun splitEmoji(s: String): List<String> {
        val out = ArrayList<String>()
        val it = java.text.BreakIterator.getCharacterInstance()
        it.setText(s)
        var start = it.first()
        var end = it.next()
        while (end != java.text.BreakIterator.DONE) {
            out.add(s.substring(start, end)); start = end; end = it.next()
        }
        return out
    }

    /** Только 1–3 смайлика — показываем крупно, без облачка (как в WhatsApp). */
    fun isJumbo(text: String): Boolean {
        val t = text.replace(" ", "")
        if (t.isEmpty() || t.length > 24) return false
        if (t.any { it.code < 0x2000 && (it.isLetterOrDigit() || it in ".,!?:;()-_\"'") }) return false
        if (!t.all { it.code >= 0x2190 || it == '\uFE0F' || it == '\u200D' }) return false
        return splitEmoji(t).size <= 3
    }

    val EMOJI = linkedMapOf(
        "😀" to "😀😃😄😁😆😅🤣😂🙂😉😊😇🥰😍🤩😘😋😜🤪😎🤓🧐🤔🤨😐😑😶🙄😏😴🤤🥱😬🤐😷🤒🤕🤢🥵🥶🤯🥳🥺😢😭😤😠😡🤬" +
            "😱😨😰😓🤗🤭🫡🤫😈💀🤡👻👽🤖💩",
        "👍" to "👍👎👌🤌✌️🤞🤟🤘👊✊🤛🤜👏🙌🫶👐🙏🤝💪👋🤙👆👇👉👈☝️✋🖐️🫵",
        "🔧" to "🔧🔩⚙️🛠️⛏️🔨🪛🪚🧰📐📏🧲🔥⚡🏭🏗️🚧⚠️🦺🪖🧪🔬💡🔋🖥️💻🖨️⌨️🖱️📦🚚⏱️⏳📅📋📌📎✂️🗜️🛞",
        "❤️" to "❤️🧡💛💚💙💜🖤🤍💯✅❌❗❓💬🎉🎂🍕☕🍺🍻🎁🏆⭐🌟☀️🌧️❄️🌈🚀💰💵📞📷🎵😺🐶🐱🐻🦊",
    )

    /** Панель смайликов (снизу экрана): разделы сверху, сетка ниже. */
    fun emojiDialog(ctx: Context, onPick: (String) -> Unit) {
        val dlg = com.google.android.material.bottomsheet.BottomSheetDialog(ctx)
        val col = android.widget.LinearLayout(ctx).apply { orientation = android.widget.LinearLayout.VERTICAL; setPadding(dpi(ctx, 8f), dpi(ctx, 8f), dpi(ctx, 8f), dpi(ctx, 8f)) }
        val tabs = android.widget.LinearLayout(ctx).apply { orientation = android.widget.LinearLayout.HORIZONTAL }
        val grid = android.widget.GridLayout(ctx).apply { columnCount = 8 }
        val cell = (ctx.resources.displayMetrics.widthPixels - dpi(ctx, 16f)) / 8
        fun show(k: String) {
            grid.removeAllViews()
            for (e in splitEmoji(EMOJI[k]!!)) grid.addView(TextView(ctx).apply {
                text = e; textSize = 26f; gravity = Gravity.CENTER
                setOnClickListener { onPick(e) }
            }, android.widget.GridLayout.LayoutParams().apply { width = cell; height = cell })
        }
        for (k in EMOJI.keys) tabs.addView(TextView(ctx).apply {
            text = k; textSize = 22f; gravity = Gravity.CENTER; setPadding(0, dpi(ctx, 6f), 0, dpi(ctx, 6f))
            setOnClickListener { show(k) }
        }, android.widget.LinearLayout.LayoutParams(0, -2, 1f))
        col.addView(tabs)
        col.addView(android.widget.ScrollView(ctx).apply { addView(grid) }, android.widget.LinearLayout.LayoutParams(-1, dpi(ctx, 300f)))
        show("😀")
        dlg.setContentView(col)
        dlg.show()
    }

    /** Коротко о сообщении — для цитаты в ответе и результатов поиска. */
    fun snippet(m: Msg, n: Int = 70): String {
        val t = m.taskObj?.let { "📋 " + it.optString("title") }
            ?: if (m.file != null && m.text.isEmpty()) "📎 " + m.file.name else m.text.replace('\n', ' ')
        return if (t.length <= n) t else t.take(n - 1) + "…"
    }

    /** Текст задания для старых версий и iPhone (они не умеют показывать карточку). */
    fun taskFallback(t: org.json.JSONObject): String {
        val parts = arrayListOf("📋 Задание: " + t.optString("title"))
        for ((k, l) in listOf("drawing" to "Чертёж/УП", "material" to "Материал", "qty" to "Кол-во", "due" to "Срок",
                "who" to "Исполнитель", "note" to "")) {
            val v = t.optString(k)
            if (v.isNotEmpty()) parts.add(if (l.isEmpty()) v else "$l: $v")
        }
        return parts.joinToString("\n")
    }

    /** «10.11.2026» → текст и «горит ли» срок. */
    fun dueInfo(due: String): Pair<String, Boolean> {
        val d = try { SimpleDateFormat("dd.MM.yyyy", Locale.US).parse(due) } catch (e: Exception) { null } ?: return due to false
        val c = Calendar.getInstance().apply { time = d }
        val today = Calendar.getInstance().apply { set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }
        val left = ((c.timeInMillis - today.timeInMillis) / 86_400_000L).toInt()
        val dd = SimpleDateFormat("dd.MM", Locale.US).format(d)
        return when {
            left < 0 -> "до $dd — просрочено на ${-left} дн." to true
            left == 0 -> "до $dd — сегодня" to true
            else -> "до $dd (осталось $left дн.)" to false
        }
    }

    val TASK_COLORS = mapOf(Node.TASK_NEW to 0xFF8E8E93.toInt(), Node.TASK_WORK to 0xFFFF9500.toInt(),
        Node.TASK_DONE to 0xFF007AFF.toInt(), Node.TASK_OK to 0xFF34C759.toInt(), Node.TASK_REWORK to 0xFFFF3B30.toInt())
    val TASK_NEXT = mapOf(
        Node.TASK_NEW to listOf("Взять в работу" to Node.TASK_WORK), Node.TASK_WORK to listOf("Готово" to Node.TASK_DONE),
        Node.TASK_DONE to listOf("Принято ОТК" to Node.TASK_OK, "Доработка" to Node.TASK_REWORK),
        Node.TASK_REWORK to listOf("Взять в работу" to Node.TASK_WORK), Node.TASK_OK to emptyList())

    val IMAGE_EXT = setOf("jpg", "jpeg", "png", "webp", "gif", "bmp", "heic")
    private val thumbs = android.util.LruCache<String, android.graphics.Bitmap>(40)

    /** Миниатюра фото для переписки (длинная сторона ≤ maxPx), поворот по EXIF учитывается. */
    fun thumb(ctx: Context, local: String, maxPx: Int): android.graphics.Bitmap? {
        thumbs.get(local)?.let { return it }
        val uri = if (local.startsWith("content://")) Uri.parse(local) else Uri.fromFile(File(local))
        val b = try {
            if (android.os.Build.VERSION.SDK_INT >= 28) {
                android.graphics.ImageDecoder.decodeBitmap(android.graphics.ImageDecoder.createSource(ctx.contentResolver, uri)) { dec, info, _ ->
                    val s = info.size
                    val k = maxOf(1, maxOf(s.width, s.height) / maxPx)
                    if (k > 1) dec.setTargetSampleSize(k)
                }
            } else {
                val o = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
                ctx.contentResolver.openInputStream(uri)?.use { android.graphics.BitmapFactory.decodeStream(it, null, o) }
                val k = maxOf(1, maxOf(o.outWidth, o.outHeight) / maxPx)
                ctx.contentResolver.openInputStream(uri)?.use {
                    android.graphics.BitmapFactory.decodeStream(it, null, android.graphics.BitmapFactory.Options().apply { inSampleSize = k })
                }
            }
        } catch (e: Exception) { null } ?: return null
        thumbs.put(local, b)
        return b
    }

    fun ext(name: String) = name.substringAfterLast('.', "").lowercase()

    fun fileColor(name: String): Int = when (ext(name)) {
        "step", "stp", "igs", "iges", "f3d", "sldprt" -> 0xFFAF52DE.toInt()
        "stl", "3mf", "obj" -> 0xFFFF9500.toInt()
        "nc", "tap", "cnc", "ngc", "gcode", "mpf" -> 0xFF34C759.toInt()
        "dxf", "dwg" -> 0xFF30B0C7.toInt()
        "jpg", "jpeg", "png", "heic", "webp", "gif" -> 0xFF32ADE6.toInt()
        "pdf" -> 0xFFFF3B30.toInt()
        else -> 0xFF8E8E93.toInt()
    }

    fun fileBadge(ctx: Context, name: String): TextView = TextView(ctx).apply {
        val e = ext(name).uppercase().take(4)
        text = e.ifEmpty { "•" }
        setTextColor(0xFFFFFFFF.toInt())
        textSize = if (e.length > 3) 10f else 12f
        setTypeface(typeface, Typeface.BOLD)
        gravity = Gravity.CENTER
        background = roundBg(fileColor(name), dp(ctx, 9f))
    }

    fun human(n: Long): String {
        var v = n.toDouble()
        for (u in listOf("Б", "КБ", "МБ", "ГБ")) {
            if (v < 1024 || u == "ГБ") return (if (u == "Б" || v >= 100) "%.0f" else "%.1f").format(v).replace('.', ',') + " " + u
            v /= 1024
        }
        return n.toString()
    }

    fun time(ts: Long): String = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(ts))

    fun shortWhen(ts: Long): String {
        val c = Calendar.getInstance().apply { timeInMillis = ts }
        val now = Calendar.getInstance()
        return if (c.get(Calendar.YEAR) == now.get(Calendar.YEAR) && c.get(Calendar.DAY_OF_YEAR) == now.get(Calendar.DAY_OF_YEAR))
            time(ts) else SimpleDateFormat("dd.MM", Locale.getDefault()).format(Date(ts))
    }

    fun day(ts: Long): String {
        val c = Calendar.getInstance().apply { timeInMillis = ts }
        val now = Calendar.getInstance()
        if (c.get(Calendar.YEAR) == now.get(Calendar.YEAR)) {
            val d = now.get(Calendar.DAY_OF_YEAR) - c.get(Calendar.DAY_OF_YEAR)
            if (d == 0) return "Сегодня"
            if (d == 1) return "Вчера"
        }
        return SimpleDateFormat("d MMMM yyyy", Locale("ru")).format(Date(ts))
    }

    /** Открыть файл: полученный (адрес в «Загрузках») или свой отправленный. */
    fun open(ctx: Context, local: String, name: String) {
        val uri: Uri = if (local.startsWith("content://")) Uri.parse(local)
        else FileProvider.getUriForFile(ctx, ctx.packageName + ".files", File(local))
        val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext(name)) ?: "*/*"
        val i = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        try { ctx.startActivity(Intent.createChooser(i, name).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (e: Exception) {
            Toast.makeText(ctx, "Нет приложения, чтобы открыть этот файл", Toast.LENGTH_LONG).show()
        }
    }

    /** Скопировать выбранный файл в память приложения (чтобы отдавать его получателям). */
    fun importUri(ctx: Context, uri: Uri): Pair<File, String>? {
        var name = uri.lastPathSegment?.substringAfterLast('/') ?: "file"
        try {
            ctx.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                if (it.moveToFirst() && !it.isNull(0)) name = it.getString(0)
            }
        } catch (_: Exception) {}
        name = name.replace(Regex("[\\\\/:*?\"<>|]"), "_")
        val dir = File(ctx.filesDir, "sent").apply { mkdirs() }
        val f = File(dir, java.util.UUID.randomUUID().toString().take(8) + "_" + name)
        return try {
            ctx.contentResolver.openInputStream(uri)?.use { i -> f.outputStream().use { i.copyTo(it) } } ?: return null
            f to name
        } catch (e: Exception) { null }
    }
}
