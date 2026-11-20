import React, { useCallback, useEffect, useRef, useState } from "react";
import styles from "./CheckInModal.module.css";
import { FiMapPin, FiCamera, FiCheck, FiAlertTriangle, FiRefreshCw } from "react-icons/fi";

import checkInImg from "../assets/AloLogo/checkin.png";
import { getCampusSettings } from "../api/serviceapi";
import { getPosition, distanceMeters, formatDistance, locationErrorMessage } from "../utils/geo";
import { loadFaceDetector, countFaces } from "../utils/faceDetector";
import { getDeviceId } from "../utils/deviceIdentity";

// Check-in: confirm -> location on campus -> live selfie with a face -> submit.
// The server repeats every check; the ones here only give early, clear errors.

const SELFIE_MAX_WIDTH = 640;
const DETECT_EVERY_MS = 250;

const cameraErrorMessage = (err) => {
  switch (err?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera access is blocked. Click the camera icon in the address bar, choose Allow, then try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera was found on this laptop. A working camera is needed to check in.";
    case "NotReadableError":
      return "The camera is being used by another app (Teams, Zoom, Camera...). Close it, then try again.";
    default:
      return "Could not start the camera. Please try again.";
  }
};

const Spinner = ({ dark }) => (
  <span className={dark ? styles.spinnerDark : styles.spinner} aria-hidden="true" />
);

const STEP_ORDER = ["locating", "camera", "review"];

const Stepper = ({ step }) => {
  const current = step === "submitting" ? 2 : STEP_ORDER.indexOf(step);
  const items = [
    { label: "Location", icon: <FiMapPin /> },
    { label: "Selfie", icon: <FiCamera /> },
    { label: "Confirm", icon: <FiCheck /> },
  ];
  return (
    <ol className={styles.stepper}>
      {items.map((item, i) => (
        <li
          key={item.label}
          className={`${styles.stepItem} ${i === current ? styles.stepActive : ""} ${i < current ? styles.stepDone : ""}`}
        >
          <span className={styles.stepIcon}>{i < current ? <FiCheck /> : item.icon}</span>
          {item.label}
        </li>
      ))}
    </ol>
  );
};

const CheckInModal = ({ isOpen, onClose, onConfirm }) => {
  // intro | locating | camera | review | submitting | error
  const [step, setStep] = useState("intro");
  const [error, setError] = useState(null); // { title, message, retry: "locate" | "camera" }
  const [location, setLocation] = useState(null);
  const [distanceInfo, setDistanceInfo] = useState(null);
  const [faceStatus, setFaceStatus] = useState("loading"); // loading | ready | unavailable
  const [faceCount, setFaceCount] = useState(null);
  const [photo, setPhoto] = useState(null); // { blob, url, faceCheck }

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const openRef = useRef(false);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const fail = useCallback(
    (title, message, retry) => {
      stopCamera();
      setError({ title, message, retry });
      setStep("error");
    },
    [stopCamera]
  );

  // Reset on every open; start loading the face detector in the background
  useEffect(() => {
    openRef.current = isOpen;
    if (!isOpen) {
      stopCamera();
      return undefined;
    }
    setStep("intro");
    setError(null);
    setLocation(null);
    setDistanceInfo(null);
    setFaceCount(null);
    setPhoto(null);
    setFaceStatus(detectorRef.current ? "ready" : "loading");
    if (!detectorRef.current) {
      loadFaceDetector()
        .then((detector) => {
          detectorRef.current = detector;
          if (openRef.current) setFaceStatus("ready");
        })
        .catch((err) => {
          console.warn("Face detection unavailable:", err?.message || err);
          if (openRef.current) setFaceStatus("unavailable");
        });
    }
    return () => stopCamera();
  }, [isOpen, stopCamera]);

  // Free the preview image when it is replaced or the modal closes
  useEffect(() => {
    return () => {
      if (photo?.url) URL.revokeObjectURL(photo.url);
    };
  }, [photo]);

  const startCamera = useCallback(async () => {
    setError(null);
    setPhoto(null);
    setFaceCount(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      if (!openRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      setStep("camera");
    } catch (err) {
      if (openRef.current) fail("Camera needed", cameraErrorMessage(err), "camera");
    }
  }, [fail]);

  const locate = useCallback(async () => {
    setError(null);
    setStep("locating");

    let campus = null;
    try {
      const res = await getCampusSettings();
      campus = res?.data?.data || null;
    } catch (e) {
      // The server still checks the distance on submit
    }

    let pos;
    try {
      pos = await getPosition();
    } catch (err) {
      if (openRef.current) fail("Location needed", locationErrorMessage(err), "locate");
      return;
    }
    if (!openRef.current) return;
    setLocation(pos);

    if (campus?.configured) {
      if (!(pos.accuracy > 0) || pos.accuracy > campus.accuracyLimit) {
        fail(
          "Location not precise enough",
          `Your laptop can only place you within ±${formatDistance(pos.accuracy || 0)}. Turn on Wi-Fi and Windows location services, then try again.`,
          "locate"
        );
        return;
      }
      const distance = distanceMeters(pos.latitude, pos.longitude, campus.latitude, campus.longitude);
      if (distance > campus.radius) {
        fail(
          "You're not on campus",
          `You are ${formatDistance(distance)} away from campus. Check-in is only allowed within ${formatDistance(campus.radius)} of the campus.`,
          "locate"
        );
        return;
      }
      setDistanceInfo({ distance, radius: campus.radius });
    }
    startCamera();
  }, [fail, startCamera]);

  // Attach the camera stream once the <video> is on screen
  useEffect(() => {
    if (step !== "camera") return;
    const video = videoRef.current;
    if (video && streamRef.current) {
      video.srcObject = streamRef.current;
      video.play().catch(() => {});
    }
  }, [step]);

  // Live face count while the camera is showing
  useEffect(() => {
    if (step !== "camera" || faceStatus !== "ready") return undefined;
    const timer = setInterval(() => {
      try {
        const n = countFaces(detectorRef.current, videoRef.current);
        if (n !== null) setFaceCount(n);
      } catch (err) {
        console.warn("Face detection failed:", err?.message || err);
        setFaceStatus("unavailable");
      }
    }, DETECT_EVERY_MS);
    return () => clearInterval(timer);
  }, [step, faceStatus]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    let faceCheck = "skipped";
    if (faceStatus === "ready") {
      let n = null;
      try {
        n = countFaces(detectorRef.current, video);
      } catch (e) {
        n = null;
      }
      if (n !== 1) {
        setFaceCount(n);
        return;
      }
      faceCheck = "passed";
    }

    const scale = Math.min(1, SELFIE_MAX_WIDTH / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    // Mirror like the preview, so the photo looks the way the student saw it
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          fail("Could not take the selfie", "Please try again.", "camera");
          return;
        }
        stopCamera();
        setPhoto({ blob, url: URL.createObjectURL(blob), faceCheck });
        setStep("review");
      },
      "image/jpeg",
      0.85
    );
  };

  const submit = async () => {
    if (!photo || !location) return;
    setStep("submitting");
    const result = await onConfirm({
      selfie: photo.blob,
      faceCheck: photo.faceCheck,
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy,
      deviceId: getDeviceId(),
    });
    if (!openRef.current) return; // parent closed the modal on success
    if (!result?.ok) {
      fail("Check-in failed", result?.message || "Something went wrong, please try again.", "locate");
    }
  };

  const retry = () => (error?.retry === "camera" ? startCamera() : locate());

  if (!isOpen) return null;

  const busy = step === "submitting";
  const captureDisabled = faceStatus === "loading" || (faceStatus === "ready" && faceCount !== 1);

  let faceHint;
  if (faceStatus === "loading") faceHint = { tone: styles.hintInfo, text: "Preparing face detection..." };
  else if (faceStatus === "unavailable")
    faceHint = { tone: styles.hintWarn, text: "Face detection unavailable. Your selfie will be reviewed by the admin." };
  else if (faceCount === 1) faceHint = { tone: styles.hintOk, text: "Face detected" };
  else if (faceCount > 1) faceHint = { tone: styles.hintWarn, text: "Only one person should be in the photo" };
  else faceHint = { tone: styles.hintWarn, text: "Position your face inside the frame" };

  return (
    <div className={styles.overlay}>
      <div className={`${styles.modal} ${step !== "intro" ? styles.modalWide : ""}`} role="dialog" aria-modal="true">
        {step === "intro" && (
          <>
            <img src={checkInImg} alt="Check In" className={styles.image} />
            <h2>Ready to check in?</h2>
            <p className={styles.lead}>
              We'll confirm you're on campus and take a quick selfie. Allow location and camera access when the
              browser asks.
            </p>
            <div className={styles.actions}>
              <button className={styles.confirm} onClick={locate}>
                Start
              </button>
              <button className={styles.cancel} onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}

        {step !== "intro" && step !== "error" && <Stepper step={step} />}

        {step === "locating" && (
          <div className={styles.status}>
            <Spinner dark />
            <h2>Checking your location...</h2>
            <p className={styles.lead}>This can take a few seconds.</p>
            <div className={styles.actionsSingle}>
              <button className={styles.cancel} onClick={onClose}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {step === "camera" && (
          <>
            <h2 className={styles.title}>Take a selfie</h2>
            {distanceInfo && (
              <p className={styles.onCampus}>
                <FiMapPin /> On campus ({formatDistance(distanceInfo.distance)} from the campus point)
              </p>
            )}
            <div className={styles.videoWrap}>
              <video ref={videoRef} className={styles.video} playsInline muted />
              <div className={`${styles.faceGuide} ${faceCount === 1 && faceStatus === "ready" ? styles.faceGuideOk : ""}`} />
            </div>
            <p className={`${styles.hint} ${faceHint.tone}`}>{faceHint.text}</p>
            <div className={styles.actions}>
              <button className={styles.confirm} onClick={capture} disabled={captureDisabled}>
                <FiCamera /> Capture
              </button>
              <button className={styles.cancel} onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}

        {(step === "review" || step === "submitting") && photo && (
          <>
            <h2 className={styles.title}>Use this selfie?</h2>
            <div className={styles.videoWrap}>
              <img src={photo.url} alt="Your selfie" className={styles.photo} />
            </div>
            {photo.faceCheck === "skipped" && (
              <p className={`${styles.hint} ${styles.hintWarn}`}>Face check skipped. The admin will review this selfie.</p>
            )}
            <div className={styles.actions}>
              <button className={styles.confirm} onClick={submit} disabled={busy}>
                {busy ? <Spinner /> : "Check in"}
              </button>
              <button className={styles.cancel} onClick={startCamera} disabled={busy}>
                <FiRefreshCw /> Retake
              </button>
            </div>
          </>
        )}

        {step === "error" && error && (
          <div className={styles.status}>
            <span className={styles.errorIcon}>
              <FiAlertTriangle />
            </span>
            <h2>{error.title}</h2>
            <p className={styles.lead}>{error.message}</p>
            <div className={styles.actions}>
              <button className={styles.confirm} onClick={retry}>
                Try again
              </button>
              <button className={styles.cancel} onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CheckInModal;
