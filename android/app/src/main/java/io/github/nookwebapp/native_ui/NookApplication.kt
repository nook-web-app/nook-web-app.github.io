package io.github.nookwebapp.native_ui

import android.app.Application

// Firebase starts with the process, so a notification can wake the app when it is closed
class NookApplication : Application() {
    override fun onCreate() { super.onCreate(); Push.init(this); Stall.start(filesDir) }
}
