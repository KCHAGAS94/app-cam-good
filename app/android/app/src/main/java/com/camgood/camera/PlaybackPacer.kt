package com.camgood.camera

import java.util.concurrent.LinkedBlockingDeque
import java.util.concurrent.TimeUnit

/**
 * Plays memory-card recordings at a chosen speed (1x / 2x / 4x).
 *
 * Frames from the camera go into a bounded queue; a thread draws them at 15 fps x speed.
 * When the queue gets full the [onFlow] callback asks JS to pause the camera's sending
 * (play_record_file suspend=1) and resumes it when the queue drains, so memory stays bounded.
 */
class PlaybackPacer(
  private val key: String,
  private val onFlow: (full: Boolean) -> Unit,
) {
  companion object {
    private const val BASE_FRAME_MS = 66L // ~15 fps, same pace as the vendor app
    private const val HIGH_WATER = 40
    private const val LOW_WATER = 10
    private const val MAX_FRAMES = 60
  }

  private class Frame(val data: ByteArray, val kind: Int, val len: Int, val w: Int, val h: Int)

  private val queue = LinkedBlockingDeque<Frame>(MAX_FRAMES)
  @Volatile var speed = 1
  @Volatile private var running = true
  @Volatile private var paused = false
  @Volatile private var flowPaused = false
  private val thread = Thread({ loop() }, "PlaybackPacer").apply { start() }

  fun push(data: ByteArray, kind: Int, len: Int, w: Int, h: Int) {
    if (!running) return
    if (!queue.offerLast(Frame(data, kind, len, w, h))) {
      queue.pollFirst() // over the hard cap: drop the oldest rather than block the camera thread
      queue.offerLast(Frame(data, kind, len, w, h))
    }
    if (!flowPaused && queue.size >= HIGH_WATER) {
      flowPaused = true
      onFlow(true)
    }
  }

  /** User pause: stop drawing (the camera is paused by JS separately). */
  fun setPaused(value: Boolean) {
    paused = value
  }

  fun clear() {
    queue.clear()
    if (flowPaused) {
      flowPaused = false
      onFlow(false)
    }
  }

  fun stop() {
    running = false
    thread.interrupt()
    queue.clear()
  }

  private fun loop() {
    while (running) {
      try {
        if (paused) {
          Thread.sleep(100)
          continue
        }
        val frame = queue.pollFirst(200, TimeUnit.MILLISECONDS) ?: continue
        CameraView.dispatchFrame(key, frame.data, frame.kind, frame.len, frame.w, frame.h)
        if (flowPaused && queue.size <= LOW_WATER) {
          flowPaused = false
          onFlow(false)
        }
        Thread.sleep((BASE_FRAME_MS / speed.coerceIn(1, 8)).coerceAtLeast(8))
      } catch (_: InterruptedException) {
        // stop() or shutdown
      } catch (_: Throwable) {
      }
    }
  }
}
