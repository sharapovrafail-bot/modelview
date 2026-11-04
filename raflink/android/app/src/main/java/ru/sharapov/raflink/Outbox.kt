package ru.sharapov.raflink

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import java.io.File
import java.util.concurrent.atomic.AtomicLong

/**
 * Очередь «телефон → ПК». Файл копируется сюда, а ПК сам забирает его при очередном опросе.
 * Так передача не зависит от брандмауэра Windows и доходит, даже если ПК был выключен.
 * Имя файла в очереди: <id>__<исходное имя>.
 */
object Outbox {
    private val seq = AtomicLong(System.currentTimeMillis())

    fun dir(ctx: Context) = File(ctx.filesDir, "outbox").apply { mkdirs() }

    data class Item(val id: String, val name: String, val file: File)

    fun items(ctx: Context): List<Item> =
        (dir(ctx).listFiles() ?: emptyArray())
            .filter { it.isFile && !it.name.endsWith(".part") && it.name.contains("__") }
            .sortedBy { it.name }
            .map { Item(it.name.substringBefore("__"), it.name.substringAfter("__"), it) }

    fun find(ctx: Context, id: String): Item? = items(ctx).firstOrNull { it.id == id }

    fun count(ctx: Context) = items(ctx).size

    /** Скопировать файл в очередь. Возвращает имя файла. */
    fun add(ctx: Context, uri: Uri): String {
        var name = uri.lastPathSegment?.substringAfterLast('/') ?: "file"
        try {
            ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst() && !c.isNull(0)) name = c.getString(0)
            }
        } catch (_: Exception) {}
        name = HttpServer.cleanName(name)
        val id = seq.incrementAndGet().toString()
        val tmp = File(dir(ctx), "${id}__$name.part")
        ctx.contentResolver.openInputStream(uri).use { inp ->
            requireNotNull(inp) { "Не удалось открыть файл" }
            tmp.outputStream().use { inp.copyTo(it, 65536) }
        }
        tmp.renameTo(File(dir(ctx), "${id}__$name"))
        return name
    }
}
