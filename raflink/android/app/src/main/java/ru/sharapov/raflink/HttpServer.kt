package ru.sharapov.raflink

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaScannerConnection
import android.media.ThumbnailUtils
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.util.Log
import android.util.Size
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import kotlin.concurrent.thread

/**
 * Маленький HTTP-сервер телефона. ПК обращается к нему по Wi-Fi:
 *  GET  /api/hello               — кто я (без ключа)
 *  POST /api/pair                — сопряжение по 6-значному коду
 *  GET  /api/info                — заряд, память
 *  GET  /api/list?path=          — содержимое папки
 *  GET  /api/file?path=          — скачать файл
 *  GET  /api/thumb?path=&size=   — миниатюра фото/видео (JPEG)
 *  POST /api/upload?name=        — файл с ПК → Загрузки/RafLink
 */
class HttpServer(private val ctx: Context, val port: Int, private val onEvent: () -> Unit) {

    private var server: ServerSocket? = null
    @Volatile private var running = false
    private var pinFails = 0

    val root: File = Environment.getExternalStorageDirectory()

    fun start() {
        running = true
        val ss = ServerSocket()
        ss.reuseAddress = true
        ss.bind(InetSocketAddress(port))
        server = ss
        thread(name = "raflink-accept", isDaemon = true) {
            while (running) {
                try {
                    val s = ss.accept()
                    thread(isDaemon = true) { handle(s) }
                } catch (e: Exception) {
                    if (!running) break
                }
            }
        }
    }

    fun stop() {
        running = false
        try { server?.close() } catch (_: Exception) {}
    }

    // ---------- разбор запроса ----------

    private class Req(
        val method: String,
        val path: String,
        val query: Map<String, String>,
        val headers: Map<String, String>,
        val body: InputStream,
        val remote: String,
    ) {
        val length: Long get() = headers["content-length"]?.toLongOrNull() ?: -1
    }

    private fun readLine(inp: InputStream): String? {
        val sb = ByteArrayOutputStream()
        while (true) {
            val c = inp.read()
            if (c == -1) return if (sb.size() == 0) null else sb.toString("UTF-8")
            if (c == '\n'.code) break
            if (c != '\r'.code) sb.write(c)
            if (sb.size() > 16384) return null
        }
        return sb.toString("UTF-8")
    }

    private fun handle(s: Socket) {
        s.use { sock ->
            try {
                sock.soTimeout = 60_000
                val inp = sock.getInputStream().buffered(65536)
                val out = sock.getOutputStream().buffered(65536)
                val first = readLine(inp) ?: return
                val parts = first.split(' ')
                if (parts.size < 2) return
                val headers = HashMap<String, String>()
                while (true) {
                    val l = readLine(inp) ?: break
                    if (l.isEmpty()) break
                    val i = l.indexOf(':')
                    if (i > 0) headers[l.substring(0, i).trim().lowercase()] = l.substring(i + 1).trim()
                }
                val target = parts[1]
                val qi = target.indexOf('?')
                val path = if (qi >= 0) target.substring(0, qi) else target
                val query = HashMap<String, String>()
                if (qi >= 0) {
                    for (kv in target.substring(qi + 1).split('&')) {
                        val e = kv.indexOf('=')
                        if (e > 0) query[dec(kv.substring(0, e))] = dec(kv.substring(e + 1))
                    }
                }
                val remote = sock.inetAddress.hostAddress ?: ""
                route(Req(parts[0], path, query, headers, inp, remote), out)
                out.flush()
            } catch (e: Exception) {
                Log.w("RafLink", "request failed", e)
            }
        }
    }

    private fun dec(s: String) = URLDecoder.decode(s, "UTF-8")

    // ---------- ответы ----------

    private fun head(out: OutputStream, code: Int, type: String, length: Long) {
        val text = when (code) {
            200 -> "OK"; 400 -> "Bad Request"; 401 -> "Unauthorized"; 403 -> "Forbidden"
            404 -> "Not Found"; else -> "Error"
        }
        val h = StringBuilder()
            .append("HTTP/1.1 $code $text\r\n")
            .append("Content-Type: $type\r\n")
            .append("Content-Length: $length\r\n")
            .append("Connection: close\r\n\r\n")
        out.write(h.toString().toByteArray())
    }

    private fun json(out: OutputStream, code: Int, obj: Any) {
        val b = obj.toString().toByteArray()
        head(out, code, "application/json; charset=utf-8", b.size.toLong())
        out.write(b)
    }

    private fun err(out: OutputStream, code: Int, msg: String) = json(out, code, JSONObject().put("error", msg))

    // ---------- маршруты ----------

    private fun route(r: Req, out: OutputStream) {
        when (r.path) {
            "/api/hello" -> return json(out, 200, hello())
            "/api/pair" -> return pair(r, out)
        }
        val token = Prefs.token(ctx)
        if (token == null || r.headers["x-token"] != token) return err(out, 401, "not_paired")
        Prefs.updatePcHost(ctx, r.remote)
        Prefs.touch(ctx)

        when (r.path) {
            "/api/info" -> json(out, 200, info())
            "/api/list" -> list(r, out)
            "/api/file" -> file(r, out)
            "/api/thumb" -> thumb(r, out)
            "/api/upload" -> upload(r, out)
            else -> err(out, 404, "not_found")
        }
    }

    private fun hello() = JSONObject()
        .put("app", "RafLink")
        .put("version", BuildConfigVersion.NAME)
        .put("name", deviceName())
        .put("model", Build.MODEL)
        .put("paired", Prefs.isPaired(ctx))

    private fun pair(r: Req, out: OutputStream) {
        val body = readBody(r, 4096) ?: return err(out, 400, "bad_body")
        val o = try { JSONObject(body) } catch (e: Exception) { return err(out, 400, "bad_json") }
        synchronized(this) {
            if (o.optString("pin") != Prefs.pin(ctx)) {
                pinFails++
                if (pinFails >= 5) { Prefs.newPin(ctx); pinFails = 0; onEvent() }
                return err(out, 403, "wrong_pin")
            }
            pinFails = 0
            val token = Prefs.newToken()
            val pcName = o.optString("pc_name", "ПК").take(64)
            Prefs.savePairing(ctx, token, pcName, r.remote, o.optInt("pc_port", 47701))
            Prefs.newPin(ctx)
            Prefs.addEvent(ctx, "Подключён ПК «$pcName»")
            onEvent()
            json(out, 200, JSONObject().put("token", token).put("name", deviceName()).put("model", Build.MODEL))
        }
    }

    private fun info(): JSONObject {
        val bm = ctx.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        val st = StatFs(root.path)
        return JSONObject()
            .put("name", deviceName())
            .put("model", Build.MODEL)
            .put("android", Build.VERSION.RELEASE)
            .put("battery", bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY))
            .put("charging", bm.isCharging)
            .put("free", st.availableBytes)
            .put("total", st.totalBytes)
            .put("files_access", Perms.hasAllFiles())
            .put("root", root.path)
    }

    /** Путь внутри памяти телефона; null — если выходит за её пределы. */
    private fun safe(p: String?): File? {
        val f = if (p.isNullOrEmpty()) root else File(p)
        val c = f.canonicalFile
        val base = root.canonicalPath
        return if (c.path == base || c.path.startsWith("$base/")) c else null
    }

    private fun list(r: Req, out: OutputStream) {
        if (!Perms.hasAllFiles()) return err(out, 403, "no_permission")
        val dir = safe(r.query["path"]) ?: return err(out, 403, "outside")
        if (!dir.isDirectory) return err(out, 404, "not_found")
        val arr = JSONArray()
        (dir.listFiles() ?: emptyArray())
            .filter { !it.name.startsWith(".") }
            .forEach {
                arr.put(
                    JSONObject()
                        .put("name", it.name)
                        .put("dir", it.isDirectory)
                        .put("size", if (it.isFile) it.length() else 0)
                        .put("mtime", it.lastModified() / 1000)
                )
            }
        json(out, 200, JSONObject().put("path", dir.path).put("items", arr))
    }

    private fun file(r: Req, out: OutputStream) {
        if (!Perms.hasAllFiles()) return err(out, 403, "no_permission")
        val f = safe(r.query["path"]) ?: return err(out, 403, "outside")
        if (!f.isFile) return err(out, 404, "not_found")
        head(out, 200, "application/octet-stream", f.length())
        FileInputStream(f).use { it.copyTo(out, 65536) }
        if (r.query["log"] == "1") {
            Prefs.addEvent(ctx, "→ ПК: ${f.name}")
            onEvent()
        }
    }

    private val imageExt = setOf("jpg", "jpeg", "png", "webp", "heic", "heif", "bmp", "gif")
    private val videoExt = setOf("mp4", "mov", "3gp", "mkv", "webm")

    private fun thumb(r: Req, out: OutputStream) {
        val f = safe(r.query["path"]) ?: return err(out, 403, "outside")
        if (!f.isFile) return err(out, 404, "not_found")
        val size = (r.query["size"]?.toIntOrNull() ?: 256).coerceIn(64, 1024)
        val ext = f.extension.lowercase()
        val bmp: Bitmap? = try {
            when {
                Build.VERSION.SDK_INT >= 29 && ext in imageExt ->
                    ThumbnailUtils.createImageThumbnail(f, Size(size, size), null)
                Build.VERSION.SDK_INT >= 29 && ext in videoExt ->
                    ThumbnailUtils.createVideoThumbnail(f, Size(size, size), null)
                ext in imageExt -> {
                    val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeFile(f.path, o)
                    var s = 1
                    while (o.outWidth / (s * 2) >= size && o.outHeight / (s * 2) >= size) s *= 2
                    BitmapFactory.decodeFile(f.path, BitmapFactory.Options().apply { inSampleSize = s })
                }
                else -> null
            }
        } catch (e: Exception) { null }
        if (bmp == null) return err(out, 404, "no_thumb")
        val bo = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, 82, bo)
        head(out, 200, "image/jpeg", bo.size().toLong())
        bo.writeTo(out)
    }

    private fun upload(r: Req, out: OutputStream) {
        if (!Perms.hasAllFiles()) return err(out, 403, "no_permission")
        val name = cleanName(r.query["name"] ?: return err(out, 400, "no_name"))
        val len = r.length
        if (len < 0) return err(out, 400, "no_length")
        val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "RafLink")
        dir.mkdirs()
        val dst = unique(dir, name)
        val tmp = File(dir, ".${dst.name}.part")
        var left = len
        val buf = ByteArray(65536)
        FileOutputStream(tmp).use { fo ->
            while (left > 0) {
                val n = r.body.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
                if (n < 0) break
                fo.write(buf, 0, n)
                left -= n
            }
        }
        if (left > 0) { tmp.delete(); return err(out, 400, "incomplete") }
        tmp.renameTo(dst)
        MediaScannerConnection.scanFile(ctx, arrayOf(dst.path), null, null)
        Prefs.addEvent(ctx, "← с ПК: ${dst.name}")
        Notify.received(ctx, dst.name)
        onEvent()
        json(out, 200, JSONObject().put("path", dst.path).put("name", dst.name))
    }

    private fun readBody(r: Req, max: Int): String? {
        val len = r.length
        if (len < 0 || len > max) return null
        val b = ByteArray(len.toInt())
        var off = 0
        while (off < b.size) {
            val n = r.body.read(b, off, b.size - off)
            if (n < 0) return null
            off += n
        }
        return String(b, Charsets.UTF_8)
    }

    companion object {
        fun cleanName(n: String): String {
            val s = n.substringAfterLast('/').substringAfterLast('\\')
                .replace(Regex("[\\u0000-\\u001f<>:\"|?*]"), "_").trim().trimStart('.')
            return s.ifEmpty { "file" }.take(180)
        }

        fun unique(dir: File, name: String): File {
            var f = File(dir, name)
            if (!f.exists()) return f
            val base = name.substringBeforeLast('.', name)
            val ext = if (name.contains('.')) "." + name.substringAfterLast('.') else ""
            var i = 2
            while (f.exists()) { f = File(dir, "$base ($i)$ext"); i++ }
            return f
        }

        fun deviceName(): String {
            val m = Build.MODEL ?: "Android"
            val man = Build.MANUFACTURER ?: ""
            return if (m.startsWith(man, ignoreCase = true)) m else "${man.replaceFirstChar { it.uppercase() }} $m"
        }
    }
}

object BuildConfigVersion { const val NAME = "0.1.0" }
