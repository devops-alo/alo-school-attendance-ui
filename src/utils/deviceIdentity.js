// Identifies this laptop for check-in, so the admin panel can flag when two
// students check in from the same laptop on the same day.
//
// deviceId    - random id kept in localStorage and a cookie (either one
//               restores the other); changes only if both are cleared
// fingerprint - hash of hardware/browser traits (GPU, canvas rendering, CPU
//               cores, timezone...), which survives clearing browser data

const STORAGE_KEY = "alo_device_id";
const COOKIE_NAME = "alo_device_id";
const ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const COOKIE_MAX_AGE = 60 * 60 * 24 * 400; // browsers cap cookies at 400 days

const randomId = () => {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const bytes = window.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

const readCookie = () => {
  const entry = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${COOKIE_NAME}=`));
  return entry ? decodeURIComponent(entry.slice(COOKIE_NAME.length + 1)) : null;
};

export const getDeviceId = () => {
  let id = null;
  try {
    id = localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    // storage blocked - fall back to the cookie
  }
  if (!id || !ID_PATTERN.test(id)) {
    const fromCookie = readCookie();
    id = fromCookie && ID_PATTERN.test(fromCookie) ? fromCookie : `dev-${randomId()}`;
  }

  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch (e) {
    // ignore
  }
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(id)}; max-age=${COOKIE_MAX_AGE}; path=/; SameSite=Lax${secure}`;
  return id;
};

const gpuInfo = () => {
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    if (!gl) return "no-webgl";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (!ext) return "webgl";
    return `${gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)}|${gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)}`;
  } catch (e) {
    return "webgl-error";
  }
};

const canvasInfo = () => {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 60;
    const ctx = canvas.getContext("2d");
    ctx.textBaseline = "top";
    ctx.font = "16px Arial";
    ctx.fillStyle = "#f60";
    ctx.fillRect(10, 10, 100, 30);
    ctx.fillStyle = "#069";
    ctx.fillText("Alo check-in ✓ 1234", 4, 8);
    ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
    ctx.fillText("Alo check-in ✓ 1234", 6, 12);
    return canvas.toDataURL();
  } catch (e) {
    return "canvas-error";
  }
};

// Resolves to "fp-<hex>" or null if the browser cannot hash
export const getFingerprint = async () => {
  try {
    if (!window.crypto?.subtle) return null;
    // Leaves out screen size and zoom, which change with an external
    // monitor or Ctrl +/-
    const traits = [
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      navigator.language,
      (navigator.languages || []).join(","),
      navigator.platform,
      navigator.hardwareConcurrency,
      navigator.deviceMemory,
      navigator.maxTouchPoints,
      window.screen?.colorDepth,
      gpuInfo(),
      canvasInfo(),
    ].join("||");
    const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(traits));
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    return `fp-${hex.slice(0, 40)}`;
  } catch (e) {
    return null;
  }
};
