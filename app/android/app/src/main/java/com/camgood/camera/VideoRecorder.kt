package com.camgood.camera

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Rect
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.util.Log
import android.view.Surface
import java.io.File

/**
 * Records the frames shown on screen into an H.264 MP4 file.
 * Frames are drawn onto the encoder's input Surface (hardware encoder, no extra copies);
 * a background thread moves the encoded data into the MP4 muxer.
 */
class VideoRecorder(width: Int, height: Int, private val output: File) {

  companion object {
    private const val TAG = "VideoRecorder"
    private const val FPS = 15
    private const val MIN_FRAME_GAP_MS = 1000L / FPS
  }

  // encoders want even sizes
  private val w = width and 1.inv()
  private val h = height and 1.inv()
  private val codec: MediaCodec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
  private val muxer = MediaMuxer(output.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
  private val surface: Surface
  private val dst = Rect(0, 0, w, h)
  private var track = -1
  private var muxing = false
  @Volatile private var stopping = false
  private var lastFrameAt = 0L
  private val drainThread: Thread
  val startedAt = System.currentTimeMillis()

  init {
    val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, w, h).apply {
      setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
      setInteger(MediaFormat.KEY_BIT_RATE, (w * h * 3).coerceIn(1_000_000, 6_000_000))
      setInteger(MediaFormat.KEY_FRAME_RATE, FPS)
      setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
    }
    codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    surface = codec.createInputSurface()
    codec.start()
    drainThread = Thread({ drainLoop() }, "VideoRecorder-drain").apply { start() }
  }

  /** Called with each decoded frame; frames are dropped to keep ~15 fps. */
  fun onFrame(frame: Bitmap) {
    if (stopping) return
    val now = System.currentTimeMillis()
    if (now - lastFrameAt < MIN_FRAME_GAP_MS) return
    lastFrameAt = now
    try {
      val canvas = surface.lockHardwareCanvas()
      try {
        canvas.drawColor(Color.BLACK)
        canvas.drawBitmap(frame, null, dst, null)
      } finally {
        surface.unlockCanvasAndPost(canvas)
      }
    } catch (t: Throwable) {
      Log.w(TAG, "frame dropped", t)
    }
  }

  /** Finishes the file. Returns the duration in ms. */
  fun stop(): Long {
    if (stopping) return 0
    stopping = true
    runCatching { codec.signalEndOfInputStream() }
    drainThread.join(5000)
    runCatching { codec.stop() }
    runCatching { codec.release() }
    runCatching { surface.release() }
    if (muxing) runCatching { muxer.stop() }
    runCatching { muxer.release() }
    return System.currentTimeMillis() - startedAt
  }

  /** True if at least one frame was written (otherwise the file is useless). */
  val hasData: Boolean get() = muxing

  private fun drainLoop() {
    val info = MediaCodec.BufferInfo()
    while (true) {
      val index = try {
        codec.dequeueOutputBuffer(info, 10_000)
      } catch (t: Throwable) {
        break
      }
      when {
        index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
          track = muxer.addTrack(codec.outputFormat)
          muxer.start()
          muxing = true
        }
        index >= 0 -> {
          val buf = codec.getOutputBuffer(index)
          val isConfig = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
          if (buf != null && muxing && !isConfig && info.size > 0) {
            buf.position(info.offset)
            buf.limit(info.offset + info.size)
            muxer.writeSampleData(track, buf, info)
          }
          codec.releaseOutputBuffer(index, false)
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
        }
        stopping && index == MediaCodec.INFO_TRY_AGAIN_LATER -> {
          // keep waiting for END_OF_STREAM; stop() joins with a timeout
        }
      }
    }
  }
}
