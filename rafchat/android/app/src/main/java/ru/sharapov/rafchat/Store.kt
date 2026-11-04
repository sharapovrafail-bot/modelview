package ru.sharapov.rafchat

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject

data class Peer(
    val id: String, val name: String, val dept: String, val ip: String, val port: Int,
    val plat: String, val lastSeen: Long, val relaySeen: Long = 0, val avh: String = "",
) {
    /** в одной сети (напрямую) */
    val lan get() = ip.isNotEmpty() && System.currentTimeMillis() - lastSeen < Node.ONLINE_MS
    /** на связи через сервер (интернет) */
    val relay get() = System.currentTimeMillis() - relaySeen < Node.RELAY_ONLINE_MS
    val online get() = lan || relay
    val title get() = if (dept.isNotEmpty()) "$name · $dept" else name
}

/** relay — копия файла лежит на сервере (можно скачать, даже если отправитель не в нашей сети). */
data class FileMeta(val fid: String, val name: String, val size: Long, val relay: Boolean = false) {
    fun json(): JSONObject = JSONObject().put("fid", fid).put("name", name).put("size", size)
        .apply { if (relay) put("relay", true) }

    companion object {
        fun of(s: String?): FileMeta? = if (s.isNullOrEmpty() || s == "null") null else try {
            val o = JSONObject(s)
            FileMeta(o.getString("fid"), o.getString("name"), o.getLong("size"), o.optBoolean("relay"))
        } catch (e: Exception) { null }
    }
}

data class Msg(
    val id: String, val chat: String, val sender: String, val senderName: String, val ts: Long,
    val text: String, val file: FileMeta?, val mine: Boolean, val status: String, val local: String?,
    /** ответ на сообщение {id,name,text} и карточка задания (JSON) */
    val reply: String? = null, val task: String? = null,
) {
    val replyObj get() = reply?.let { try { JSONObject(it) } catch (e: Exception) { null } }
    val taskObj get() = task?.let { try { JSONObject(it) } catch (e: Exception) { null } }
}

/** Переписка и участники — та же схема, что в программе для ПК. */
class Store(ctx: Context) : SQLiteOpenHelper(ctx, "rafchat.db", null, 4) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE peers(id TEXT PRIMARY KEY, name TEXT, dept TEXT, ip TEXT, port INT, plat TEXT, last_seen INT, relay_seen INT DEFAULT 0, avh TEXT)")
        db.execSQL("CREATE TABLE messages(id TEXT PRIMARY KEY, chat TEXT, sender TEXT, sender_name TEXT, ts INT, " +
            "text TEXT, file TEXT, mine INT, status TEXT, local TEXT, unread INT DEFAULT 0, reply TEXT, task TEXT)")
        db.execSQL("CREATE INDEX msg_chat ON messages(chat, ts)")
        db.execSQL("CREATE TABLE outbox(peer TEXT, msg_id TEXT, payload TEXT, PRIMARY KEY(peer, msg_id))")
        db.execSQL("CREATE TABLE files(fid TEXT PRIMARY KEY, path TEXT)")
    }

    override fun onUpgrade(db: SQLiteDatabase, o: Int, n: Int) {
        if (o < 2) db.execSQL("ALTER TABLE peers ADD COLUMN relay_seen INT DEFAULT 0")
        if (o < 3) db.execSQL("ALTER TABLE peers ADD COLUMN avh TEXT")
        if (o < 4) {
            db.execSQL("ALTER TABLE messages ADD COLUMN reply TEXT")
            db.execSQL("ALTER TABLE messages ADD COLUMN task TEXT")
        }
    }

    @Synchronized
    fun upsertPeer(id: String, name: String, dept: String, ip: String, port: Int, plat: String, seen: Long) {
        val v = ContentValues().apply {
            put("name", name); put("dept", dept); put("ip", ip); put("port", port)
            put("plat", plat); put("last_seen", seen)
        }
        if (writableDatabase.update("peers", v, "id=?", arrayOf(id)) == 0) {
            v.put("id", id)
            writableDatabase.insert("peers", null, v)
        }
    }

    /** Участник на связи через сервер: адрес в сети не трогаем. */
    @Synchronized
    fun upsertRelay(id: String, name: String?, dept: String?, plat: String, seen: Long): Boolean {
        val exists = writableDatabase.rawQuery("SELECT 1 FROM peers WHERE id=?", arrayOf(id)).use { it.moveToFirst() }
        if (exists) {
            writableDatabase.execSQL(
                "UPDATE peers SET name=COALESCE(?,name), dept=COALESCE(?,dept), relay_seen=MAX(relay_seen,?) WHERE id=?",
                arrayOf(name, dept, seen, id)
            )
        } else {
            val v = ContentValues().apply {
                put("id", id); put("name", name ?: "?"); put("dept", dept ?: ""); put("ip", ""); put("port", Node.TCP)
                put("plat", plat); put("last_seen", 0); put("relay_seen", seen)
            }
            writableDatabase.insert("peers", null, v)
        }
        return !exists
    }

    @Synchronized
    fun markOffline(id: String) {
        writableDatabase.execSQL("UPDATE peers SET last_seen=0 WHERE id=?", arrayOf(id))
    }

    @Synchronized
    fun peers(): List<Peer> {
        val out = ArrayList<Peer>()
        readableDatabase.rawQuery("SELECT id,name,dept,ip,port,plat,last_seen,relay_seen,avh FROM peers", null).use { c ->
            while (c.moveToNext()) out.add(
                Peer(c.getString(0), c.getString(1) ?: "?", c.getString(2) ?: "", c.getString(3) ?: "",
                    c.getInt(4), c.getString(5) ?: "", c.getLong(6), c.getLong(7), c.getString(8) ?: "")
            )
        }
        return out
    }

    fun peer(id: String) = peers().firstOrNull { it.id == id }

    /** Тот же человек с нового устройства: старые записи с тем же именем и отделом, которые не в сети,
     *  склеиваем с новой (переписка переезжает). Возвращает id склеенных. */
    @Synchronized
    fun mergeDupes(pid: String): List<String> {
        val me = peers().firstOrNull { it.id == pid } ?: return emptyList()
        if (me.name.isBlank() || me.name == "?") return emptyList()
        val out = ArrayList<String>()
        for (p in peers()) {
            if (p.id == pid || p.online) continue
            if (p.name.trim().lowercase() != me.name.trim().lowercase() || p.dept.trim().lowercase() != me.dept.trim().lowercase()) continue
            writableDatabase.execSQL("UPDATE messages SET chat=? WHERE chat=?", arrayOf(pid, p.id))
            writableDatabase.execSQL("UPDATE OR IGNORE outbox SET peer=? WHERE peer=?", arrayOf(pid, p.id))
            writableDatabase.execSQL("DELETE FROM outbox WHERE peer=?", arrayOf(p.id))
            writableDatabase.execSQL("DELETE FROM peers WHERE id=?", arrayOf(p.id))
            out.add(p.id)
        }
        return out
    }

    @Synchronized
    fun setAvh(id: String, avh: String) =
        writableDatabase.execSQL("UPDATE peers SET avh=? WHERE id=?", arrayOf(avh, id))

    /** Удалить чат: переписку и очередь; личный — вместе с участником (вернётся, если снова появится в сети). */
    @Synchronized
    fun deleteChat(key: String) {
        writableDatabase.execSQL("DELETE FROM messages WHERE chat=?", arrayOf(key))
        if (key != Node.ALL) {
            writableDatabase.execSQL("DELETE FROM outbox WHERE peer=?", arrayOf(key))
            writableDatabase.execSQL("DELETE FROM peers WHERE id=?", arrayOf(key))
        }
    }

    @Synchronized
    fun hasMsg(id: String): Boolean =
        readableDatabase.rawQuery("SELECT 1 FROM messages WHERE id=?", arrayOf(id)).use { it.moveToFirst() }

    @Synchronized
    fun insertMsg(m: Msg, unread: Boolean) {
        val v = ContentValues().apply {
            put("id", m.id); put("chat", m.chat); put("sender", m.sender); put("sender_name", m.senderName)
            put("ts", m.ts); put("text", m.text); put("file", m.file?.json()?.toString()); put("mine", if (m.mine) 1 else 0)
            put("status", m.status); put("local", m.local); put("unread", if (unread) 1 else 0)
            put("reply", m.reply); put("task", m.task)
        }
        writableDatabase.insertWithOnConflict("messages", null, v, SQLiteDatabase.CONFLICT_IGNORE)
    }

    @Synchronized
    fun setStatus(id: String, st: String) =
        writableDatabase.execSQL("UPDATE messages SET status=? WHERE id=?", arrayOf(st, id))

    @Synchronized
    fun setLocal(id: String, local: String) =
        writableDatabase.execSQL("UPDATE messages SET local=? WHERE id=?", arrayOf(local, id))

    private fun row(c: android.database.Cursor) = Msg(
        c.getString(0), c.getString(1), c.getString(2), c.getString(3) ?: "?", c.getLong(4), c.getString(5) ?: "",
        FileMeta.of(c.getString(6)), c.getInt(7) == 1, c.getString(8) ?: "", c.getString(9),
        c.getString(10), c.getString(11)
    )

    private val cols = "id,chat,sender,sender_name,ts,text,file,mine,status,local,reply,task"

    @Synchronized
    fun setTask(id: String, task: String) =
        writableDatabase.execSQL("UPDATE messages SET task=? WHERE id=?", arrayOf(task, id))

    /** Поиск по всей переписке (без учёта регистра, в том числе по-русски). */
    @Synchronized
    fun search(q: String, limit: Int = 100): List<Msg> {
        val out = ArrayList<Msg>()
        val k = q.lowercase()
        readableDatabase.rawQuery("SELECT $cols FROM messages ORDER BY ts DESC LIMIT 5000", null).use {
            while (it.moveToNext() && out.size < limit) {
                val m = row(it)
                val hay = (m.text + " " + (m.file?.name ?: "") + " " + (m.task ?: "") + " " + m.senderName).lowercase()
                if (hay.contains(k)) out.add(m)
            }
        }
        return out
    }

    @Synchronized
    fun tasks(limit: Int = 200): List<Msg> {
        val out = ArrayList<Msg>()
        readableDatabase.rawQuery("SELECT $cols FROM messages WHERE task IS NOT NULL ORDER BY ts DESC LIMIT $limit", null)
            .use { while (it.moveToNext()) out.add(row(it)) }
        return out
    }

    @Synchronized
    fun msg(id: String): Msg? =
        readableDatabase.rawQuery("SELECT $cols FROM messages WHERE id=?", arrayOf(id)).use {
            if (it.moveToFirst()) row(it) else null
        }

    @Synchronized
    fun history(chat: String, limit: Int = 300): List<Msg> {
        val out = ArrayList<Msg>()
        readableDatabase.rawQuery(
            "SELECT $cols FROM messages WHERE chat=? ORDER BY ts DESC LIMIT $limit", arrayOf(chat)
        ).use { while (it.moveToNext()) out.add(row(it)) }
        return out.reversed()
    }

    @Synchronized
    fun last(chat: String): Msg? =
        readableDatabase.rawQuery("SELECT $cols FROM messages WHERE chat=? ORDER BY ts DESC LIMIT 1", arrayOf(chat))
            .use { if (it.moveToFirst()) row(it) else null }

    @Synchronized
    fun unread(chat: String): Int =
        readableDatabase.rawQuery("SELECT COUNT(*) FROM messages WHERE chat=? AND unread=1", arrayOf(chat))
            .use { if (it.moveToFirst()) it.getInt(0) else 0 }

    @Synchronized
    fun markRead(chat: String) =
        writableDatabase.execSQL("UPDATE messages SET unread=0 WHERE chat=? AND unread=1", arrayOf(chat))

    @Synchronized
    fun addOutbox(peer: String, mid: String, payload: String) {
        val v = ContentValues().apply { put("peer", peer); put("msg_id", mid); put("payload", payload) }
        writableDatabase.insertWithOnConflict("outbox", null, v, SQLiteDatabase.CONFLICT_IGNORE)
    }

    @Synchronized
    fun outbox(): List<Triple<String, String, String>> {
        val out = ArrayList<Triple<String, String, String>>()
        readableDatabase.rawQuery("SELECT peer,msg_id,payload FROM outbox", null).use {
            while (it.moveToNext()) out.add(Triple(it.getString(0), it.getString(1), it.getString(2)))
        }
        return out
    }

    @Synchronized
    fun delOutbox(peer: String, mid: String) =
        writableDatabase.execSQL("DELETE FROM outbox WHERE peer=? AND msg_id=?", arrayOf(peer, mid))

    @Synchronized
    fun queued(): Int = readableDatabase.rawQuery("SELECT COUNT(*) FROM outbox", null)
        .use { if (it.moveToFirst()) it.getInt(0) else 0 }

    @Synchronized
    fun addFile(fid: String, path: String) {
        val v = ContentValues().apply { put("fid", fid); put("path", path) }
        writableDatabase.insertWithOnConflict("files", null, v, SQLiteDatabase.CONFLICT_REPLACE)
    }

    @Synchronized
    fun filePath(fid: String): String? =
        readableDatabase.rawQuery("SELECT path FROM files WHERE fid=?", arrayOf(fid))
            .use { if (it.moveToFirst()) it.getString(0) else null }
}
