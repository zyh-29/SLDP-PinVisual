package expo.modules.subjectsegmentation

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.segmentation.subject.SubjectSegmentation
import com.google.mlkit.vision.segmentation.subject.SubjectSegmenterOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * On-device subject cut-out with Google ML Kit Subject Segmentation.
 * Free and offline; Google Play services downloads the model at install time
 * (see AndroidManifest.xml).
 */
class SubjectSegmentationModule : Module() {
  private val segmenterLazy = lazy {
    SubjectSegmentation.getClient(
      SubjectSegmenterOptions.Builder()
        .enableForegroundConfidenceMask()
        .build()
    )
  }
  private val segmenter by segmenterLazy

  override fun definition() = ModuleDefinition {
    Name("SubjectSegmentation")

    Function("isSupported") {
      true
    }

    /**
     * Cuts out the main subject of the image at `uri` and returns a mask of
     * exactly `width` x `height` pixels, one byte per pixel (0 = background,
     * 255 = subject), base64 encoded. `found` is false when there is no subject.
     */
    AsyncFunction("segmentAsync") { uri: String, width: Int, height: Int, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("ERR_NO_CONTEXT", "The app is not ready", null)
        return@AsyncFunction
      }
      val bitmap = try {
        val parsed = Uri.parse(uri)
        val decoded = if (parsed.scheme == null || parsed.scheme == "file") {
          BitmapFactory.decodeFile(parsed.path ?: uri)
        } else {
          context.contentResolver.openInputStream(parsed)?.use { BitmapFactory.decodeStream(it) }
        }
        decoded?.let { if (it.width == width && it.height == height) it else Bitmap.createScaledBitmap(it, width, height, true) }
      } catch (e: Exception) {
        null
      }
      if (bitmap == null || width <= 0 || height <= 0) {
        promise.reject("ERR_IMAGE", "Could not read the image at $uri", null)
        return@AsyncFunction
      }

      segmenter.process(InputImage.fromBitmap(bitmap, 0))
        .addOnSuccessListener { result ->
          val confidence = result.foregroundConfidenceMask
          if (confidence == null) {
            promise.resolve(mapOf("found" to false, "mask" to ""))
            return@addOnSuccessListener
          }
          confidence.rewind()
          val bytes = ByteArray(width * height)
          var any = false
          for (i in 0 until minOf(bytes.size, confidence.remaining())) {
            val v = (confidence.get(i) * 255f).toInt().coerceIn(0, 255)
            if (v >= 128) any = true
            bytes[i] = v.toByte()
          }
          promise.resolve(mapOf("found" to any, "mask" to Base64.encodeToString(bytes, Base64.NO_WRAP)))
        }
        .addOnFailureListener { e ->
          // Most often: the model is still downloading right after install.
          promise.reject("ERR_SEGMENTATION", e.message ?: "Subject cut-out failed", e)
        }
    }

    OnDestroy {
      if (segmenterLazy.isInitialized()) segmenter.close()
    }
  }
}
