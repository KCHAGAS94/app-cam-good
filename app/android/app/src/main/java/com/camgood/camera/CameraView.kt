package com.camgood.camera

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Rect
import android.graphics.SurfaceTexture
import android.view.TextureView
import `object`.p2pipcam.nativecaller.NativeCaller
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Draws the live video of one camera (prop `did`).
 * Frames come from the native library on its own thread and are drawn straight onto the TextureView.
 */
class CameraView(context: Context) : TextureView(context), TextureView.SurfaceTextureListener {

  /** Receives every decoded frame of a camera (used by the MP4 recorder). */
  fun interface FrameTap {
    fun onFrame(frame: Bitmap)
  }

  companion object {
    private val views = ConcurrentHashMap<String, CopyOnWriteArraySet<CameraView>>()
    private val taps = ConcurrentHashMap<String, FrameTap>()

    fun dispatchFrame(did: String, data: ByteArray, kind: Int, len: Int, width: Int, height: Int) {
      views[did]?.forEach { it.onFrame(data, kind, len, width, height) }
    }

    /** Copy of the last frame shown for this camera, or null if nothing was drawn yet. */
    fun snapshot(did: String): Bitmap? = views[did]?.firstNotNullOfOrNull { it.copyLastFrame() }

    fun setTap(did: String, tap: FrameTap?) {
      if (tap == null) taps.remove(did) else taps[did] = tap
    }
  }

  private var did: String? = null
  private var surfaceReady = false
  private val drawing = AtomicBoolean(false)
  private var bitmap: Bitmap? = null
  /** Last decoded frame (YUV bitmap or JPEG). */
  private var last: Bitmap? = null
  private var rgb: ByteArray? = null
  private val dst = Rect()

  /** "contain" keeps the whole image visible; "cover" fills the view. */
  var resizeMode: String = "contain"

  /** Picture rotation in degrees (0, 90, 180, 270) for cameras mounted sideways. */
  var imageRotation: Int = 0

  init {
    surfaceTextureListener = this
    isOpaque = false
    keepScreenOn = true // don't let the phone sleep while a camera is on screen
  }

  fun setDid(value: String?) {
    did?.let { views[it]?.remove(this) }
    did = value
    value?.let { views.getOrPut(it) { CopyOnWriteArraySet() }.add(this) }
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    did?.let { views[it]?.remove(this) }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    did?.let { views.getOrPut(it) { CopyOnWriteArraySet() }.add(this) }
  }

  private fun onFrame(data: ByteArray, kind: Int, len: Int, width: Int, height: Int) {
    if (!surfaceReady || !drawing.compareAndSet(false, true)) return // drop frame if still busy
    try {
      // built under the lock so snapshot()/recorder never read a half-written bitmap
      val bmp = synchronized(this) {
        val b = if (kind == 1) yuvToBitmap(data, width, height) else jpegToBitmap(data, len)
        if (b != null) {
          last = b
          did?.let { id -> taps[id]?.onFrame(b) }
        }
        b
      }
      if (bmp != null) draw(bmp)
    } catch (_: Throwable) {
    } finally {
      drawing.set(false)
    }
  }

  private fun copyLastFrame(): Bitmap? = synchronized(this) {
    last?.let { it.copy(Bitmap.Config.ARGB_8888, false) }
  }

  private fun yuvToBitmap(yuv: ByteArray, w: Int, h: Int): Bitmap? {
    if (w <= 0 || h <= 0) return null
    var buf = rgb
    if (buf == null || buf.size != w * h * 2) {
      buf = ByteArray(w * h * 2); rgb = buf
    }
    var bmp = bitmap
    if (bmp == null || bmp.width != w || bmp.height != h || bmp.config != Bitmap.Config.RGB_565) {
      bmp = Bitmap.createBitmap(w, h, Bitmap.Config.RGB_565); bitmap = bmp
    }
    NativeCaller.YUV4202RGB565(yuv, buf, w, h)
    bmp.copyPixelsFromBuffer(ByteBuffer.wrap(buf))
    return bmp
  }

  private fun jpegToBitmap(data: ByteArray, len: Int): Bitmap? =
    BitmapFactory.decodeByteArray(data, 0, if (len in 1..data.size) len else data.size)

  private fun draw(bmp: Bitmap) {
    val canvas = lockCanvas() ?: return
    try {
      canvas.drawColor(Color.BLACK)
      val vw = width.toFloat(); val vh = height.toFloat()
      // with 90/270 the picture is laid sideways, so it must fit with width/height swapped
      val sideways = imageRotation == 90 || imageRotation == 270
      val iw = if (sideways) bmp.height else bmp.width
      val ih = if (sideways) bmp.width else bmp.height
      val scale = if (resizeMode == "cover") maxOf(vw / iw, vh / ih) else minOf(vw / iw, vh / ih)
      val dw = (bmp.width * scale).toInt(); val dh = (bmp.height * scale).toInt()
      // draw centered on the origin, then rotate around the view centre
      dst.set(-dw / 2, -dh / 2, dw - dw / 2, dh - dh / 2)
      canvas.save()
      canvas.translate(vw / 2, vh / 2)
      if (imageRotation != 0) canvas.rotate(imageRotation.toFloat())
      canvas.drawBitmap(bmp, null, dst, null)
      canvas.restore()
    } finally {
      unlockCanvasAndPost(canvas)
    }
  }

  override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) { surfaceReady = true }
  override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) {}
  override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean { surfaceReady = false; return true }
  override fun onSurfaceTextureUpdated(surface: SurfaceTexture) {}
}
