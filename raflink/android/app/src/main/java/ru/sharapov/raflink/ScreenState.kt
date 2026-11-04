package ru.sharapov.raflink

import java.util.concurrent.atomic.AtomicInteger

/** Последний кадр экрана для отправки на ПК. */
object ScreenState {
    @Volatile var running = false
    @Volatile var width = 0
    @Volatile var height = 0
    @Volatile var lastWant = 0L
    val watchers = AtomicInteger(0)

    private val lock = Object()
    private var frame: ByteArray? = null
    private var seq = 0L

    fun publish(jpeg: ByteArray) {
        synchronized(lock) {
            frame = jpeg
            seq++
            lock.notifyAll()
        }
    }

    /** Ждёт кадр новее [after]; null — если за [timeoutMs] экран не менялся. */
    fun next(after: Long, timeoutMs: Long): Pair<Long, ByteArray>? {
        synchronized(lock) {
            val end = System.currentTimeMillis() + timeoutMs
            while (seq <= after || frame == null) {
                val left = end - System.currentTimeMillis()
                if (left <= 0) return null
                lock.wait(left)
            }
            return seq to frame!!
        }
    }

    fun clear() {
        synchronized(lock) {
            frame = null
            lock.notifyAll()
        }
    }
}
