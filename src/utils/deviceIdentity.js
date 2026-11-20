// Identifies this laptop for check-in, so the admin panel can flag when two
// students check in from the same laptop on the same day.
//
// deviceId - random id kept in localStorage and a cookie (either one restores
//            the other). Two laptops never share one; it changes only if the
//            browser data is cleared, or the student uses another browser or
//            an Incognito window.

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
