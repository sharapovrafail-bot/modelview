plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// адрес сервера организации, встроенный в установщик (rafchat/defaults.json)
val defaultServer: String = Regex("\"server\"\\s*:\\s*\"([^\"]*)\"")
    .find(rootProject.file("../defaults.json").takeIf { it.exists() }?.readText() ?: "")?.groupValues?.get(1) ?: ""

android {
    namespace = "ru.sharapov.rafchat"
    compileSdk = 35

    defaultConfig {
        applicationId = "ru.sharapov.rafchat"
        minSdk = 26
        targetSdk = 34
        versionCode = 10
        versionName = "0.4.0"
        buildConfigField("String", "DEFAULT_SERVER", "\"$defaultServer\"")
    }

    // Постоянный ключ подписи: новые версии ставятся поверх старых без удаления.
    // Приложение ставится вручную (не через Google Play), ключ не секретный.
    signingConfigs {
        create("raflink") {
            storeFile = file("../../../raflink/android/app/raflink.keystore")   // тот же ключ, что у RafLink
            storePassword = "raflink"
            keyAlias = "raflink"
            keyPassword = "raflink"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("raflink")
        }
        debug {
            signingConfig = signingConfigs.getByName("raflink")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("com.google.android.material:material:1.12.0")
}
