package ru.sharapov.rafchat

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaPlayer
import android.media.MediaRecorder
import java.io.File
import java.io.RandomAccessFile
import kotlin.concurrent.thread

/** Голосовые сообщения: запись WAV 16 кГц моно (одинаково на ПК, Android и iPhone) и прослушивание. */
object Voice {
    private const val RATE = 16000
    @Volatile private var rec: AudioRecord? = null
    @Volatile private var recording = false
    private var file: File? = null
    private var started = 0L

    val isRecording get() = recording
    val seconds get() = ((System.currentTimeMillis() - started) / 1000).toInt()

    @SuppressLint("MissingPermission")
    fun start(ctx: Context): Boolean {
        if (recording) return true
        val min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val r = try {
            AudioRecord(MediaRecorder.AudioSource.MIC, RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(min, 8192))
        } catch (e: Exception) { return false }
        if (r.state != AudioRecord.STATE_INITIALIZED) { r.release(); return false }
        val name = "Голосовое_" + java.text.SimpleDateFormat("yyyy-MM-dd_HH-mm-ss", java.util.Locale.US).format(java.util.Date()) + ".wav"
        val f = File(File(ctx.filesDir, "sent").apply { mkdirs() }, name)
        file = f
        rec = r
        recording = true
        started = System.currentTimeMillis()
        r.startRecording()
        thread(name = "rc-voice") {
            RandomAccessFile(f, "rw").use { out ->
                out.setLength(0)
                out.write(ByteArray(44))
                val buf = ByteArray(4096)
                while (recording) {
                    val n = r.read(buf, 0, buf.size)
                    if (n > 0) out.write(buf, 0, n)
                }
                val data = (out.length() - 44).toInt()
                out.seek(0)
                out.write(wavHeader(data))
            }
            r.stop(); r.release()
            synchronized(this) { (this as Object).notifyAll() }
        }
        return true
    }

    /** Остановить запись. keep=false — отменить. Возвращает файл и длительность (сек). */
    fun stop(keep: Boolean): Pair<File, Int>? {
        if (!recording) return null
        val secs = seconds
        recording = false
        synchronized(this) { try { (this as Object).wait(1500) } catch (_: InterruptedException) {} }
        val f = file ?: return null
        if (!keep || secs < 1) { f.delete(); return null }
        return f to secs
    }

    private fun wavHeader(data: Int): ByteArray {
        val b = java.nio.ByteBuffer.allocate(44).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        b.put("RIFF".toByteArray()); b.putInt(36 + data); b.put("WAVE".toByteArray())
        b.put("fmt ".toByteArray()); b.putInt(16); b.putShort(1); b.putShort(1); b.putInt(RATE); b.putInt(RATE * 2)
        b.putShort(2); b.putShort(16)
        b.put("data".toByteArray()); b.putInt(data)
        return b.array()
    }

    // ---------- прослушивание
    private var player: MediaPlayer? = null
    var playingId: String? = null; private set

    fun toggle(ctx: Context, mid: String, local: String, onEnd: () -> Unit): Boolean {
        val was = playingId
        stopPlay()
        if (was == mid) return false
        return try {
            val p = MediaPlayer()
            if (local.startsWith("content:")) p.setDataSource(ctx, android.net.Uri.parse(local)) else p.setDataSource(local)
            p.setOnCompletionListener { stopPlay(); onEnd() }
            p.prepare(); p.start()
            player = p; playingId = mid
            true
        } catch (e: Exception) { false }
    }

    fun stopPlay() {
        try { player?.stop() } catch (_: Exception) {}
        try { player?.release() } catch (_: Exception) {}
        player = null; playingId = null
    }
}

fun FileMeta.isVoice() = voice >= 0 || (name.startsWith("Голосовое") && Ui.ext(name) in setOf("wav", "m4a", "aac", "mp3", "ogg", "opus"))

fun fmtSecs(n: Int) = "%d:%02d".format(maxOf(n, 0) / 60, maxOf(n, 0) % 60)
