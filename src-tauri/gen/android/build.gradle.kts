buildscript {
    val androidVersions = java.util.Properties().apply {
        rootDir.resolve("gradle.properties").inputStream().use { load(it) }
    }
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:${androidVersions.getProperty("androidGradlePluginVersion")}")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:${androidVersions.getProperty("kotlinGradlePluginVersion")}")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

tasks.register("clean").configure {
    delete("build")
}
