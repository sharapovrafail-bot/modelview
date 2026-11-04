package ru.sharapov.raflink

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.graphics.Path
import android.hardware.display.DisplayManager
import android.os.Build
import android.os.Bundle
import android.util.DisplayMetrics
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONObject

/**
 * Управление телефоном мышкой с ПК (через «Специальные возможности»).
 * Координаты приходят долями экрана 0…1 — как на картинке, которую видит ПК.
 */
class ControlService : AccessibilityService() {

    companion object {
        @Volatile var instance: ControlService? = null

        fun isEnabled(ctx: Context): Boolean {
            val list = android.provider.Settings.Secure.getString(
                ctx.contentResolver, android.provider.Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ) ?: return false
            return list.contains("${ctx.packageName}/") && list.contains("ControlService")
        }
    }

    override fun onServiceConnected() {
        instance = this
    }

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        instance = null
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        instance = null
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}

    private fun real(): Pair<Float, Float> {
        val m = DisplayMetrics()
        @Suppress("DEPRECATION")
        getSystemService(DisplayManager::class.java).getDisplay(Display.DEFAULT_DISPLAY).getRealMetrics(m)
        return m.widthPixels.toFloat() to m.heightPixels.toFloat()
    }

    fun handle(o: JSONObject) {
        val (w, h) = real()
        fun c(k: String, size: Float) = (o.optDouble(k, 0.0).toFloat().coerceIn(0f, 1f) * (size - 1))
        when (o.optString("t")) {
            "tap" -> gesture(c("x", w), c("y", h), c("x", w), c("y", h), if (o.optBoolean("long")) 650 else 50)
            "swipe" -> gesture(
                c("x", w), c("y", h), c("x2", w), c("y2", h),
                o.optLong("ms", 250).coerceIn(40, 3000)
            )
            "key" -> key(o.optString("key"))
            "text" -> typeText(o.optString("text"))
            "backspace" -> erase()
            "enter" -> enter()
        }
    }

    private fun gesture(x1: Float, y1: Float, x2: Float, y2: Float, ms: Long) {
        val p = Path().apply {
            moveTo(x1, y1)
            if (x1 != x2 || y1 != y2) lineTo(x2, y2)
        }
        dispatchGesture(
            GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(p, 0, ms)).build(), null, null
        )
    }

    private fun key(k: String) {
        val a = when (k) {
            "back" -> GLOBAL_ACTION_BACK
            "home" -> GLOBAL_ACTION_HOME
            "recents" -> GLOBAL_ACTION_RECENTS
            "notifications" -> GLOBAL_ACTION_NOTIFICATIONS
            "power" -> GLOBAL_ACTION_POWER_DIALOG
            "lock" -> if (Build.VERSION.SDK_INT >= 28) GLOBAL_ACTION_LOCK_SCREEN else return
            "shot" -> if (Build.VERSION.SDK_INT >= 28) GLOBAL_ACTION_TAKE_SCREENSHOT else return
            else -> return
        }
        performGlobalAction(a)
    }

    private fun focused(): AccessibilityNodeInfo? =
        rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)

    private fun currentText(n: AccessibilityNodeInfo): String =
        if (Build.VERSION.SDK_INT >= 26 && n.isShowingHintText) "" else n.text?.toString() ?: ""

    private fun setText(n: AccessibilityNodeInfo, t: String) {
        val b = Bundle()
        b.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, t)
        n.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, b)
    }

    private fun typeText(t: String) {
        val n = focused() ?: return
        setText(n, currentText(n) + t)
    }

    private fun erase() {
        val n = focused() ?: return
        val cur = currentText(n)
        if (cur.isNotEmpty()) setText(n, cur.dropLast(1))
    }

    private fun enter() {
        val n = focused() ?: return
        if (Build.VERSION.SDK_INT >= 30) {
            n.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)
        }
    }
}
