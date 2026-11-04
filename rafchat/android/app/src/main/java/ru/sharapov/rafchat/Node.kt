package ru.sharapov.rafchat

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import android.webkit.MimeTypeMap
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.URL
import java.net.URLDecoder
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.concurrent.thread

/**
 * Участник сети RafChat — тот же протокол, что у программы для ПК:
 *  UDP 47800 — маяк «я здесь» (подписан кодом организации),
 *  TCP 47801 — POST /msg (сообщение), GET /file?fid= (файл, с докачкой), GET /ping.
 * Каждый запрос подписан: X-Auth: <время>:<HMAC-SHA256(ключ, время:метод:путь:sha256(тело))>.
 */
object Node {
    const val UDP = 47800
    const val TCP = 47801
    const val ALL = "all"
    const val ONLINE_MS = 15_000L
    const val AUTO = 50L * 1024 * 1024
    const val ACTION_CHANGED = "ru.sharapov.rafchat.CHANGED"

    lateinit var ctx: Context
    lateinit var db: Store
    lateinit var id: String

    @Volatile var running = false
    @Volatile var visibleChat: String? = null
    private var key = ByteArray(0)
    private var udp: DatagramSocket? = null
    private var server: ServerSocket? = null
    private val wake = Object()
    private val downloading = ConcurrentHashMap.newKeySet<String>()
    val progress = ConcurrentHashMap<String, Pair<Long, Long>>()

    // ---------- запуск / остановка
    @Synchronized
    fun start(c: Context) {
        if (running) return
        ctx = c.applicationContext
        if (!::db.isInitialized) db = Store(ctx)
        id = Prefs.id(ctx)
        key = sha256(("RafChat:" + Prefs.org(ctx).trim()).toByteArray())
        running = true
        val ss = ServerSocket()
        ss.reuseAddress = true
        ss.bind(InetSocketAddress(TCP))
        server = ss
        val us = DatagramSocket(null)
        us.reuseAddress = true
        us.broadcast = true
        us.bind(InetSocketAddress(UDP))
        udp = us
        thread(name = "rc-http", isDaemon = true) { acceptLoop(ss) }
        thread(name = "rc-udp", isDaemon = true) { udpLoop(us) }
        thread(name = "rc-beacon", isDaemon = true) { beaconLoop() }
        thread(name = "rc-outbox", isDaemon = true) { outboxLoop() }
    }

    @Synchronized
    fun stop() {
        if (!running) return
        try { beacon(bye = true) } catch (_: Exception) {}
        running = false
        try { server?.close() } catch (_: Exception) {}
        try { udp?.close() } catch (_: Exception) {}
        synchronized(wake) { wake.notifyAll() }
    }

    fun changed() = ctx.sendBroadcast(Intent(ACTION_CHANGED).setPackage(ctx.packageName))

    private fun kick() = synchronized(wake) { wake.notifyAll() }

    // ---------- подписи
    private fun sha256(b: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(b)
    private fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }

    fun sign(data: ByteArray): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        return hex(mac.doFinal(data))
    }

    private fun authData(ts: String, method: String, path: String, body: ByteArray) =
        "$ts:$method:$path:".toByteArray() + hex(sha256(body)).toByteArray()

    fun authHeader(method: String, path: String, body: ByteArray = ByteArray(0)): String {
        val ts = (System.currentTimeMillis() / 1000).toString()
        return ts + ":" + sign(authData(ts, method, path, body))
    }

    private fun checkAuth(h: String?, method: String, path: String, body: ByteArray): Boolean {
        if (h == null) return false
        val i = h.indexOf(':')
        if (i <= 0) return false
        val ts = h.substring(0, i)
        val t = ts.toLongOrNull() ?: return false
        if (Math.abs(System.currentTimeMillis() / 1000 - t) > 86400) return false
        return MessageDigest.isEqual(h.substring(i + 1).toByteArray(), sign(authData(ts, method, path, body)).toByteArray())
    }

    // ---------- маяк
    private fun beaconBytes(ask: Boolean, bye: Boolean): ByteArray {
        val raw = JSONObject()
            .put("app", "RafChat").put("v", 1).put("id", id).put("name", Prefs.name(ctx))
            .put("dept", Prefs.dept(ctx)).put("port", TCP).put("plat", "android").put("ask", ask).put("bye", bye)
            .toString()
        return JSONObject().put("d", raw).put("s", sign(raw.toByteArray())).toString().toByteArray()
    }

    private fun targets(): Set<InetSocketAddress> {
        val out = HashSet<InetSocketAddress>()
        out.add(InetSocketAddress("255.255.255.255", UDP))
        try {
            for (ni in NetworkInterface.getNetworkInterfaces()) {
                if (!ni.isUp || ni.isLoopback) continue
                for (a in ni.interfaceAddresses) {
                    val b = a.broadcast ?: continue
                    out.add(InetSocketAddress(b, UDP))
                }
            }
        } catch (_: Exception) {}
        for (part in Prefs.extra(ctx).split(',', ';', ' ')) {
            val a = part.trim()
            if (a.isEmpty()) continue
            val host = a.substringBefore(':')
            val port = a.substringAfter(':', "").toIntOrNull() ?: UDP
            out.add(InetSocketAddress(host, port))
        }
        for (p in db.peers()) if (p.ip.isNotEmpty()) out.add(InetSocketAddress(p.ip, UDP))
        return out
    }

    fun beacon(ask: Boolean = false, bye: Boolean = false, to: InetSocketAddress? = null) {
        val s = udp ?: return
        val data = beaconBytes(ask, bye)
        for (t in (if (to != null) setOf(to) else targets())) {
            try { s.send(DatagramPacket(data, data.size, t)) } catch (_: Exception) {}
        }
    }

    private fun beaconLoop() {
        beacon(ask = true)
        var n = 0
        while (running) {
            Thread.sleep(4000)
            if (!running) break
            beacon()
            if (++n % 2 == 0) changed()       // обновить «в сети / не в сети»
        }
    }

    private fun udpLoop(s: DatagramSocket) {
        val buf = ByteArray(65535)
        while (running) {
            try {
                val p = DatagramPacket(buf, buf.size)
                s.receive(p)
                val env = JSONObject(String(p.data, 0, p.length, Charsets.UTF_8))
                val raw = env.getString("d")
                if (!MessageDigest.isEqual(env.getString("s").toByteArray(), sign(raw.toByteArray()).toByteArray())) continue
                val d = JSONObject(raw)
                if (d.optString("app") != "RafChat" || d.getString("id") == id) continue
                seen(d, p.address, p.port)
            } catch (e: Exception) {
                if (!running) break
            }
        }
    }

    private fun seen(d: JSONObject, addr: InetAddress, port: Int) {
        val pid = d.getString("id")
        val prev = db.peer(pid)
        val wasOnline = prev?.online == true
        if (d.optBoolean("bye")) {
            db.markOffline(pid)
            changed()
            return
        }
        db.upsertPeer(pid, d.optString("name", "?"), d.optString("dept", ""), addr.hostAddress ?: "",
            d.optInt("port", TCP), d.optString("plat", ""), System.currentTimeMillis())
        if (!wasOnline || d.optBoolean("ask")) {
            beacon(to = InetSocketAddress(addr, port))
            kick()
            changed()
        }
    }

    // ---------- сервер
    private fun acceptLoop(ss: ServerSocket) {
        while (running) {
            try {
                val s = ss.accept()
                thread(isDaemon = true) { handle(s) }
            } catch (e: Exception) {
                if (!running) break
            }
        }
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

    private fun handle(sock: Socket) {
        sock.use { s ->
            try {
                s.soTimeout = 60_000
                val inp = s.getInputStream().buffered(65536)
                val out = s.getOutputStream().buffered(65536)
                val first = readLine(inp) ?: return
                val parts = first.split(' ')
                if (parts.size < 2) return
                val method = parts[0]
                val target = parts[1]
                val h = HashMap<String, String>()
                while (true) {
                    val l = readLine(inp) ?: break
                    if (l.isEmpty()) break
                    val i = l.indexOf(':')
                    if (i > 0) h[l.substring(0, i).trim().lowercase()] = l.substring(i + 1).trim()
                }
                val len = h["content-length"]?.toIntOrNull() ?: 0
                if (len > 2_000_000) return
                val body = ByteArray(len)
                var off = 0
                while (off < len) {
                    val n = inp.read(body, off, len - off)
                    if (n < 0) return
                    off += n
                }
                if (!checkAuth(h["x-auth"], method, target, body)) return json(out, 401, JSONObject().put("error", "auth"))
                val path = target.substringBefore('?')
                val q = target.substringAfter('?', "").split('&').filter { it.contains('=') }
                    .associate { URLDecoder.decode(it.substringBefore('='), "UTF-8") to URLDecoder.decode(it.substringAfter('='), "UTF-8") }
                when {
                    method == "GET" && path == "/ping" -> json(out, 200, JSONObject().put("id", id).put("name", Prefs.name(ctx)))
                    method == "POST" && path == "/msg" -> {
                        receive(JSONObject(String(body, Charsets.UTF_8)))
                        json(out, 200, JSONObject().put("ok", true))
                    }
                    method == "GET" && path == "/file" -> sendFile(out, q["fid"] ?: "", h["range"])
                    else -> json(out, 404, JSONObject().put("error", "not_found"))
                }
                out.flush()
            } catch (e: Exception) {
                Log.w("RafChat", "request", e)
            }
        }
    }

    private fun head(out: OutputStream, code: Int, type: String, len: Long, extra: String = "") {
        val text = when (code) { 200 -> "OK"; 206 -> "Partial Content"; 401 -> "Unauthorized"; 404 -> "Not Found"; else -> "Error" }
        out.write("HTTP/1.1 $code $text\r\nContent-Type: $type\r\nContent-Length: $len\r\n${extra}Connection: close\r\n\r\n".toByteArray())
    }

    private fun json(out: OutputStream, code: Int, o: JSONObject) {
        val b = o.toString().toByteArray()
        head(out, code, "application/json; charset=utf-8", b.size.toLong())
        out.write(b)
    }

    private fun sendFile(out: OutputStream, fid: String, range: String?) {
        val f = db.filePath(fid)?.let { File(it) }
        if (f == null || !f.isFile) return json(out, 404, JSONObject().put("error", "not_found"))
        val size = f.length()
        val start = Regex("bytes=(\\d+)-").find(range ?: "")?.groupValues?.get(1)?.toLongOrNull() ?: 0L
        FileInputStream(f).use { inp ->
            if (start in 1 until size) {
                head(out, 206, "application/octet-stream", size - start, "Content-Range: bytes $start-${size - 1}/$size\r\n")
                var skip = start
                while (skip > 0) { val k = inp.skip(skip); if (k <= 0) break; skip -= k }
            } else head(out, 200, "application/octet-stream", size)
            inp.copyTo(out, 65536)
        }
    }

    // ---------- отправка
    /** Отправить текст и/или файл (файл уже лежит в памяти приложения). */
    fun send(chat: String, text: String, file: File? = null, fileName: String? = null): String {
        val mid = UUID.randomUUID().toString().replace("-", "")
        var meta: FileMeta? = null
        if (file != null) {
            val fid = UUID.randomUUID().toString().replace("-", "")
            db.addFile(fid, file.path)
            meta = FileMeta(fid, fileName ?: file.name, file.length())
        }
        val ts = System.currentTimeMillis()
        val targets = if (chat == ALL) db.peers().map { it.id } else listOf(chat)
        val status = if (chat == ALL) "0/${targets.size}" else "queued"
        db.insertMsg(Msg(mid, chat, id, Prefs.name(ctx), ts, text, meta, true, status, file?.path), false)
        val payload = JSONObject().put("id", mid).put("from", id).put("name", Prefs.name(ctx)).put("to", chat)
            .put("ts", ts).put("text", text).put("file", meta?.json() ?: JSONObject.NULL).toString()
        for (t in targets) db.addOutbox(t, mid, payload)
        changed()
        kick()
        return mid
    }

    private fun outboxLoop() {
        while (running) {
            synchronized(wake) { try { wake.wait(3000) } catch (_: InterruptedException) {} }
            if (!running) break
            val online = db.peers().filter { it.online }.associateBy { it.id }
            for ((peer, mid, payload) in db.outbox()) {
                val p = online[peer] ?: continue
                try {
                    val body = payload.toByteArray()
                    val c = URL("http://${p.ip}:${p.port}/msg").openConnection() as HttpURLConnection
                    c.connectTimeout = 5000
                    c.readTimeout = 10000
                    c.requestMethod = "POST"
                    c.doOutput = true
                    c.setRequestProperty("X-Auth", authHeader("POST", "/msg", body))
                    c.setRequestProperty("Content-Type", "application/json")
                    c.setFixedLengthStreamingMode(body.size)
                    c.outputStream.use { it.write(body) }
                    val code = c.responseCode
                    c.disconnect()
                    if (code != 200) continue
                } catch (e: Exception) {
                    continue
                }
                db.delOutbox(peer, mid)
                delivered(mid)
            }
        }
    }

    private fun delivered(mid: String) {
        val m = db.msg(mid) ?: return
        val st = if (m.chat == ALL && m.status.contains('/')) {
            val a = m.status.substringBefore('/').toIntOrNull() ?: 0
            "${a + 1}/${m.status.substringAfter('/')}"
        } else "delivered"
        db.setStatus(mid, st)
        changed()
    }

    // ---------- приём
    private fun receive(m: JSONObject) {
        val mid = m.getString("id")
        if (db.hasMsg(mid)) return
        val from = m.getString("from")
        val chat = if (m.optString("to") == ALL) ALL else from
        val meta = if (m.isNull("file")) null else FileMeta.of(m.optJSONObject("file")?.toString())
        val msg = Msg(mid, chat, from, m.optString("name", "?"), m.optLong("ts", System.currentTimeMillis()),
            m.optString("text", ""), meta, false, "received", null)
        db.insertMsg(msg, visibleChat != chat)
        changed()
        if (visibleChat != chat) Notify.message(ctx, msg)
        if (meta != null && meta.size <= AUTO) download(mid)
    }

    fun download(mid: String) {
        if (!downloading.add(mid)) return
        thread(isDaemon = true) {
            try { doDownload(mid) } finally { downloading.remove(mid); progress.remove(mid) }
        }
    }

    private fun doDownload(mid: String) {
        val m = db.msg(mid) ?: return
        val f = m.file ?: return
        if (m.local != null) return
        val part = File(ctx.cacheDir, "dl/$mid.part").apply { parentFile?.mkdirs() }
        repeat(40) {
            val p = db.peer(m.sender)
            if (p != null && p.online) {
                try {
                    var have = if (part.exists()) part.length() else 0L
                    val path = "/file?fid=" + f.fid
                    val c = URL("http://${p.ip}:${p.port}$path").openConnection() as HttpURLConnection
                    c.connectTimeout = 5000
                    c.readTimeout = 20000
                    c.setRequestProperty("X-Auth", authHeader("GET", path))
                    if (have > 0) c.setRequestProperty("Range", "bytes=$have-")
                    val code = c.responseCode
                    if (code == 404) {
                        db.setStatus(mid, "gone"); changed(); return
                    }
                    if (code == 200) have = 0
                    if (code == 200 || code == 206) {
                        c.inputStream.use { inp ->
                            FileOutputStream(part, have > 0).use { fo ->
                                val buf = ByteArray(65536)
                                var got = have
                                var last = 0L
                                while (true) {
                                    val n = inp.read(buf)
                                    if (n < 0) break
                                    fo.write(buf, 0, n)
                                    got += n
                                    if (System.currentTimeMillis() - last > 300) {
                                        last = System.currentTimeMillis()
                                        progress[mid] = got to f.size
                                        changed()
                                    }
                                }
                            }
                        }
                    }
                    c.disconnect()
                    if (part.length() >= f.size) {
                        db.setLocal(mid, saveToDownloads(part, f.name))
                        changed()
                        return
                    }
                } catch (_: Exception) {}
            }
            Thread.sleep(15000)
        }
    }

    /** Готовый файл → «Загрузки/RafChat». Возвращает адрес для открытия. */
    private fun saveToDownloads(part: File, name: String): String {
        val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase())
            ?: "application/octet-stream"
        if (Build.VERSION.SDK_INT >= 29) {
            val v = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                put(MediaStore.MediaColumns.MIME_TYPE, mime)
                put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/RafChat")
            }
            val uri = ctx.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v)
            if (uri != null) {
                ctx.contentResolver.openOutputStream(uri)?.use { o -> part.inputStream().use { it.copyTo(o) } }
                part.delete()
                return uri.toString()
            }
        }
        val dir = File(ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "RafChat").apply { mkdirs() }
        var dst = File(dir, name)
        var i = 2
        while (dst.exists()) { dst = File(dir, name.substringBeforeLast('.') + " ($i)." + name.substringAfterLast('.')); i++ }
        part.renameTo(dst)
        return dst.path
    }

    fun localIp(): String? = try {
        NetworkInterface.getNetworkInterfaces().toList().filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.toList() }.firstOrNull { it is Inet4Address && it.isSiteLocalAddress }?.hostAddress
    } catch (e: Exception) { null }
}
