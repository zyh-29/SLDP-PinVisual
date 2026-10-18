import CoreVideo
import ExpoModulesCore
import UIKit
import Vision

/// On-device subject cut-out with Apple Vision (iOS 17+), the same feature as
/// "lift subject from background" in Photos. Free, offline, no model to ship.
public class SubjectSegmentationModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SubjectSegmentation")

    Function("isSupported") { () -> Bool in
      if #available(iOS 17.0, *) {
        return true
      }
      return false
    }

    /// Cuts out the main subject of the image at `uri` and returns a mask of
    /// exactly `width` x `height` pixels, one byte per pixel (0 = background,
    /// 255 = subject), base64 encoded. `found` is false when there is no subject.
    AsyncFunction("segmentAsync") { (uri: String, width: Int, height: Int) -> [String: Any] in
      guard #available(iOS 17.0, *) else {
        throw SegmentationUnsupportedException()
      }
      return try segment(uri: uri, width: width, height: height)
    }
  }

  @available(iOS 17.0, *)
  private func segment(uri: String, width: Int, height: Int) throws -> [String: Any] {
    guard width > 0, height > 0 else {
      throw ImageLoadException(uri)
    }
    let url = URL(string: uri) ?? URL(fileURLWithPath: uri)
    guard let data = try? Data(contentsOf: url), let source = UIImage(data: data) else {
      throw ImageLoadException(uri)
    }

    // Draw at the requested size (upright), so the mask lines up with the app's pixels.
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    let rect = CGRect(x: 0, y: 0, width: width, height: height)
    let drawn = UIGraphicsImageRenderer(size: rect.size, format: format).image { context in
      UIColor.white.setFill()
      context.fill(rect)
      source.draw(in: rect)
    }
    guard let cgImage = drawn.cgImage else {
      throw ImageLoadException(uri)
    }

    let request = VNGenerateForegroundInstanceMaskRequest()
    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    try handler.perform([request])
    guard let observation = request.results?.first, !observation.allInstances.isEmpty else {
      return ["found": false, "mask": ""]
    }
    let buffer = try observation.generateScaledMaskForImage(forInstances: observation.allInstances, from: handler)
    return ["found": true, "mask": Data(readMask(buffer, width: width, height: height)).base64EncodedString()]
  }

  /// Copies a one-channel mask buffer into `width` x `height` bytes (nearest neighbour if sizes differ).
  private func readMask(_ buffer: CVPixelBuffer, width: Int, height: Int) -> [UInt8] {
    CVPixelBufferLockBaseAddress(buffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
    var out = [UInt8](repeating: 0, count: width * height)
    guard let base = CVPixelBufferGetBaseAddress(buffer) else { return out }
    let bw = CVPixelBufferGetWidth(buffer)
    let bh = CVPixelBufferGetHeight(buffer)
    let rowBytes = CVPixelBufferGetBytesPerRow(buffer)
    let isFloat = CVPixelBufferGetPixelFormatType(buffer) == kCVPixelFormatType_OneComponent32Float
    for y in 0..<height {
      let sy = min(bh - 1, y * bh / height)
      let row = base.advanced(by: sy * rowBytes)
      for x in 0..<width {
        let sx = min(bw - 1, x * bw / width)
        let value: Float = isFloat
          ? row.assumingMemoryBound(to: Float32.self)[sx]
          : Float(row.assumingMemoryBound(to: UInt8.self)[sx]) / 255
        out[y * width + x] = UInt8(max(0, min(255, value * 255)))
      }
    }
    return out
  }
}

internal final class SegmentationUnsupportedException: Exception {
  override var reason: String {
    "Subject cut-out needs iOS 17 or later"
  }
}

internal final class ImageLoadException: GenericException<String> {
  override var reason: String {
    "Could not read the image at \(param)"
  }
}
