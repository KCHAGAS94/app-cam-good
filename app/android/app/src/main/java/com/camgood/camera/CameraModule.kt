package com.camgood.camera

import android.content.Context
import android.content.pm.ActivityInfo
import android.os.Build
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import java.security.SecureRandom
import android.graphics.BitmapFactory
import android.net.ConnectivityManager
import android.net.Uri
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import `object`.p2pipcam.nativecaller.NativeCaller
import java.io.File
import java.io.FileOutputStream
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * React Native bridge to the camera P2P library.
 *
 * JS events emitted:
 *   CamStatus       { did, type, param }          (type 0: 0 connecting, 2 online, 3 failed, 4 disconnected,
 *                                                  5 invalid id, 6 offline, 7 timeout, 8 error, 110 other login)
 *   CamSearchResult { did, ip, mac, name, port }
 *   CamMessage      { did, json }                 replies to send()
 *   CamVideoInfo    { did, width, height }        when resolution changes
 *   CamSnapshot     { did, path }
 *   CamNetwork      { type }                      phone switched network: wifi | cellular | other | none
 *   CamPlayback     { did, timestamp, frame, total, width, height }   memory-card playback progress
 *   CamPlaybackFlow { did, full }                 playback queue full -> pause camera sending / drained -> resume
 */
class CameraModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx), CamCallbacks.Listener {

  companion object {
    const val NAME = "CameraModule"
    private const val TAG = "CameraModule"
    private const val SERVER = "test" // same as the vendor app; the library picks its own servers
    @Volatile private var initialized = false
  }

  private val worker = Executors.newSingleThreadExecutor()
  /** Separate pool for slow server queries so they don't block connect/stream calls. */
  private val queries = Executors.newFixedThreadPool(3)
  private val lastSize = ConcurrentHashMap<String, Pair<Int, Int>>()
  private val lastPlaybackEmit = ConcurrentHashMap<String, Long>()
  private val pacers = ConcurrentHashMap<String, PlaybackPacer>()
  /** Active recordings: did -> (recorder created on first frame, output file). */
  private val recorders = ConcurrentHashMap<String, Pair<Array<VideoRecorder?>, File>>()
  @Volatile private var mic: MicCapture? = null
  private var callbacks: CamCallbacks? = null
  private var networkCallback: ConnectivityManager.NetworkCallback? = null
  @Volatile private var lastNetType = ""

  override fun getName() = NAME

  // ---------------------------------------------------------------- setup

  @ReactMethod
  fun init(promise: Promise) {
    worker.execute {
      try {
        if (!initialized) {
          CamCallbacks.setListener(this)
          NativeCaller.PPPPInitial(SERVER)
          NativeCaller.Init()
          callbacks = CamCallbacks(ctx.applicationContext)
          NativeCaller.PPPPSetCallbackContext(callbacks)
          initialized = true
          Thread { runCatching { NativeCaller.PPPPNetworkDetect() } }.start()
        } else {
          CamCallbacks.setListener(this)
        }
        // In case a previous run died while bound to the camera hotspot
        runCatching { connectivity().bindProcessToNetwork(null) }
        watchNetwork()
        promise.resolve(runCatching { NativeCaller.GetVer() }.getOrDefault(""))
      } catch (t: Throwable) {
        Log.e(TAG, "init failed", t)
        promise.reject("INIT", t.message, t)
      }
    }
  }

  /** Info about the Wi-Fi the phone is on (to detect the camera hotspot PIXB-...). */
  @ReactMethod
  fun getNetworkInfo(promise: Promise) {
    val map = Arguments.createMap()
    map.putString("ip", localIp() ?: "")
    @Suppress("DEPRECATION")
    val ssid = runCatching {
      val wm = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
      wm.connectionInfo.ssid?.trim('"') ?: ""
    }.getOrDefault("")
    map.putString("ssid", if (ssid == "<unknown ssid>") "" else ssid)
    promise.resolve(map)
  }

  /**
   * While on the camera hotspot (no internet) Android may route traffic over mobile data.
   * Binding the process to the Wi-Fi network keeps the P2P traffic on the hotspot.
   */
  @ReactMethod
  fun bindToWifi(enable: Boolean, promise: Promise) {
    val cm = ctx.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    if (!enable) {
      cm.bindProcessToNetwork(null)
      promise.resolve(true)
      return
    }
    val wifi = cm.allNetworks.firstOrNull {
      cm.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
    }
    promise.resolve(wifi != null && cm.bindProcessToNetwork(wifi))
  }

  /** "wifi", "cellular", "other" or "none" for the phone's current default network. */
  @ReactMethod
  fun getConnectionType(promise: Promise) {
    promise.resolve(currentNetType())
  }

  /**
   * Asks the P2P server how many seconds ago the camera checked in.
   * 0..60 = camera is on the internet; negative or larger = not registered / offline.
   */
  @ReactMethod
  fun checkOnline(did: String, promise: Promise) {
    queries.execute {
      try {
        promise.resolve(NativeCaller.PPPPCheckDevOnline(did))
      } catch (t: Throwable) {
        promise.resolve(-999)
      }
    }
  }

  // ---------------------------------------------------------------- discovery

  /** Broadcast search on the local network. Results arrive as CamSearchResult events. */
  @ReactMethod
  fun search(durationMs: Double, promise: Promise) {
    worker.execute {
      val wm = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
      val lock = wm.createMulticastLock("camgood-search").apply { setReferenceCounted(false); acquire() }
      try {
        val ip = localIp() ?: ""
        NativeCaller.StartSearch(if (ip.startsWith("192")) ip else "AA")
        Thread.sleep(durationMs.toLong().coerceIn(1000, 15000))
        NativeCaller.StopSearch()
        promise.resolve(null)
      } catch (t: Throwable) {
        promise.reject("SEARCH", t.message, t)
      } finally {
        lock.release()
      }
    }
  }

  // ---------------------------------------------------------------- session

  @ReactMethod
  fun connect(did: String, user: String, pwd: String, promise: Promise) {
    worker.execute {
      try {
        // Vendor app always closes the previous session first: a second StartPPPP on top of a
        // half-open one makes the camera answer "mj_other_login" and drop us.
        runCatching { NativeCaller.StopPPPPLivestream(did) }
        runCatching { NativeCaller.StopPPPP(did) }
        lastSize.remove(did)
        promise.resolve(NativeCaller.StartPPPP(did, user, pwd, SERVER, 0))
      } catch (t: Throwable) {
        promise.reject("CONNECT", t.message, t)
      }
    }
  }

  @ReactMethod
  fun disconnect(did: String, promise: Promise) {
    worker.execute {
      runCatching { NativeCaller.StopPPPPLivestream(did) }
      runCatching { NativeCaller.StopPPPP(did) }
      lastSize.remove(did)
      promise.resolve(null)
    }
  }

  /** streamId 1 = main stream (the vendor app uses 1; 2 = alternate quality). */
  @ReactMethod
  fun startLive(did: String, streamId: Double, promise: Promise) {
    worker.execute {
      try {
        promise.resolve(NativeCaller.StartPPPPLivestream(did, streamId.toInt()))
      } catch (t: Throwable) {
        promise.reject("LIVE", t.message, t)
      }
    }
  }

  @ReactMethod
  fun stopLive(did: String, promise: Promise) {
    worker.execute {
      runCatching { NativeCaller.StopPPPPLivestream(did) }
      lastSize.remove(did) // so the next stream re-announces its size (CamVideoInfo)
      promise.resolve(null)
    }
  }

  /** Sends a JSON command to the camera. The reply comes back as a CamMessage event. */
  @ReactMethod
  fun send(did: String, json: String, promise: Promise) {
    worker.execute {
      try {
        promise.resolve(NativeCaller.TransferMessage(did, json, 0))
      } catch (t: Throwable) {
        promise.reject("SEND", t.message, t)
      }
    }
  }

  /**
   * Opens the playback channel for a memory-card file. JS then sends the play_record_file JSON.
   * Frames are drawn by <CameraView did="<did>#pb"> and progress comes as CamPlayback events.
   */
  @ReactMethod
  fun startPlayback(did: String, fileName: String, promise: Promise) {
    worker.execute {
      try {
        lastPlaybackEmit.remove(did)
        // frames are paced by PlaybackPacer (speed 1x/2x/4x); keep the speed across files
        val speed = pacers.remove(did)?.let { it.stop(); it.speed } ?: 1
        pacers[did] = PlaybackPacer("$did#pb") { full ->
          emit("CamPlaybackFlow", Arguments.createMap().apply { putString("did", did); putBoolean("full", full) })
        }.also { it.speed = speed }
        promise.resolve(NativeCaller.StartPlayBack(did, fileName, 0))
      } catch (t: Throwable) {
        promise.reject("PLAYBACK", t.message, t)
      }
    }
  }

  @ReactMethod
  fun stopPlayback(did: String, promise: Promise) {
    worker.execute {
      runCatching { NativeCaller.StopPlayBack(did) }
      pacers.remove(did)?.stop()
      promise.resolve(null)
    }
  }

  /** 1, 2 or 4 (frames drawn at 15 fps x speed). */
  @ReactMethod
  fun setPlaybackSpeed(did: String, speed: Double) {
    pacers[did]?.speed = speed.toInt().coerceIn(1, 8)
  }

  /** Stop/resume drawing (JS also pauses the camera with play_record_file suspend). */
  @ReactMethod
  fun setPlaybackPaused(did: String, paused: Boolean) {
    pacers[did]?.setPaused(paused)
  }

  // ---------------------------------------------------------------- audio

  /** Live sound from the camera microphone. */
  @ReactMethod
  fun startListening(did: String, promise: Promise) {
    worker.execute {
      AudioOut.start()
      runCatching { NativeCaller.PPPPStartAudio(did) }
      promise.resolve(true)
    }
  }

  @ReactMethod
  fun stopListening(did: String, promise: Promise) {
    worker.execute {
      runCatching { NativeCaller.PPPPStopAudio(did) }
      AudioOut.stop()
      promise.resolve(true)
    }
  }

  /** Speaker output only (memory-card playback sends its audio without PPPPStartAudio). */
  @ReactMethod
  fun setAudioOutput(enabled: Boolean, promise: Promise) {
    if (enabled) AudioOut.start() else AudioOut.stop()
    promise.resolve(true)
  }

  /** Push-to-talk: phone microphone -> camera speaker. JS also sends the talk_send JSON. */
  @ReactMethod
  fun startTalk(did: String, promise: Promise) {
    worker.execute {
      try {
        mic?.stop()
        NativeCaller.PPPPStartTalk(did)
        mic = MicCapture { buf, n -> runCatching { NativeCaller.PPPPTalkAudioData(did, buf, n) } }
          .also { it.start() }
        promise.resolve(true)
      } catch (t: Throwable) {
        promise.reject("TALK", t.message, t)
      }
    }
  }

  @ReactMethod
  fun stopTalk(did: String, promise: Promise) {
    worker.execute {
      mic?.stop()
      mic = null
      runCatching { NativeCaller.PPPPStopTalk(did) }
      promise.resolve(true)
    }
  }

  // ---------------------------------------------------------------- photo / video to gallery

  /**
   * Private "outbox" inside the app for photos/videos that go only to the central server:
   * they wait here until uploaded, then are deleted. Not visible in the phone gallery.
   */
  private fun outboxDir() = File(ctx.filesDir, "outbox").apply { mkdirs() }

  private fun outboxFile(uri: String): File? {
    val path = if (uri.startsWith("file://")) Uri.parse(uri).path else uri
    val f = File(path ?: return null).canonicalFile
    return if (f.path.startsWith(outboxDir().canonicalPath)) f else null // never touch other files
  }

  /**
   * Saves the frame currently on screen. toGallery = true: phone gallery (content:// URI);
   * false: app outbox (file:// URI) for server-only storage.
   */
  @ReactMethod
  fun takeSnapshot(did: String, toGallery: Boolean, promise: Promise) {
    queries.execute {
      try {
        val bmp = CameraView.snapshot(did) ?: return@execute promise.reject("NO_FRAME", "Nenhuma imagem na tela ainda")
        val name = MediaSaver.fileName("CamGood", "jpg")
        val uri = if (toGallery) {
          MediaSaver.saveJpeg(ctx, bmp, name).toString()
        } else {
          val f = File(outboxDir(), name)
          FileOutputStream(f).use { bmp.compress(android.graphics.Bitmap.CompressFormat.JPEG, 92, it) }
          Uri.fromFile(f).toString()
        }
        bmp.recycle()
        promise.resolve(uri)
      } catch (t: Throwable) {
        promise.reject("SNAPSHOT", t.message, t)
      }
    }
  }

  /** Starts recording what is shown for this camera into an MP4 (created on the first frame). */
  @ReactMethod
  fun startRecording(did: String, promise: Promise) {
    if (recorders.containsKey(did)) return promise.resolve(true)
    val file = File(ctx.cacheDir, "rec_${System.currentTimeMillis()}.mp4")
    val holder = arrayOfNulls<VideoRecorder>(1)
    recorders[did] = holder to file
    CameraView.setTap(did) { frame ->
      val rec = holder[0] ?: runCatching { VideoRecorder(frame.width, frame.height, file) }
        .onFailure { Log.e(TAG, "recorder init failed", it) }
        .getOrNull()?.also { holder[0] = it }
      rec?.onFrame(frame)
    }
    promise.resolve(true)
  }

  /**
   * Stops recording and saves the video (gallery, or the app outbox when toGallery = false).
   * Resolves {uri, durationMs} or null if nothing was recorded.
   */
  @ReactMethod
  fun stopRecording(did: String, toGallery: Boolean, promise: Promise) {
    val entry = recorders.remove(did) ?: return promise.resolve(null)
    CameraView.setTap(did, null)
    queries.execute {
      try {
        val (holder, file) = entry
        val rec = holder[0]
        if (rec == null) {
          file.delete()
          return@execute promise.resolve(null)
        }
        val duration = rec.stop()
        if (!rec.hasData) {
          file.delete()
          return@execute promise.resolve(null)
        }
        val name = MediaSaver.fileName("CamGood", "mp4")
        val uri = if (toGallery) {
          MediaSaver.saveVideo(ctx, file, name).toString()
        } else {
          val dest = File(outboxDir(), name)
          if (!file.renameTo(dest)) {
            file.copyTo(dest, overwrite = true); file.delete()
          }
          Uri.fromFile(dest).toString()
        }
        promise.resolve(Arguments.createMap().apply {
          putString("uri", uri); putDouble("durationMs", duration.toDouble())
        })
      } catch (t: Throwable) {
        promise.reject("RECORD", t.message, t)
      }
    }
  }

  /** Deletes an outbox file after the server confirmed the upload (only files in the outbox). */
  @ReactMethod
  fun deleteLocalFile(uri: String, promise: Promise) {
    promise.resolve(outboxFile(uri)?.delete() ?: false)
  }

  /** Fallback when the server refuses a file: move it from the outbox to the phone gallery. */
  @ReactMethod
  fun moveToGallery(uri: String, promise: Promise) {
    queries.execute {
      try {
        val f = outboxFile(uri) ?: return@execute promise.resolve(null)
        if (!f.exists()) return@execute promise.resolve(null)
        val saved = if (f.name.endsWith(".jpg")) {
          val bmp = android.graphics.BitmapFactory.decodeFile(f.path)
          MediaSaver.saveJpeg(ctx, bmp, f.name).also { bmp.recycle(); f.delete() }
        } else {
          MediaSaver.saveVideo(ctx, f, f.name) // deletes the source
        }
        promise.resolve(saved.toString())
      } catch (t: Throwable) {
        promise.reject("GALLERY", t.message, t)
      }
    }
  }

  /**
   * Asks for the phone's fingerprint / face / PIN-pattern-password (system prompt).
   * Resolves "ok", "cancel", "failed" or "no-lock" (phone has no screen lock to check).
   */
  @ReactMethod
  fun authenticate(title: String, subtitle: String, promise: Promise) {
    val activity = ctx.currentActivity as? FragmentActivity
      ?: return promise.resolve("ok") // no UI to show the prompt on: don't lock the user out
    // device credential together with biometrics is only allowed with STRONG from Android 11
    val authenticators = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL
    } else {
      BiometricManager.Authenticators.BIOMETRIC_WEAK or BiometricManager.Authenticators.DEVICE_CREDENTIAL
    }
    when (BiometricManager.from(activity).canAuthenticate(authenticators)) {
      BiometricManager.BIOMETRIC_SUCCESS -> {}
      BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> return promise.resolve("no-lock")
      else -> return promise.resolve("no-lock")
    }
    activity.runOnUiThread {
      var settled = false
      val prompt = BiometricPrompt(
        activity,
        ContextCompat.getMainExecutor(activity),
        object : BiometricPrompt.AuthenticationCallback() {
          override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
            if (!settled) { settled = true; promise.resolve("ok") }
          }
          override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
            if (!settled) {
              settled = true
              promise.resolve(
                if (errorCode == BiometricPrompt.ERROR_USER_CANCELED ||
                  errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
                  errorCode == BiometricPrompt.ERROR_CANCELED) "cancel" else "failed",
              )
            }
          }
          // onAuthenticationFailed = one wrong finger; the prompt stays open, nothing to do
        },
      )
      val info = BiometricPrompt.PromptInfo.Builder()
        .setTitle(title)
        .setSubtitle(subtitle)
        .setAllowedAuthenticators(authenticators)
        .build()
      prompt.authenticate(info)
    }
  }

  /** Random camera password from a cryptographically secure generator (SecureRandom). */
  @ReactMethod
  fun randomPassword(length: Double, promise: Promise) {
    // same characters accepted by validateCameraPassword (avoid JSON/URL trouble)
    val letters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz"
    val digits = "23456789"
    val symbols = "._@#*!-"
    val all = letters + digits + symbols
    val rnd = SecureRandom()
    val n = length.toInt().coerceIn(8, 31)
    // guarantee at least one letter, one digit and one symbol, then shuffle
    val chars = mutableListOf(
      letters[rnd.nextInt(letters.length)],
      digits[rnd.nextInt(digits.length)],
      symbols[rnd.nextInt(symbols.length)],
    )
    while (chars.size < n) chars.add(all[rnd.nextInt(all.length)])
    chars.shuffle(rnd)
    promise.resolve(chars.joinToString(""))
  }

  /** "landscape" (sensor landscape, used by the 4-camera grid), "portrait" or "auto". */
  @ReactMethod
  fun setOrientation(mode: String) {
    val activity = ctx.currentActivity ?: return
    activity.runOnUiThread {
      activity.requestedOrientation = when (mode) {
        "landscape" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        "portrait" -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        else -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
      }
    }
  }

  // Required by NativeEventEmitter
  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Double) {}

  // ---------------------------------------------------------------- native callbacks

  override fun onStatus(did: String?, type: Int, param: Int) {
    emit("CamStatus", Arguments.createMap().apply {
      putString("did", did ?: ""); putInt("type", type); putInt("param", param)
    })
  }

  override fun onSearchResult(mac: String?, name: String?, did: String, ip: String?, port: Int) {
    emit("CamSearchResult", Arguments.createMap().apply {
      putString("did", did); putString("ip", ip ?: ""); putString("mac", mac ?: "")
      putString("name", name ?: ""); putInt("port", port)
    })
  }

  override fun onVideoFrame(did: String?, data: ByteArray?, kind: Int, len: Int, width: Int, height: Int, timestamp: Int) {
    if (did == null || data == null) return
    // kind 1 = YUV with known size; otherwise it's a JPEG and we read the size from its header
    val size = if (kind == 1 && width > 0 && height > 0) {
      width to height
    } else {
      val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeByteArray(data, 0, if (len in 1..data.size) len else data.size, opts)
      opts.outWidth to opts.outHeight
    }
    if (lastSize.put(did, size) != size) {
      Log.d(TAG, "video $did kind=$kind ${size.first}x${size.second}")
      emit("CamVideoInfo", Arguments.createMap().apply {
        putString("did", did); putInt("width", size.first); putInt("height", size.second)
      })
    }
    CameraView.dispatchFrame(did, data, kind, len, width, height)
  }

  override fun onPlaybackFrame(
    did: String?, data: ByteArray?, kind: Int, len: Int, width: Int, height: Int,
    timestamp: Int, frameNo: Int, totalFrames: Int,
  ) {
    if (did == null || data == null) return
    val pacer = pacers[did]
    if (pacer != null) pacer.push(data, kind, len, width, height)
    else CameraView.dispatchFrame("$did#pb", data, kind, len, width, height)
    // progress to JS at most ~3x per second
    val now = System.currentTimeMillis()
    val last = lastPlaybackEmit[did] ?: 0L
    if (now - last >= 300) {
      lastPlaybackEmit[did] = now
      emit("CamPlayback", Arguments.createMap().apply {
        putString("did", did); putInt("timestamp", timestamp)
        putInt("frame", frameNo); putInt("total", totalFrames)
        putInt("width", width); putInt("height", height)
      })
    }
  }

  override fun onMessage(did: String?, json: String) {
    emit("CamMessage", Arguments.createMap().apply { putString("did", did ?: ""); putString("json", json) })
  }

  override fun onSnapshot(did: String?, jpeg: ByteArray?, len: Int) {
    if (did == null || jpeg == null) return
    runCatching {
      val f = File(ctx.cacheDir, "snap_${did}_${System.currentTimeMillis()}.jpg")
      FileOutputStream(f).use { it.write(jpeg, 0, if (len in 1..jpeg.size) len else jpeg.size) }
      emit("CamSnapshot", Arguments.createMap().apply { putString("did", did); putString("path", f.absolutePath) })
    }
  }

  // ---------------------------------------------------------------- helpers

  private fun emit(event: String, payload: WritableMap) {
    if (!ctx.hasActiveReactInstance()) return
    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(event, payload)
  }

  private fun connectivity() =
    ctx.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

  private fun currentNetType(): String {
    val cm = connectivity()
    val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return "none"
    return when {
      caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
      caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
      else -> "other"
    }
  }

  /** Emits CamNetwork {type} whenever the phone switches between Wi-Fi / mobile data / offline. */
  private fun watchNetwork() {
    if (networkCallback != null) return
    lastNetType = currentNetType()
    val cb = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: android.net.Network) = report()
      override fun onLost(network: android.net.Network) = report()
      override fun onCapabilitiesChanged(network: android.net.Network, caps: NetworkCapabilities) = report()
      private fun report() {
        val type = currentNetType()
        if (type != lastNetType) {
          lastNetType = type
          emit("CamNetwork", Arguments.createMap().apply { putString("type", type) })
        }
      }
    }
    runCatching { connectivity().registerDefaultNetworkCallback(cb) }.onSuccess { networkCallback = cb }
  }

  private fun localIp(): String? = runCatching {
    NetworkInterface.getNetworkInterfaces().toList()
      .filter { it.isUp && !it.isLoopback }
      .sortedBy { if (it.name.startsWith("wlan")) 0 else 1 }
      .flatMap { it.inetAddresses.toList() }
      .firstOrNull { it is Inet4Address && !it.isLoopbackAddress }
      ?.hostAddress
  }.getOrNull()

  override fun invalidate() {
    pacers.values.forEach { it.stop() }
    pacers.clear()
    mic?.stop()
    mic = null
    AudioOut.stop()
    recorders.keys.forEach { did ->
      CameraView.setTap(did, null)
      recorders.remove(did)?.first?.get(0)?.let { runCatching { it.stop() } }
    }
    networkCallback?.let { runCatching { connectivity().unregisterNetworkCallback(it) } }
    networkCallback = null
    CamCallbacks.setListener(null)
    super.invalidate()
  }
}
