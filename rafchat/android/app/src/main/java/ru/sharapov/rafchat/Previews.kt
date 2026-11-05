package ru.sharapov.rafchat

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import java.io.File

/** Миниатюры чертежей прямо в переписке: PDF (первая страница), DXF (контуры); у STEP — деталь и программа. */
object Previews {
    val EXT = setOf("pdf", "dxf")
    private val cache = HashMap<String, Bitmap?>()

    fun thumb(ctx: Context, fid: String, local: String, name: String, side: Int): Bitmap? = synchronized(cache) {
        cache.getOrPut(fid) {
            val disk = File(ctx.cacheDir, "thumbs/$fid.png")
            if (disk.isFile) android.graphics.BitmapFactory.decodeFile(disk.path)
            else try {
                val bm = when (Ui.ext(name)) {
                    "pdf" -> pdf(ctx, local, side)
                    "dxf" -> dxf(ctx, local, side)
                    else -> null
                }
                if (bm != null) { disk.parentFile?.mkdirs(); disk.outputStream().use { bm.compress(Bitmap.CompressFormat.PNG, 90, it) } }
                bm
            } catch (e: Exception) { null }
        }
    }

    private fun fd(ctx: Context, local: String): ParcelFileDescriptor? =
        if (local.startsWith("content:")) ctx.contentResolver.openFileDescriptor(Uri.parse(local), "r")
        else ParcelFileDescriptor.open(File(local), ParcelFileDescriptor.MODE_READ_ONLY)

    private fun pdf(ctx: Context, local: String, side: Int): Bitmap? {
        val d = fd(ctx, local) ?: return null
        PdfRenderer(d).use { r ->
            r.openPage(0).use { p ->
                val k = side.toFloat() / maxOf(p.width, p.height)
                val bm = Bitmap.createBitmap((p.width * k).toInt().coerceAtLeast(1), (p.height * k).toInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888)
                bm.eraseColor(Color.WHITE)
                p.render(bm, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                return bm
            }
        }
    }

    private fun text(ctx: Context, local: String, limit: Int = 20_000_000): String {
        val inp = if (local.startsWith("content:")) ctx.contentResolver.openInputStream(Uri.parse(local)) else File(local).inputStream()
        val raw = inp?.use { it.readBytes() } ?: return ""
        if (raw.size > limit) return ""
        return try { java.nio.charset.StandardCharsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(raw)).toString() }
        catch (e: Exception) { String(raw, charset("windows-1251")) }
    }

    private fun dxf(ctx: Context, local: String, side: Int): Bitmap? {
        val lines = text(ctx, local).lines()
        val segs = ArrayList<FloatArray>()           // x1,y1,x2,y2
        val circles = ArrayList<FloatArray>()        // cx,cy,r
        val arcs = ArrayList<FloatArray>()           // cx,cy,r,a0,a1
        var inEnt = false
        var ent: String? = null
        var data = ArrayList<Pair<String, String>>()
        val poly = ArrayList<FloatArray>()
        fun flush() {
            val e = ent ?: return
            val g = HashMap<String, String>()
            val pts = ArrayList<FloatArray>()
            var px: Float? = null
            for ((c, v) in data) {
                when (c) {
                    "10" -> px = v.toFloatOrNull()
                    "20" -> { val y = v.toFloatOrNull(); if (px != null && y != null) pts.add(floatArrayOf(px!!, y)); px = null }
                    else -> if (c !in g) g[c] = v
                }
            }
            try {
                when (e) {
                    "LINE" -> segs.add(floatArrayOf(pts[0][0], pts[0][1], g["11"]!!.toFloat(), g["21"]!!.toFloat()))
                    "CIRCLE" -> circles.add(floatArrayOf(pts[0][0], pts[0][1], g["40"]!!.toFloat()))
                    "ARC" -> arcs.add(floatArrayOf(pts[0][0], pts[0][1], g["40"]!!.toFloat(), g["50"]!!.toFloat(), g["51"]!!.toFloat()))
                    "LWPOLYLINE", "SPLINE" -> {
                        for (i in 0 until pts.size - 1) segs.add(floatArrayOf(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]))
                        if (e == "LWPOLYLINE" && ((g["70"]?.trim()?.toIntOrNull() ?: 0) and 1) == 1 && pts.size > 2)
                            segs.add(floatArrayOf(pts.last()[0], pts.last()[1], pts[0][0], pts[0][1]))
                    }
                    "VERTEX" -> if (pts.isNotEmpty()) poly.add(pts[0])
                }
            } catch (_: Exception) {}
        }
        var i = 0
        while (i < lines.size - 1) {
            val c = lines[i].trim(); val v = lines[i + 1].trim(); i += 2
            if (c == "2" && v == "ENTITIES") { inEnt = true; continue }
            if (!inEnt) continue
            if (c == "0") {
                flush()
                if (v == "SEQEND" && poly.size > 1) {
                    for (j in 0 until poly.size - 1) segs.add(floatArrayOf(poly[j][0], poly[j][1], poly[j + 1][0], poly[j + 1][1]))
                    poly.clear()
                }
                if (v == "ENDSEC") break
                ent = v; data = ArrayList()
            } else data.add(c to v)
        }
        flush()
        var x0 = Float.MAX_VALUE; var y0 = Float.MAX_VALUE; var x1 = -Float.MAX_VALUE; var y1 = -Float.MAX_VALUE
        fun ext(x: Float, y: Float) { x0 = minOf(x0, x); y0 = minOf(y0, y); x1 = maxOf(x1, x); y1 = maxOf(y1, y) }
        segs.forEach { ext(it[0], it[1]); ext(it[2], it[3]) }
        (circles + arcs).forEach { ext(it[0] - it[2], it[1] - it[2]); ext(it[0] + it[2], it[1] + it[2]) }
        if (x0 > x1) return null
        val w = maxOf(x1 - x0, 1e-6f); val h = maxOf(y1 - y0, 1e-6f)
        val k = (side - 20f) / maxOf(w, h)
        val bm = Bitmap.createBitmap((w * k + 20).toInt(), (h * k + 20).toInt(), Bitmap.Config.ARGB_8888)
        bm.eraseColor(Color.WHITE)
        val cv = Canvas(bm)
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF1C3D6E.toInt(); style = Paint.Style.STROKE; strokeWidth = 1.6f }
        val H = bm.height
        fun tx(x: Float) = 10 + (x - x0) * k
        fun ty(y: Float) = H - 10 - (y - y0) * k
        segs.take(200_000).forEach { cv.drawLine(tx(it[0]), ty(it[1]), tx(it[2]), ty(it[3]), p) }
        circles.forEach { cv.drawCircle(tx(it[0]), ty(it[1]), it[2] * k, p) }
        arcs.forEach {
            val r = RectF(tx(it[0] - it[2]), ty(it[1] + it[2]), tx(it[0] + it[2]), ty(it[1] - it[2]))
            var sweep = (it[4] - it[3]) % 360f; if (sweep <= 0) sweep += 360f
            cv.drawArc(r, -it[3], -sweep, false, p)
        }
        return bm
    }

    /** «STEP · деталь «Вал» · Autodesk Fusion 360». */
    fun stepInfo(ctx: Context, local: String): String {
        val head = try {
            val inp = if (local.startsWith("content:")) ctx.contentResolver.openInputStream(Uri.parse(local)) else File(local).inputStream()
            inp?.use { val b = ByteArray(200_000); val n = it.read(b); String(b, 0, maxOf(n, 0), Charsets.ISO_8859_1) } ?: ""
        } catch (e: Exception) { "" }
        fun dec(s: String) = Regex("""\\X2\\([0-9A-Fa-f]+)\\X0\\""").replace(s) { m ->
            m.groupValues[1].chunked(4).map { it.toInt(16).toChar() }.joinToString("") }
        val parts = ArrayList<String>()
        Regex("""PRODUCT\s*\(\s*'([^']*)'""").find(head)?.groupValues?.get(1)?.trim()?.takeIf { it.isNotEmpty() }
            ?.let { parts.add("деталь «${dec(it)}»") }
        Regex("""FILE_NAME\s*\((.*?)\);""", RegexOption.DOT_MATCHES_ALL).find(head)?.groupValues?.get(1)?.let { fn ->
            Regex("'([^']*)'").findAll(fn).map { it.groupValues[1] }.toList().reversed()
                .firstOrNull { Regex("Fusion|SolidWorks|Inventor|KOMPAS|NX|CATIA|Creo|FreeCAD", RegexOption.IGNORE_CASE).containsMatchIn(it) }
                ?.let { parts.add(dec(it).take(40)) }
        }
        return "STEP" + if (parts.isNotEmpty()) " · " + parts.joinToString(" · ") else ""
    }
}
