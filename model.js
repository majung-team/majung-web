export const terminalStatuses = new Set(["COMPLETED", "CANCELLED", "EXPIRED"]);
const idPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function parseInvitation(hash) {
  const parts = hash.replace(/^#/, "").split("/");
  if (
    parts.length !== 3 ||
    parts[0] !== "join" ||
    !idPattern.test(parts[1]) ||
    !tokenPattern.test(parts[2])
  )
    return null;
  return { pickupId: parts[1], inviteToken: parts[2] };
}

export function parseHostInvitation(hash) {
  if (!hash.startsWith("#share/")) return null;
  return parseInvitation(hash.replace(/^#share\//, "#join/"));
}

export function validSession(value) {
  return Boolean(
    value &&
      ["driver", "guest"].includes(value.role) &&
      idPattern.test(value.pickupId) &&
      tokenPattern.test(value.token) &&
      (value.role !== "guest" || idPattern.test(value.participantId)),
  );
}

export function invitationUrl(origin, pickupId, token) {
  return `${origin}/#join/${pickupId}/${token}`;
}

export function nextSequence(snapshot) {
  return (snapshot?.participant?.readinessSequence ?? 0) + 1;
}

export function vehicleDeadline(vehicle, requestStarted, responseReceived) {
  // Subtract the entire round trip; do not trust the phone's wall clock.
  const lifetime = Number(vehicle?.validForMillis);
  if (
    vehicle?.freshness !== "FRESH" ||
    !Number.isFinite(lifetime) ||
    lifetime <= 0
  )
    return 0;
  return (
    responseReceived +
    Math.max(0, lifetime - (responseReceived - requestStarted))
  );
}

export function visibleVehicle(vehicle, deadline, now, online, status) {
  if (
    !online ||
    !["ACTIVE", "ARRIVED"].includes(status) ||
    deadline <= now ||
    vehicle?.freshness !== "FRESH"
  )
    return null;
  if (
    !Number.isFinite(vehicle.latitude) ||
    !Number.isFinite(vehicle.longitude) ||
    !Number.isFinite(vehicle.durationSeconds) ||
    vehicle.durationSeconds < 0
  )
    return null;
  return vehicle;
}

// Matches majung.vehicle-last-known on the server: stop counting down after this age.
export const COUNTDOWN_STOP_MILLIS = 120000;

export function vehicleTiming(vehicle, requestStarted, responseReceived) {
  // The round trip counts as elapsed time; the phone's wall clock is never used.
  const age = Number(vehicle?.ageMillis);
  if (vehicle?.ageMillis == null || !Number.isFinite(age) || age < 0) return null;
  return {
    ageMillis: age + Math.max(0, responseReceived - requestStarted),
    at: responseReceived,
  };
}

export function vehicleView(vehicle, timing, deadline, now, online, status) {
  if (
    !online ||
    !["ACTIVE", "ARRIVED"].includes(status) ||
    !timing ||
    !["FRESH", "STALE"].includes(vehicle?.freshness)
  )
    return null;
  const ageMillis = timing.ageMillis + Math.max(0, now - timing.at);
  const fresh = visibleVehicle(vehicle, deadline, now, online, status);
  const usable =
    Number.isFinite(vehicle.latitude) &&
    Number.isFinite(vehicle.longitude) &&
    Number.isFinite(vehicle.durationSeconds) &&
    vehicle.durationSeconds >= 0;
  if (!fresh && (!usable || ageMillis >= COUNTDOWN_STOP_MILLIS))
    return { kind: "lost", ageMillis };
  return {
    kind: fresh ? "fresh" : "stale",
    ageMillis,
    latitude: vehicle.latitude,
    longitude: vehicle.longitude,
    remainingSeconds: Math.max(
      0,
      Math.ceil((vehicle.durationSeconds * 1000 - ageMillis) / 1000),
    ),
  };
}

export function etaText(view) {
  return view.remainingSeconds > 0
    ? `약 ${Math.ceil(view.remainingSeconds / 60)}분`
    : "곧 도착";
}

export function ageText(ageMillis) {
  const seconds = Math.max(0, Math.floor(ageMillis / 1000));
  return seconds < 60 ? `${seconds}초 전` : `${Math.floor(seconds / 60)}분 전`;
}

export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
}
