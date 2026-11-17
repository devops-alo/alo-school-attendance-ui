// In-browser face detection for the check-in selfie (Google MediaPipe,
// BlazeFace model). Free, no account or API key; the library (~10 MB, cached
// by the browser after the first load) comes from a CDN at a pinned version.
// If it cannot load, the check-in falls back to a plain selfie and the record
// is marked "face check skipped" for the admin.

const MEDIAPIPE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
const LOAD_TIMEOUT_MS = 20000;
const MIN_CONFIDENCE = 0.6;

let detectorPromise = null;

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Face detector load timed out")), ms)),
  ]);

const createDetector = async () => {
  // Loaded at runtime from the CDN, not bundled by webpack
  const vision = await import(
    /* webpackIgnore: true */ "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs"
  );
  const fileset = await vision.FilesetResolver.forVisionTasks(`${MEDIAPIPE}/wasm`);
  return vision.FaceDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL, delegate: "CPU" },
    runningMode: "VIDEO",
    minDetectionConfidence: MIN_CONFIDENCE,
  });
};

// Shared across check-ins; retried on the next call if it failed
export const loadFaceDetector = () => {
  if (!detectorPromise) {
    detectorPromise = withTimeout(createDetector(), LOAD_TIMEOUT_MS).catch((err) => {
      detectorPromise = null;
      throw err;
    });
  }
  return detectorPromise;
};

let lastTimestamp = 0;

// Number of faces in the current video frame, or null if the frame isn't ready
export const countFaces = (detector, video) => {
  if (!detector || !video || video.readyState < 2 || !video.videoWidth) return null;
  // VIDEO mode needs strictly increasing timestamps
  const now = Math.max(performance.now(), lastTimestamp + 1);
  lastTimestamp = now;
  const result = detector.detectForVideo(video, now);
  return (result?.detections || []).length;
};
