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
    const val RELAY_ONLINE_MS = 75_000L
    const val RELAY_FILE_MAX = 50L * 1024 * 1024
    const val AUTO = 50L * 1024 * 1024
    const val TASK_NEW = "Новое"
    const val TASK_WORK = "В работе"
    const val TASK_DONE = "Готово"
    const val TASK_OK = "Принято ОТК"
    const val TASK_REWORK = "Доработка"
    const val ACTION_CHANGED = "ru.sharapov.rafchat.CHANGED"

    lateinit var ctx: Context
    lateinit var db: Store
    lateinit var id: String

    @Volatile var running = false
    @Volatile var visibleChat: String? = null
    private var key = ByteArray(0)
    private var ekey = ByteArray(0)
    private var orgId = ""
    /** null — сервер не задан, true/false — есть ли с ним связь */
    @Volatile var relayOk: Boolean? = null
    private val relayUploaded = ConcurrentHashMap.newKeySet<String>()
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
        val org = Prefs.org(ctx).trim()
        key = sha256(("RafChat:" + org).toByteArray())
        // шифрование «от устройства до устройства» для сервера: сервер видит только шифротекст
        ekey = sha256(("RafChat-e2e:" + org).toByteArray())
        orgId = hex(sha256(("RafChat-org:" + org).toByteArray())).take(32)
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
        thread(name = "rc-ping", isDaemon = true) { pingLoop() }
        try { dropSelfGhosts() } catch (_: Exception) {}
        Prefs.relayAlt(ctx).let { (p, t) -> if (p > 0) { altPort = p; altTls = t } }
        thread(name = "rc-relay", isDaemon = true) { relayLoop() }
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
            .put("srv", Prefs.server(ctx)).put("srvt", Prefs.serverT(ctx)).put("avh", Prefs.avh(ctx))
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

    fun profile(): JSONObject = JSONObject().put("app", "RafChat").put("id", id).put("name", Prefs.name(ctx))
        .put("dept", Prefs.dept(ctx)).put("port", TCP).put("plat", "android").put("srv", Prefs.server(ctx))
        .put("srvt", Prefs.serverT(ctx)).put("avh", Prefs.avh(ctx))

    // ---------- фото профиля
    fun myAvatar() = File(ctx.filesDir, "avatar.jpg")
    fun avatarFile(pid: String): File? = File(ctx.filesDir, "avatars/$pid.jpg").takeIf { it.isFile }
    private val avLoading = java.util.Collections.synchronizedSet(HashSet<String>())
    private val avFail = java.util.concurrent.ConcurrentHashMap<String, Long>()

    /** Своё фото (null — убрать). */
    fun setAvatar(jpeg: ByteArray?) {
        if (jpeg != null) {
            myAvatar().writeBytes(jpeg)
            val h = java.security.MessageDigest.getInstance("MD5").digest(jpeg).joinToString("") { "%02x".format(it) }
            Prefs.setAvh(ctx, h)
        } else {
            myAvatar().delete()
            Prefs.setAvh(ctx, "")
        }
        if (running) thread(isDaemon = true) { beacon() }
        changed()
    }

    /** У коллеги новое фото — скачать (напрямую по сети или с сервера). */
    private fun checkAvatar(pid: String, avh: String, ip: String?, port: Int) {
        if (avh.isEmpty() || avLoading.contains(avh) || System.currentTimeMillis() - (avFail[avh] ?: 0L) < 120_000) return
        if (db.peer(pid)?.avh == avh && avatarFile(pid) != null) return
        avLoading.add(avh)
        thread(isDaemon = true) {
            var data: ByteArray? = null
            try {
                if (!ip.isNullOrEmpty()) {
                    val c = URL("http://$ip:$port/avatar").openConnection() as HttpURLConnection
                    c.connectTimeout = 4000; c.readTimeout = 6000
                    c.setRequestProperty("X-Auth", authHeader("GET", "/avatar"))
                    if (c.responseCode == 200) data = c.inputStream.use { it.readBytes() }
                    c.disconnect()
                }
            } catch (_: Exception) {}
            if (data == null && serverAddr() != null) data = try {
                dec(relayCall("GET", "/r/file?fid=$avh", null, false, 20_000))
            } catch (_: Exception) { null }
            if (data != null) {
                File(ctx.filesDir, "avatars").mkdirs()
                File(ctx.filesDir, "avatars/$pid.jpg").writeBytes(data)
                db.setAvh(pid, avh)
                changed()
            } else avFail[avh] = System.currentTimeMillis()
            avLoading.remove(avh)
        }
    }

    private fun mergeDupes(pid: String) {
        val gone = db.mergeDupes(pid)
        for (old in gone) { avatarFile(old)?.delete(); Prefs.setHidden(ctx, old, true) }
        if (gone.isNotEmpty()) changed()
    }

    /** Убрать уже сохранённые прежние установки себя (то же имя и отдел, не в сети). */
    fun dropSelfGhosts() {
        val me = Prefs.name(ctx).trim(); val dep = Prefs.dept(ctx).trim()
        for (p in db.peers()) if (!p.online && p.name.trim().equals(me, true) && p.dept.trim().equals(dep, true)) {
            db.deleteChat(p.id); Prefs.setHidden(ctx, p.id, true)
        }
    }

    fun deleteChat(key: String) {
        db.deleteChat(key)
        if (key != ALL) { avatarFile(key)?.delete(); Prefs.setHidden(ctx, key, true) }
        changed()
    }

    /** Адрес сервера расходится сам: если у нас он не задан, а у коллеги из нашей организации есть — берём. */
    private fun adoptServer(srv: String, srvt: Long) {
        val mine = Prefs.server(ctx).trim()
        if (srv.isNotBlank() && (mine.isEmpty() || (srv.trim() != mine && srvt > Prefs.serverT(ctx)))) {
            Prefs.adoptServer(ctx, srv, srvt)          // сервер сменили (например, перенесли в Россию) — берём новый
            altPort = null; altTls = false
            changed()
        }
    }

    /** Запомнить участника (маяк, сообщение или ответ на /ping). Возвращает true, если он только что появился в сети. */
    @Synchronized
    private fun upsert(d: JSONObject, ip: String): Boolean {
        adoptServer(d.optString("srv", ""), d.optDouble("srvt", 0.0).toLong())
        val pid = d.getString("id")
        val prev = db.peer(pid)
        val wasOnline = prev?.lan == true
        db.upsertPeer(
            pid,
            d.optString("name", "").ifEmpty { prev?.name ?: "?" },
            if (d.has("dept")) d.optString("dept", "") else prev?.dept ?: "",
            ip,
            d.optInt("port", TCP),
            d.optString("plat", "").ifEmpty { prev?.plat ?: "" },
            System.currentTimeMillis()
        )
        if (prev == null) { mergeDupes(pid); catchUp(pid) }
        checkAvatar(pid, d.optString("avh", ""), ip, d.optInt("port", TCP))
        if (!wasOnline) { kick(); changed() }
        return !wasOnline
    }

    /** Новый участник: дослать ему мои сообщения «Общего чата» за последние сутки. */
    private fun catchUp(pid: String) {
        val since = System.currentTimeMillis() - 86_400_000L
        for (m in db.history(ALL, 500)) {
            if (!m.mine || m.ts < since) continue
            val payload = JSONObject().put("id", m.id).put("from", id).put("name", Prefs.name(ctx)).put("to", ALL)
                .put("ts", m.ts).put("text", m.text).put("file", m.file?.json() ?: JSONObject.NULL).put("port", TCP)
            m.replyObj?.let { payload.put("reply", it) }
            m.taskObj?.let { payload.put("task", it) }
            db.addOutbox(pid, m.id, payload.toString())
            if (m.status.contains('/')) {
                val b = m.status.substringAfter('/').toIntOrNull() ?: 0
                db.setStatus(m.id, m.status.substringBefore('/') + "/" + (b + 1))
            }
        }
    }

    private fun seen(d: JSONObject, addr: InetAddress, port: Int) {
        val pid = d.getString("id")
        if (d.optBoolean("bye")) {
            db.markOffline(pid)
            changed()
            return
        }
        val cameOnline = upsert(d, addr.hostAddress ?: "")
        if (cameOnline || d.optBoolean("ask")) beacon(to = InetSocketAddress(addr, port))
    }

    /** Запасной путь, если маяки (UDP) где-то режутся: спрашиваем известные адреса по TCP «ты тут?». */
    private fun pingLoop() {
        while (running) {
            Thread.sleep(6000)
            if (!running) break
            val targets = HashSet<Pair<String, Int>>()
            for (p in db.peers()) if (p.ip.isNotEmpty() && System.currentTimeMillis() - p.lastSeen > 8000) targets.add(p.ip to p.port)
            for (part in Prefs.extra(ctx).split(',', ';', ' ')) {
                val a = part.trim()
                if (a.isEmpty()) continue
                val host = a.substringBefore(':')
                val port = a.substringAfter(':', "").toIntOrNull()?.plus(1) ?: TCP
                targets.add(host to port)
            }
            for ((ip, port) in targets) thread(isDaemon = true) { ping(ip, port) }
        }
    }

    private fun ping(ip: String, port: Int) {
        try {
            val c = URL("http://$ip:$port/ping").openConnection() as HttpURLConnection
            c.connectTimeout = 3000
            c.readTimeout = 3000
            c.setRequestProperty("X-Auth", authHeader("GET", "/ping"))
            if (c.responseCode == 200) {
                val d = JSONObject(c.inputStream.bufferedReader().readText())
                if (d.optString("id").isNotEmpty() && d.getString("id") != id) upsert(d, ip)
            }
            c.disconnect()
        } catch (_: Exception) {}
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
                    method == "GET" && path == "/ping" -> json(out, 200, profile())
                    method == "GET" && path == "/avatar" -> {
                        val f = myAvatar()
                        if (!f.isFile) json(out, 404, JSONObject().put("error", "not_found"))
                        else { val b = f.readBytes(); head(out, 200, "image/jpeg", b.size.toLong()); out.write(b) }
                    }
                    method == "POST" && path == "/msg" -> {
                        receive(JSONObject(String(body, Charsets.UTF_8)), s.inetAddress.hostAddress ?: "")
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
    fun send(chat: String, text: String, file: File? = null, fileName: String? = null,
             reply: JSONObject? = null, task0: JSONObject? = null): String {
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
        val task = task0?.let { JSONObject(it.toString()).put("status", it.optString("status").ifEmpty { TASK_NEW })
            .put("by", Prefs.name(ctx)).put("at", ts) }
        db.insertMsg(Msg(mid, chat, id, Prefs.name(ctx), ts, text, meta, true, status, file?.path,
            reply?.toString(), task?.toString()), false)
        val pj = JSONObject().put("id", mid).put("from", id).put("name", Prefs.name(ctx)).put("to", chat)
            .put("ts", ts).put("text", text).put("file", meta?.json() ?: JSONObject.NULL).put("port", TCP)
        if (reply != null) pj.put("reply", reply)
        if (task != null) pj.put("task", task)
        val payload = pj.toString()
        for (t in targets) db.addOutbox(t, mid, payload)
        changed()
        kick()
        return mid
    }

    /** Сменить статус задания — у себя и у всех, кому оно было отправлено. */
    fun taskUpdate(mid: String, st: String) {
        val m = db.msg(mid) ?: return
        val t = m.taskObj ?: return
        val ts = System.currentTimeMillis()
        t.put("status", st).put("by", Prefs.name(ctx)).put("at", ts)
        db.setTask(mid, t.toString())
        changed()
        val uid = UUID.randomUUID().toString().replace("-", "")
        // старые версии и iPhone увидят это как обычное сообщение
        val upd = JSONObject().put("id", uid).put("from", id).put("name", Prefs.name(ctx)).put("to", m.chat).put("ts", ts)
            .put("type", "task").put("task_id", mid).put("status", st).put("port", TCP).put("file", JSONObject.NULL)
            .put("text", "📋 «${t.optString("title")}» — $st").toString()
        val targets = if (m.chat == ALL) db.peers().map { it.id } else listOf(m.chat)
        for (x in targets) db.addOutbox(x, uid, upd)
        kick()
    }

    private fun outboxLoop() {
        while (running) {
            synchronized(wake) { try { wake.wait(3000) } catch (_: InterruptedException) {} }
            if (!running) break
            val online = db.peers().filter { it.lan }.associateBy { it.id }
            val relay = serverAddr() != null
            for ((peer, mid, payload) in db.outbox()) {
                val p = online[peer]
                if (p == null) {
                    if (relay && relayDeliver(peer, payload)) {          // не в одной сети — через сервер
                        db.delOutbox(peer, mid)
                        viaRelay(mid)
                    }
                    continue
                }
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

    private fun viaRelay(mid: String) {
        val m = db.msg(mid) ?: return
        if (m.chat == ALL) return delivered(mid)
        if (m.status != "delivered") { db.setStatus(mid, "relay"); changed() }
    }

    // ---------- сервер-ретранслятор (работа через интернет)
    fun serverAddr(): Pair<String, Int>? {
        val s = Prefs.server(ctx).trim().removePrefix("http://").trimEnd('/')
        if (s.isEmpty()) return null
        return s.substringBefore(':') to (altPort ?: s.substringAfter(':', "").toIntOrNull() ?: 47888)
    }

    @Volatile private var altPort: Int? = null
    @Volatile private var altTls = false

    /** Соединение с сервером; по TLS — без проверки сертификата (он у сервера свой, самоподписанный;
     *  переписка всё равно зашифрована ключом организации). */
    private fun relayConn(host: String, port: Int, tls: Boolean, path: String): HttpURLConnection {
        if (!tls) return URL("http://$host:$port$path").openConnection() as HttpURLConnection
        val c = URL("https://$host:$port$path").openConnection() as javax.net.ssl.HttpsURLConnection
        c.sslSocketFactory = trustAll
        c.hostnameVerifier = javax.net.ssl.HostnameVerifier { _, _ -> true }
        return c
    }

    private val trustAll: javax.net.ssl.SSLSocketFactory by lazy {
        val tm = object : javax.net.ssl.X509TrustManager {
            override fun checkClientTrusted(chain: Array<java.security.cert.X509Certificate>?, authType: String?) {}
            override fun checkServerTrusted(chain: Array<java.security.cert.X509Certificate>?, authType: String?) {}
            override fun getAcceptedIssuers(): Array<java.security.cert.X509Certificate> = arrayOf()
        }
        javax.net.ssl.SSLContext.getInstance("TLS").apply { init(null, arrayOf(tm), java.security.SecureRandom()) }.socketFactory
    }
    private var probeAt = 0L

    /** Основной порт сервера не отвечает (мобильный интернет режет нестандартные порты) —
     *  пробуем запасные «веб-порты» и запоминаем первый рабочий. */
    private fun probePorts() {
        if (System.currentTimeMillis() - probeAt < 30_000) return
        probeAt = System.currentTimeMillis()
        val s = Prefs.server(ctx).trim().removePrefix("http://").trimEnd('/')
        if (s.isEmpty()) return
        val host = s.substringBefore(':')
        val main = s.substringAfter(':', "").toIntOrNull() ?: 47888
        // сначала основной, затем шифрованные (TLS) — их мобильные операторы не вырезают, затем веб-порты
        val cand = listOf(main to false) + listOf(2053, 2083, 2087, 9443).map { it to true } + listOf(80 to false, 8080 to false)
        for ((p, tls) in cand) {
            val ok = try {
                val c = relayConn(host, p, tls, "/")
                c.connectTimeout = 6000; c.readTimeout = 6000
                val body = if (c.responseCode == 200) c.inputStream.bufferedReader().readText() else ""
                c.disconnect()
                body.contains("RafChat Relay")
            } catch (e: Exception) { false }
            if (ok) {
                altPort = if (p == main) null else p; altTls = tls && p != main
                Prefs.setRelayAlt(ctx, altPort ?: 0, altTls)        // после перезапуска — сразу через рабочий порт
                return
            }
        }
    }

    fun enc(data: ByteArray): ByteArray {
        val n = ByteArray(12).also { java.security.SecureRandom().nextBytes(it) }
        val c = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
        c.init(javax.crypto.Cipher.ENCRYPT_MODE, SecretKeySpec(ekey, "AES"), javax.crypto.spec.GCMParameterSpec(128, n))
        return n + c.doFinal(data)
    }

    fun dec(blob: ByteArray): ByteArray {
        val c = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
        c.init(javax.crypto.Cipher.DECRYPT_MODE, SecretKeySpec(ekey, "AES"),
            javax.crypto.spec.GCMParameterSpec(128, blob.copyOfRange(0, 12)))
        return c.doFinal(blob, 12, blob.size - 12)
    }

    private fun b64(b: ByteArray) = android.util.Base64.encodeToString(b, android.util.Base64.NO_WRAP)
    private fun unb64(s: String) = android.util.Base64.decode(s, android.util.Base64.DEFAULT)

    private fun relayCall(method: String, path: String, body: ByteArray? = null, json: Boolean = true, timeout: Int = 15000): ByteArray {
        val (host, port) = serverAddr() ?: throw java.io.IOException("нет сервера")
        val c = relayConn(host, port, altTls && altPort != null, path)
        c.connectTimeout = 8000
        c.readTimeout = timeout
        c.requestMethod = method
        c.setRequestProperty("X-Org", orgId)
        c.setRequestProperty("X-Node", id)
        try {
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", if (json) "application/json" else "application/octet-stream")
                c.setFixedLengthStreamingMode(body.size)
                c.outputStream.use { it.write(body) }
            }
            if (c.responseCode != 200) throw java.io.IOException("сервер ответил ${c.responseCode}")
            return c.inputStream.use { it.readBytes() }
        } finally { c.disconnect() }
    }

    private fun relayJson(method: String, path: String, body: JSONObject? = null, timeout: Int = 15000): JSONObject =
        JSONObject(String(relayCall(method, path, body?.toString()?.toByteArray(), true, timeout), Charsets.UTF_8).ifEmpty { "{}" })

    private fun relaySend(to: String, m: JSONObject): Boolean = try {
        relayJson("POST", "/r/send", JSONObject().put("to", to).put("blob", b64(enc(m.toString().toByteArray()))))
        true
    } catch (e: Exception) { false }

    private fun relayDeliver(to: String, payload: String): Boolean {
        val m = JSONObject(payload)
        val f = m.optJSONObject("file")
        if (f != null && !f.optBoolean("relay") && f.optLong("size") <= RELAY_FILE_MAX) {
            val fid = f.getString("fid")
            if (!relayUploaded.contains(fid)) {                 // файл — на сервер (зашифрованным)
                val path = db.filePath(fid)
                if (path != null && File(path).isFile) {
                    try {
                        relayCall("PUT", "/r/file?fid=$fid", enc(File(path).readBytes()), false, 300_000)
                        relayUploaded.add(fid)
                    } catch (e: Exception) { return false }
                }
            }
            if (relayUploaded.contains(fid)) f.put("relay", true)
        }
        return relaySend(to, m)
    }

    private fun relayHello() {
        val avh = Prefs.avh(ctx)
        if (avh.isNotEmpty() && myAvatar().isFile && System.currentTimeMillis() - Prefs.avhUp(ctx) > 86_400_000L) {
            try {   // сервер хранит файлы 3 дня — обновляем фото раз в сутки
                relayCall("PUT", "/r/file?fid=$avh", enc(myAvatar().readBytes()), false, 60_000)
                Prefs.setAvhUp(ctx, System.currentTimeMillis())
            } catch (_: Exception) {}
        }
        val r = relayJson("POST", "/r/hello", JSONObject().put("profile", b64(enc(profile().toString().toByteArray()))))
        val now = r.optDouble("now", System.currentTimeMillis() / 1000.0)
        val arr = r.optJSONArray("peers") ?: return
        for (i in 0 until arr.length()) {
            val p = arr.getJSONObject(i)
            val d = try { JSONObject(String(dec(unb64(p.getString("profile"))), Charsets.UTF_8)) } catch (e: Exception) { continue }
            if (d.optString("id") != p.getString("id") || d.optString("id") == id) continue
            val seen = System.currentTimeMillis() - ((now - p.optDouble("last", 0.0)) * 1000).toLong()
            upsertRelay(d, seen)
        }
    }

    private fun upsertRelay(d: JSONObject, seen: Long) {
        adoptServer(d.optString("srv", ""), d.optDouble("srvt", 0.0).toLong())
        val pid = d.getString("id")
        val prev = db.peer(pid)
        val nowOnline = System.currentTimeMillis() - seen < RELAY_ONLINE_MS
        // сервер помнит устройства 60 дней: старые установки и удалённые чаты не показываем, пока не выйдут на связь
        if (prev == null && !nowOnline &&
            (pid in Prefs.hidden(ctx) || System.currentTimeMillis() - seen > 3 * 86_400_000L)) return
        // прежняя установка этого же телефона (то же имя и отдел, что у меня) — не показываем
        if (prev == null && !nowOnline &&
            d.optString("name").trim().equals(Prefs.name(ctx).trim(), true) &&
            d.optString("dept").trim().equals(Prefs.dept(ctx).trim(), true)) return
        if (nowOnline) Prefs.setHidden(ctx, pid, false)
        val wasOnline = prev?.online == true
        val isNew = db.upsertRelay(pid, d.optString("name", "").ifEmpty { null },
            if (d.has("dept")) d.optString("dept") else null, d.optString("plat", ""), seen)
        if (isNew) { if (nowOnline) mergeDupes(pid); catchUp(pid) }
        checkAvatar(pid, d.optString("avh", ""), null, TCP)
        if (!wasOnline && System.currentTimeMillis() - seen < RELAY_ONLINE_MS) { kick(); changed() }
    }

    private fun relayLoop() {
        var lastHello = 0L
        while (running) {
            if (serverAddr() == null) { relayOk = null; Thread.sleep(3000); continue }
            try {
                if (System.currentTimeMillis() - lastHello > 20_000) {
                    relayHello()
                    lastHello = System.currentTimeMillis()
                    if (relayOk != true) { relayOk = true; kick(); changed() }
                }
                val items = relayJson("GET", "/r/poll?wait=25", null, 40_000).optJSONArray("items")
                val acks = org.json.JSONArray()
                if (items != null) for (i in 0 until items.length()) {
                    val it = items.getJSONObject(i)
                    acks.put(it.getString("qid"))
                    val m = try { JSONObject(String(dec(unb64(it.getString("blob"))), Charsets.UTF_8)) } catch (e: Exception) { continue }
                    relayItem(m)
                }
                if (acks.length() > 0) relayJson("POST", "/r/ack", JSONObject().put("qids", acks))
            } catch (e: Exception) {
                if (relayOk != false) { relayOk = false; changed() }
                probePorts()
                if (running) Thread.sleep(5000)
            }
        }
    }

    private fun relayItem(m: JSONObject) {
        if (m.optString("type") == "ack") {                  // получатель подтвердил — ✓✓
            val mine = db.msg(m.optString("id"))
            if (mine != null && mine.mine && mine.chat != ALL) { db.setStatus(mine.id, "delivered"); changed() }
            return
        }
        val from = m.optString("from")
        if (m.optString("id").isEmpty() || from.isEmpty() || from == id) return
        receive(m, "")
        relaySend(from, JSONObject().put("type", "ack").put("id", m.getString("id")).put("from", id))
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
    private fun receive(m: JSONObject, ip: String) {
        val mid = m.getString("id")
        val from = m.getString("from")
        if (from != id) {
            val d = JSONObject().put("id", from).put("name", m.optString("name", "")).put("port", m.optInt("port", TCP))
            // пришло сообщение — значит, отправитель на связи (по сети или через сервер)
            if (ip.isNotEmpty()) upsert(d, ip) else upsertRelay(d, System.currentTimeMillis())
        }
        if (m.optString("type") == "task") {                 // коллега сменил статус задания
            val tm = db.msg(m.optString("task_id")) ?: return
            val t = tm.taskObj ?: return
            if (m.optLong("ts") >= t.optLong("at")) {
                t.put("status", m.optString("status")).put("by", m.optString("name", "?")).put("at", m.optLong("ts"))
                db.setTask(tm.id, t.toString())
                changed()
                if (visibleChat != tm.chat) Notify.message(ctx, Msg(tm.id, tm.chat, from, "📋 " + t.optString("title"),
                    m.optLong("ts"), m.optString("name", "?") + ": " + m.optString("status"), null, false, "", null))
            }
            return
        }
        if (db.hasMsg(mid)) return
        val chat = if (m.optString("to") == ALL) ALL else from
        val meta = if (m.isNull("file")) null else FileMeta.of(m.optJSONObject("file")?.toString())
        val msg = Msg(mid, chat, from, m.optString("name", "?"), m.optLong("ts", System.currentTimeMillis()),
            m.optString("text", ""), meta, false, "received", null,
            m.optJSONObject("reply")?.toString(), m.optJSONObject("task")?.toString())
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
            if ((p == null || !p.lan) && f.relay && serverAddr() != null) {
                try {                                         // отправитель не в нашей сети — берём копию с сервера
                    val data = dec(relayCall("GET", "/r/file?fid=" + f.fid, null, true, 300_000))
                    part.writeBytes(data)
                    db.setLocal(mid, saveToDownloads(part, f.name))
                    changed()
                    return
                } catch (_: Exception) {}
            }
            if (p != null && p.lan) {
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
