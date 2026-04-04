import java.util.Properties

val androidxWebkitVersion: String by project
val androidxAppcompatVersion: String by project
val androidxActivityKtxVersion: String by project
val materialVersion: String by project
val playServicesAuthVersion: String by project
val junitVersion: String by project
val androidxTestExtJunitVersion: String by project
val androidxEspressoCoreVersion: String by project

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 36
    namespace = "com.morg.kechimochi"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.morg.kechimochi"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:$androidxWebkitVersion")
    implementation("androidx.appcompat:appcompat:$androidxAppcompatVersion")
    implementation("androidx.activity:activity-ktx:$androidxActivityKtxVersion")
    implementation("com.google.android.material:material:$materialVersion")
    implementation("com.google.android.gms:play-services-auth:$playServicesAuthVersion")
    testImplementation("junit:junit:$junitVersion")
    androidTestImplementation("androidx.test.ext:junit:$androidxTestExtJunitVersion")
    androidTestImplementation("androidx.test.espresso:espresso-core:$androidxEspressoCoreVersion")
}

apply(from = "tauri.build.gradle.kts")
