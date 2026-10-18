# subject-segmentation (local Expo module)

On-device subject cut-out, free and offline:

- **iOS 17+**: Apple Vision `VNGenerateForegroundInstanceMaskRequest` (no model to ship). Not available in the simulator.
- **Android**: Google ML Kit Subject Segmentation (`play-services-mlkit-subject-segmentation`, beta). Play services downloads the model at install time.

Used by `src/imaging/segment.ts`. Native code, so it needs a development build (`npm run build:android:dev`); in Expo Go the app falls back to colour-based background removal.
