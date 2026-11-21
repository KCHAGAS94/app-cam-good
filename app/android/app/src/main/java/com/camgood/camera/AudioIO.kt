package com.camgood.camera

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.util.Log
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * Camera audio is PCM 16-bit mono 8 kHz in both directions (same as the vendor app).
 */
private const val SAMPLE_RATE = 8000
private const val TAG = "AudioIO"

/** Plays the PCM that the library delivers through the AudioData callback. */
object AudioOut {
  private val queue = LinkedBlockingQueue<ByteArray>(64)
  @Volatile private var running = false
  private var thread: Thread? = null

  @Synchronized
  fun start() {
    if (running) return
    queue.clear()
    running = true
    thread = Thread({ loop() }, "AudioOut").apply { start() }
  }

  @Synchronized
  fun stop() {
    running = false
    thread?.interrupt()
    thread = null
    queue.clear()
  }

  val isRunning get() = running

  /** Called from the native callback thread; never blocks (drops the oldest chunk if full). */
  fun write(data: ByteArray, len: Int) {
    if (!running || len <= 0) return
    val chunk = data.copyOf(len.coerceAtMost(data.size))
    if (!queue.offer(chunk)) {
      queue.poll()
      queue.offer(chunk)
    }
  }

  @Suppress("DEPRECATION")
  private fun loop() {
    val min = AudioTrack.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
    val track = try {
      AudioTrack(
        AudioManager.STREAM_MUSIC, SAMPLE_RATE, AudioFormat.CHANNEL_OUT_MONO,
        AudioFormat.ENCODING_PCM_16BIT, min * 2, AudioTrack.MODE_STREAM,
      )
    } catch (t: Throwable) {
      Log.e(TAG, "AudioTrack init failed", t); running = false; return
    }
    try {
      track.play()
      while (running) {
        val chunk = try { queue.poll(200, TimeUnit.MILLISECONDS) } catch (_: InterruptedException) { null } ?: continue
        track.write(chunk, 0, chunk.size)
      }
    } catch (t: Throwable) {
      Log.w(TAG, "audio out stopped", t)
    } finally {
      runCatching { track.stop() }
      track.release()
    }
  }
}

/** Captures the microphone and hands PCM chunks to [sink] (sent to the camera speaker). */
class MicCapture(private val sink: (ByteArray, Int) -> Unit) {
  @Volatile private var running = false
  private var thread: Thread? = null

  @SuppressLint("MissingPermission") // checked in JS before calling startTalk
  fun start() {
    if (running) return
    running = true
    thread = Thread({
      val min = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
      val rec = try {
        AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, SAMPLE_RATE,
          AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, min * 2)
      } catch (t: Throwable) {
        Log.e(TAG, "AudioRecord init failed", t); running = false; return@Thread
      }
      val buf = ByteArray(min)
      try {
        rec.startRecording()
        while (running) {
          val n = rec.read(buf, 0, buf.size)
          if (n > 0) sink(buf, n)
        }
      } catch (t: Throwable) {
        Log.w(TAG, "mic stopped", t)
      } finally {
        runCatching { rec.stop() }
        rec.release()
      }
    }, "MicCapture").apply { start() }
  }

  fun stop() {
    running = false
    thread?.join(500)
    thread = null
  }
}
