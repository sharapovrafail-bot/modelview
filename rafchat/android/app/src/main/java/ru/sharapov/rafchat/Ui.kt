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
    fun avatar(ctx: Context, name: String, key: String, sizeDp: Float, online: Boolean, group: Boolean = false): FrameLayout {
        val size = dpi(ctx, sizeDp)
        val f = FrameLayout(ctx)
        val t = TextView(ctx).apply {
            text = if (group) "👥" else initials(name)
            gravity = Gravity.CENTER
            setTextColor(0xFFFFFFFF.toInt())
            textSize = sizeDp * 0.36f
            setTypeface(typeface, Typeface.BOLD)
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL; setColor(if (group) ACCENT else color(key))
            }
        }
        f.addView(t, FrameLayout.LayoutParams(size, size))
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
