// Location helpers for check-in. The server repeats the same distance check;
// doing it here too just tells the student before they take a selfie.

export const getPosition = () =>
  new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject({ code: "unsupported" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  });

// Great-circle distance in metres
export const distanceMeters = (lat1, lng1, lat2, lng2) => {
  const R = 6371000;
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

export const formatDistance = (metres) =>
  metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres)} m`;

// Readable message for a geolocation error
export const locationErrorMessage = (err) => {
  switch (err?.code) {
    case 1:
      return "Location access is blocked. Click the location icon in the address bar, choose Allow, then try again.";
    case 2:
      return "Your laptop could not find its location. Turn on Wi-Fi and Windows location services (Settings > Privacy & security > Location), then try again.";
    case 3:
      return "Finding your location took too long. Make sure Wi-Fi is on, then try again.";
    case "unsupported":
      return "This browser does not support location. Please use the latest Chrome or Edge.";
    default:
      return "Could not get your location. Please try again.";
  }
};
