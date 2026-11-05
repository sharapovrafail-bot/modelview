package ru.sharapov.raflink

import android.media.projection.MediaProjectionManager
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import android.content.Intent

/** Системный запрос «Начать показ экрана?» — Android требует согласия на каждый сеанс. */
class ScreenConsentActivity : ComponentActivity() {

    private val ask = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val data = r.data
        if (r.resultCode == RESULT_OK && data != null) {
            ContextCompat.startForegroundService(
                this, Intent(this, ScreenService::class.java).putExtra("code", r.resultCode).putExtra("data", data)
            )
            Toast.makeText(this, "Экран показывается на ПК", Toast.LENGTH_SHORT).show()
        } else {
            Toast.makeText(this, "Показ экрана отменён", Toast.LENGTH_SHORT).show()
        }
        finish()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (ScreenState.running) {
            finish()
            return
        }
        ask.launch(getSystemService(MediaProjectionManager::class.java).createScreenCaptureIntent())
    }
}
