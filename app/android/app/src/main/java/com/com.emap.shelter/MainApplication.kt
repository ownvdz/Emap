package com.emap.shelter

import android.app.Application
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    createEmergencyChannel()
    loadReactNative(this)
  }

  // 긴급재난 푸시용 알림 채널: 중요도를 높게 해야 화면 위에 바로 뜨고 소리·진동이 난다
  private fun createEmergencyChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }
    val channel =
      NotificationChannel("emergency_alerts", "긴급재난 알림", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "긴급재난·위급재난 문자 푸시 알림"
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 300, 150, 300, 150, 300)
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      }
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }
}
