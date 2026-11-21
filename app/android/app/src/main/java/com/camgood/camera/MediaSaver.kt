package com.camgood.camera

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Saves photos/videos to the phone gallery (Pictures/CamGood, Movies/CamGood). */
object MediaSaver {
  private const val FOLDER = "CamGood"

  fun fileName(prefix: String, ext: String): String =
    "${prefix}_${SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())}.$ext"

  fun saveJpeg(ctx: Context, bmp: Bitmap, name: String): Uri {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val values = ContentValues().apply {
        put(MediaStore.Images.Media.DISPLAY_NAME, name)
        put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
        put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/$FOLDER")
        put(MediaStore.Images.Media.IS_PENDING, 1)
      }
      val resolver = ctx.contentResolver
      val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
        ?: error("could not create image")
      resolver.openOutputStream(uri)!!.use { bmp.compress(Bitmap.CompressFormat.JPEG, 92, it) }
      values.clear()
      values.put(MediaStore.Images.Media.IS_PENDING, 0)
      resolver.update(uri, values, null, null)
      return uri
    }
    val dir = legacyDir(ctx, Environment.DIRECTORY_PICTURES)
    val file = File(dir, name)
    FileOutputStream(file).use { bmp.compress(Bitmap.CompressFormat.JPEG, 92, it) }
    MediaScannerConnection.scanFile(ctx, arrayOf(file.absolutePath), arrayOf("image/jpeg"), null)
    return Uri.fromFile(file)
  }

  /** Moves a finished MP4 from the app cache into the gallery. */
  fun saveVideo(ctx: Context, source: File, name: String): Uri {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val values = ContentValues().apply {
        put(MediaStore.Video.Media.DISPLAY_NAME, name)
        put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
        put(MediaStore.Video.Media.RELATIVE_PATH, "${Environment.DIRECTORY_MOVIES}/$FOLDER")
        put(MediaStore.Video.Media.IS_PENDING, 1)
      }
      val resolver = ctx.contentResolver
      val uri = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values)
        ?: error("could not create video")
      resolver.openOutputStream(uri)!!.use { out -> source.inputStream().use { it.copyTo(out) } }
      values.clear()
      values.put(MediaStore.Video.Media.IS_PENDING, 0)
      resolver.update(uri, values, null, null)
      source.delete()
      return uri
    }
    val file = File(legacyDir(ctx, Environment.DIRECTORY_MOVIES), name)
    source.copyTo(file, overwrite = true)
    source.delete()
    MediaScannerConnection.scanFile(ctx, arrayOf(file.absolutePath), arrayOf("video/mp4"), null)
    return Uri.fromFile(file)
  }

  /** Android 9 and older: app-specific folder (no storage permission needed). */
  private fun legacyDir(ctx: Context, type: String): File =
    File(ctx.getExternalFilesDir(type), FOLDER).apply { mkdirs() }
}
