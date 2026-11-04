package ru.sharapov.rafchat

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject

data class Peer(
    val id: String, val name: String, val dept: String, val ip: String, val port: Int,
    val plat: String, val lastSeen: Long,
) {
    val online get() = System.currentTimeMillis() - lastSeen < Node.ONLINE_MS
    val title get() = if (dept.isNotEmpty()) "$name · $dept" else name
}

data class FileMeta(val fid: String, val name: String, val size: Long) {
    fun json(): JSONObject = JSONObject().put("fid", fid).put("name", name).put("size", size)

    companion object {
        fun of(s: String?): FileMeta? = if (s.isNullOrEmpty() || s == "null") null else try {
            val o = JSONObject(s)
            FileMeta(o.getString("fid"), o.getString("name"), o.getLong("size"))
        } catch (e: Exception) { null }
    }
}

data class Msg(
    val id: String, val chat: String, val sender: String, val senderName: String, val ts: Long,
    val text: String, val file: FileMeta?, val mine: Boolean, val status: String, val local: String?,
)

/** Переписка и участники — та же схема, что в программе для ПК. */
class Store(ctx: Context) : SQLiteOpenHelper(ctx, "rafchat.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE peers(id TEXT PRIMARY KEY, name TEXT, dept TEXT, ip TEXT, port INT, plat TEXT, last_seen INT)")
        db.execSQL("CREATE TABLE messages(id TEXT PRIMARY KEY, chat TEXT, sender TEXT, sender_name TEXT, ts INT, " +
            "text TEXT, file TEXT, mine INT, status TEXT, local TEXT, unread INT DEFAULT 0)")
        db.execSQL("CREATE INDEX msg_chat ON messages(chat, ts)")
        db.execSQL("CREATE TABLE outbox(peer TEXT, msg_id TEXT, payload TEXT, PRIMARY KEY(peer, msg_id))")
        db.execSQL("CREATE TABLE files(fid TEXT PRIMARY KEY, path TEXT)")
    }

    override fun onUpgrade(db: SQLiteDatabase, o: Int, n: Int) {}

    @Synchronized
    fun upsertPeer(id: String, name: String, dept: String, ip: String, port: Int, plat: String, seen: Long) {
        val v = ContentValues().apply {
            put("id", id); put("name", name); put("dept", dept); put("ip", ip); put("port", port)
            put("plat", plat); put("last_seen", seen)
        }
        writableDatabase.insertWithOnConflict("peers", null, v, SQLiteDatabase.CONFLICT_REPLACE)
    }

    @Synchronized
    fun markOffline(id: String) {
        writableDatabase.execSQL("UPDATE peers SET last_seen=0 WHERE id=?", arrayOf(id))
    }

    @Synchronized
    fun peers(): List<Peer> {
        val out = ArrayList<Peer>()
        readableDatabase.rawQuery("SELECT id,name,dept,ip,port,plat,last_seen FROM peers", null).use { c ->
            while (c.moveToNext()) out.add(
                Peer(c.getString(0), c.getString(1) ?: "?", c.getString(2) ?: "", c.getString(3) ?: "",
                    c.getInt(4), c.getString(5) ?: "", c.getLong(6))
            )
        }
        return out
    }

    fun peer(id: String) = peers().firstOrNull { it.id == id }

    @Synchronized
    fun hasMsg(id: String): Boolean =
        readableDatabase.rawQuery("SELECT 1 FROM messages WHERE id=?", arrayOf(id)).use { it.moveToFirst() }

    @Synchronized
    fun insertMsg(m: Msg, unread: Boolean) {
        val v = ContentValues().apply {
            put("id", m.id); put("chat", m.chat); put("sender", m.sender); put("sender_name", m.senderName)
            put("ts", m.ts); put("text", m.text); put("file", m.file?.json()?.toString()); put("mine", if (m.mine) 1 else 0)
            put("status", m.status); put("local", m.local); put("unread", if (unread) 1 else 0)
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
        FileMeta.of(c.getString(6)), c.getInt(7) == 1, c.getString(8) ?: "", c.getString(9)
    )

    private val cols = "id,chat,sender,sender_name,ts,text,file,mine,status,local"

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
