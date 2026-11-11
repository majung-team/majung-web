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

export function nativeInvitationUrl(invitation) {
  if (!invitation || !idPattern.test(invitation.pickupId) ||
      !tokenPattern.test(invitation.inviteToken)) return null;
  return `majung://join/${invitation.pickupId}/${invitation.inviteToken}`;
}

export function supportsIOSApp(navigator) {
  return /iPhone|iPad|iPod/.test(navigator?.userAgent || "") ||
    (navigator?.platform === "MacIntel" && navigator?.maxTouchPoints > 1);
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

// The receipt confirms the vehicle app received this sequence, not that the driver read it.
export function readinessDeliveryText(participant, online = true) {
  if (!online) return "연결을 확인하고 있어요.";
  const sequence = participant?.readinessSequence;
  const received = participant?.readinessReceivedSequence;
  if (!Number.isSafeInteger(sequence) || sequence <= 0) return "준비 상태를 선택하면 차량에 전달해요.";
  if (!Number.isSafeInteger(received)) return "준비 상태를 보냈어요.";
  return received >= sequence
    ? "차량에 전달됐어요."
    : "차량 연결을 기다리고 있어요.";
}

// Snapshot and telemetry may be fetched across a place change. Never mix their versions.
export function vehicleForPlace(pickup, vehicle) {
  const placeVersion = pickup?.placeVersion ?? 1;
  const vehicleVersion = vehicle?.placeVersion ?? 1;
  return Number.isSafeInteger(placeVersion) && placeVersion > 0 &&
    placeVersion === vehicleVersion ? vehicle : null;
}


// Both invite links and account tracking render the same participant controls.
export function readinessControl({ participant, online = true, sending = false, retry = null,
  prefix = '', attributes = '', blocked = false, pendingValue = null }) {
  const displayed = sending && pendingValue ? pendingValue : participant?.readiness === 'READY' ? 'READY' : 'PREPARING';
  const ready = displayed === 'READY';
  return `<section class="readiness-card" aria-label="탑승 준비 상태" aria-busy="${sending}">
    <div class="readiness-card-header"><strong class="readiness-card-title">탑승 준비 상태</strong>
      <span class="readiness-card-status ${ready ? 'ready' : ''}" role="status">${sending ? '보내는 중…' : ready ? '준비 완료' : '준비 중'}</span></div>
    <div class="readiness-segmented-control ${ready ? 'is-ready' : 'is-preparing'}" role="group" aria-label="탑승 준비 상태 변경">
      <span class="readiness-slider" aria-hidden="true"></span>
      ${[['PREPARING','준비 중','preparing'],['READY','탑승 준비 완료','ready']].map(([value,label,action]) => `<button type="button" class="readiness-seg-btn ${(ready ? value === 'READY' : value === 'PREPARING') ? 'selected' : ''}${ready && value === 'READY' ? ' ready' : ''}" data-action="${prefix}${action}" ${attributes} aria-pressed="${displayed === value}" ${!online || sending || blocked ? 'disabled' : ''}>${label}</button>`).join('')}
    </div>
    <p class="readiness-delivery" role="status">${sending ? '준비 상태를 차량에 보내고 있어요.' : escapeHtml(readinessDeliveryText(participant, online))}</p>
    ${retry && !sending ? `<p class="readiness-error" role="alert">전송 결과를 확인하지 못했어요. 이전 준비 상태를 표시하고 있어요.</p><button type="button" class="quiet" data-action="${prefix}retry-readiness" ${attributes} ${!online || blocked ? 'disabled' : ''}>준비 상태 다시 보내기</button>` : ''}
  </section>`;
}

export function quickMessageControl({ value = '', message = '', online = true, prefix = 'guest-', attributes = '' }) {
  return `<section class="voice-composer-card" aria-label="운전자에게 메시지 보내기">
    <div class="voice-header-row"><strong class="voice-title">운전자에게 메시지</strong><span class="voice-subtitle">아래 문구는 누르면 바로 보내요</span></div>
    <div class="quick-chips">${['지금 내려가요','1번 출구 앞이에요','곧 도착해요'].map(text => `<button type="button" class="quiet quick-chip" data-action="${prefix}quick-msg" data-msg="${escapeHtml(text)}" ${attributes} ${!online ? 'disabled' : ''}>${text}</button>`).join('')}</div>
    <form class="quick-input-form quick-msg-form" ${attributes}><label class="sr-only">운전자에게 보낼 메시지</label><input type="text" name="quickMsg" class="quick-msg-input" aria-label="운전자에게 보낼 메시지" placeholder="메시지 입력 (최대 50자)" maxlength="50" autocomplete="off" value="${escapeHtml(value)}" ${!online ? 'disabled' : ''}/><button type="submit" class="quick-send-btn" ${!online ? 'disabled' : ''}>전송</button></form>
    <p class="hint quick-msg-count" data-message-count>${String(value).length}/50자</p>
    ${message ? `<p class="quick-msg-hint">보낸 메시지 · <strong>“${escapeHtml(message)}”</strong></p>` : ''}
  </section>`;
}

export function beginReadinessSend(root, value) {
  const control = root.querySelector(".readiness-segmented-control");
  if (!control) return;
  const ready = value === "READY";
  control.classList.toggle("is-ready", ready);
  control.classList.toggle("is-preparing", !ready);
  control.querySelectorAll("button").forEach(button => {
    const selected = button.dataset.action.endsWith(ready ? "ready" : "preparing");
    button.disabled = true;
    button.classList.toggle("selected", selected);
    button.classList.toggle("ready", ready && selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  const card = control.closest(".readiness-card");
  card?.setAttribute("aria-busy", "true");
  const status = card?.querySelector(".readiness-card-status");
  if (status) status.textContent = "보내는 중…";
  const delivery = card?.querySelector(".readiness-delivery");
  if (delivery) delivery.textContent = "준비 상태를 차량에 보내고 있어요.";
}

// Arrival is a server state, never inferred from a countdown reaching zero.
export function pickupStatusNotice(pickup, action = '') {
  if (!pickup) return '';
  const titles = {ARRIVED:'마중 차량이 도착했어요', CANCELLED:'픽업이 취소됐어요', EXPIRED:'픽업 시간이 만료됐어요', COMPLETED:'픽업이 완료됐어요'};
  const title = titles[pickup.status];
  if (!title) return '';
  const arrived = pickup.status === 'ARRIVED';
  return `<section class="pickup-status-notice ${arrived ? 'is-arrived' : 'is-ended'}" role="${arrived ? 'status' : 'alert'}" aria-live="assertive"><div><strong>${title}</strong><p>${arrived ? `${escapeHtml(pickup.place?.label || '약속 장소')} 근처에서 차량을 확인해주세요. 탑승 후 운전자가 픽업을 완료해요.` : '차량 위치 공유가 끝났어요. 이전 도착 시간은 더 이상 유효하지 않아요.'}</p></div>${action}</section>`;
}
export function vehicleFreshnessText(view) {
  if (!view) return '차량에서 위치를 보내면 지도와 도착 시간이 표시돼요.';
  if (view.kind === 'lost') return '갱신이 멈춰 도착 시간을 숨겼어요. 연결이 복구되면 다시 표시해요.';
  return view.kind === 'stale' ? `갱신 지연 · 마지막 정보 ${ageText(view.ageMillis)}. 현재 도착 시간과 다를 수 있어요.` : `차량 정보 ${ageText(view.ageMillis)} 갱신`;
}
export const quickMessageSavedText = '메시지를 보냈어요.';

export function pickupEtaLabel(status, view, online = true) {
  if (!online) return '인터넷 연결 확인 중';
  if (status === 'ARRIVED') return '차량 도착 · 약속 장소 확인';
  if (view?.kind === 'lost') return '차량 위치 확인 중';
  if (view?.remainingSeconds !== undefined) {
    const time=view.remainingSeconds > 0 ? `약 ${Math.ceil(view.remainingSeconds/60)}분 후 도착` : '곧 도착 예정';
    return view.kind === 'stale' ? `마지막 예상 · ${time}` : time;
  }
  return view ? '도착 시간 확인 중' : '차량 정보 수신 대기';
}

export function guestPickupHeading(status, view, online) {
  if (status === "ARRIVED") return "차량이 도착했어요";
  if (!online) return "픽업 정보를 다시 확인하고 있어요";
  if (!view) return "차량 위치와 도착 시간을 기다리고 있어요";
  if (view.kind !== "fresh") return "차량 정보가 잠시 끊겼어요";
  return "마중 차량이 오고 있어요";
}
