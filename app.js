import { existingArrivalSubscription } from "./push.js";
import { guestPickupHeading, pickupEtaLabel, pickupStatusNotice, vehicleFreshnessText, quickMessageSavedText, readinessControl, quickMessageControl, beginReadinessSend } from "./model.js";
import { openPickupStream } from "./stream.js";
import { request, ApiError } from "./api.js";
import {
  parseInvitation,
  nativeInvitationUrl,
  supportsIOSApp,
  parseHostInvitation,
  validSession,
  invitationUrl,
  nextSequence,
  vehicleDeadline,
  vehicleTiming,
  vehicleView,
  vehicleForPlace,
  ageText,
  terminalStatuses,
  escapeHtml as e,
} from "./model.js";
import {
  browserPushEnvironment,
  pushState,
  pushCard,
  pushErrorText,
  enableArrivalPush,
  disableBrowserPush,
  pushFlag,
  setPushFlag,
} from "./push.js";
import { loadKakaoMaps, createPickupMap, searchPickupPlaces } from "./map.js";
import { proposalBlock, createProposalPanel, unavailableProposal } from "./proposal.js";

let toastTimer = null;
function showToast(msg, type = "info", duration = 3600) {
  if (typeof document === "undefined" || !document.body || typeof document.getElementById !== "function") return;
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    container.setAttribute("aria-live", "polite");
    document.body.appendChild(container);
  }

  // Singleton: dismiss previous toast immediately so toasts never stack
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  const existing = container.querySelector(".toast");
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.setAttribute("role", "status");

  let iconText = "💬";
  if (type === "arrival") iconText = "🚘";
  else if (type === "success") iconText = "✓";
  else if (type === "warning") iconText = "⚠️";

  const cleanMsg = String(msg).replace(/^(💬|🎉|🚗|📍|🚘|⏱️|✨|👍)\s*/, "");
  toast.innerHTML = `<span class="toast-symbol">${iconText}</span><span class="toast-text">${e(cleanMsg)}</span>`;

  toast.addEventListener("click", () => {
    toast.classList.add("toast-hiding");
    setTimeout(() => toast.remove(), 180);
  });
  container.appendChild(toast);

  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try {
      if (type === "arrival") navigator.vibrate([150, 80, 150]);
      else if (type === "success") navigator.vibrate([80, 40, 80]);
      else navigator.vibrate(40);
    } catch (_) {}
  }

  toastTimer = setTimeout(() => {
    toast.classList.add("toast-hiding");
    setTimeout(() => {
      toast.remove();
      if (toastTimer) toastTimer = null;
    }, 200);
  }, duration);
}

let upgradedPushFor = null;
const root = document.querySelector("#app");
const storageKey = "majung.pickup.session.v1";
let invitation = parseInvitation(location.hash);
let reopenedInvitation = null;
let unavailableInvitation = "";
let invitationPreview = null;
let invitationChecking = false;
let invitationCheckFailed = false;
const hostInvitation = parseHostInvitation(location.hash);
const invalidInvitation = Boolean(
  (location.hash.startsWith("#join") || location.hash.startsWith("#share")) && !invitation && !hostInvitation,
);
// A second invitation opened in the same tab is a new session entry point.
// Reload with its fragment intact so a previous request/session cannot handle it.
window.addEventListener("hashchange", () => {
  if (location.hash.startsWith("#join") || location.hash.startsWith("#share")) location.reload();
});
// Remove the fragment before loading or requesting anything else.
if (location.hash) history.replaceState(null, "", location.pathname);
let session = null;
let storageAvailable = true;
try {
  const restored = JSON.parse(sessionStorage.getItem(storageKey) || "null");
  if (!hostInvitation && !invalidInvitation && validSession(restored) &&
      (!invitation || (restored.role === "guest" && restored.pickupId === invitation.pickupId))) {
    session = restored;
    // Reopening an already used invitation resumes its existing participant authority.
    // The server still decides whether that authority is active, ended or revoked.
    if (invitation) {
      reopenedInvitation = invitation;
      invitation = null;
    }
  }
} catch {
  storageAvailable = false;
}
let snapshot = null;
let vehicle = null;
let deadline = 0;
let timing = null;
let pickupMap = null;
let picking = false;
let online = false;
let busy = false;
let refreshing = false;
let epoch = 0;
let page = invitation || invalidInvitation ? "join" : "home";
let message = invalidInvitation
  ? "초대 링크를 확인해주세요. 받은 링크를 다시 열어주세요."
  : "";
let notice = "";
let finished = null;
let pendingReadiness = null;
let readinessSending = false;
let readinessRevision = 0;
let manualLink = false;
let renderedMarkup = "";
let developmentToolsEnabled = false;
let pushKey = null;
let pushBusy = false;
let pushMessage = "";
const draft = { label: "", latitude: "", longitude: "" };
const readinessText = {
  WAITING: "아직 준비 중이에요",
  PREPARING: "출발을 준비하고 있어요",
  READY: "준비가 끝났어요",
};

let guestQuickMsgText = "";
let proposalMaps=null;
const proposalPanel = createProposalPanel({
  searchPlaces: (keyword,page) => searchPickupPlaces(proposalMaps,keyword,page),
  onSelectPoint: place => pickupMap?.selectPickingPoint(place) ?? false,
  onSubmit: sendProposal,
  onCancel: () => { picking = false; proposalPanel.reset(); render(); },
  onBlur: () => render(),
});

function storeSession() {
  try {
    if (session) sessionStorage.setItem(storageKey, JSON.stringify(session));
    else sessionStorage.removeItem(storageKey);
  } catch {
    storageAvailable = false;
  }
}

function forgetSession() {
  epoch += 1;
  session = null;
  snapshot = null;
  vehicle = null;
  deadline = 0;
  timing = null;
  pendingReadiness = null;
  picking = false;
  activeTabModal = null;
  proposalPanel.reset();
  online = false;
  manualLink = false;
  storeSession();
}

function finish(data) {
  finished = { role: session.role, status: data.status };
  forgetSession();
  invitation = null;
  message = "";
  notice = "";
}

const button = (text, action, quiet = false, disabled = false) =>
  `<button type="button" data-action="${action}" class="${quiet ? "quiet" : "primary"}" ${busy || disabled ? "disabled" : ""}>${text}</button>`;

function alerts() {
  return `${message ? `<div class="alert" role="alert"><strong>확인이 필요해요</strong><p>${e(message)}</p>${session?button("현재 상태 다시 확인", "refresh", true):""}</div>` : ""}
    ${notice ? `<p class="notice" role="status">${e(notice)}</p>` : ""}
    ${!storageAvailable ? '<p class="hint">이 브라우저에서는 세션을 저장할 수 없어요. 새로고침하면 다시 초대가 필요해요.</p>' : ""}`;
}

function home() {
  return `<section class="intro service-intro"><p class="eyebrow">함께 만날 약속, 마중</p>
    <h1>차가 언제 오는지<br />함께 확인해요.</h1><p>만날 장소를 정하고 준비 상태를 전해보세요.<br />차량이 출발하면 위치와 도착 시간을 확인할 수 있어요.</p>
    <a class="primary service-start" href="/account">운전자 찾아 마중 요청하기</a></section>
    <section class="card service-guide"><h2>처음이라면 이렇게 시작해요.</h2><ol><li><strong>운전자를 찾아요.</strong><span>카카오로 로그인하고 닉네임이나 마중 ID로 찾아주세요.</span></li><li><strong>만날 장소를 보내요.</strong><span>장소를 검색하고 운전자가 수락하면 픽업 대기에 들어가요.</span></li><li><strong>위치와 시간을 함께 봐요.</strong><span>내 픽업이 시작되면 준비 상태를 전하고 도착 시간을 확인해요.</span></li></ol></section>
    <section class="card"><h2>초대 링크를 받았어요</h2><p>운전자가 보낸 메시지에서 초대 링크를 열어주세요. 회원가입 없이 이번 픽업에 참여할 수 있어요.</p></section>
    ${developmentToolsEnabled ? `<details class="dev-card"><summary>개발 도구</summary><p>차량 없이 API를 확인하는 로컬 시험용 화면이에요.</p>${button("픽업 준비하기", "prepare", true)}</details>` : ""}`;
}

function hostShare() {
  const url = invitationUrl(location.origin, hostInvitation.pickupId, hostInvitation.inviteToken);
  return `<section class="intro small"><p class="eyebrow">운전자 · 초대 전달</p><h1>이 링크를<br />탑승자에게 보내주세요.</h1><p>이 화면에서는 픽업에 참여하지 않아요.<br />탑승자가 링크를 열고 참여하면 차량에서 확인해주세요.</p></section>
    <section class="card">${button("카카오톡 등으로 초대 보내기", "share-passenger-invite")}${button("초대 링크 복사", "copy-passenger-invite", true)}
    ${manualLink ? `<label>초대 링크<input readonly value="${e(url)}" aria-label="탑승자 초대 링크" /></label>` : ""}
    <p class="hint">링크는 초대한 사람에게만 보내주세요. 새로고침하면 차량 QR을 다시 스캔해야 해요. 만료된 초대는 차량에서 다시 만들어주세요.</p></section>`;
}

function createForm() {
  if (!developmentToolsEnabled) return home();
  return `<section class="intro small"><p class="eyebrow">운전자 · 개발 확인용</p><h1>만날 장소를<br />정해주세요.</h1><p>개발 확인을 위한 임시 입력 화면이에요.<br />차량 앱에서는 내비게이션에서 선택한 장소로 약속을 만들어요.</p></section>
    <form id="create-form" class="card"><label for="place-label">만날 장소<input id="place-label" name="label" required maxlength="120" value="${e(draft.label)}" placeholder="예: 역 앞 공영주차장" /></label>
    <div class="input-pair"><label for="latitude">위도<input id="latitude" name="latitude" type="number" min="-90" max="90" step="any" required value="${e(draft.latitude)}" placeholder="37.0" /></label>
    <label for="longitude">경도<input id="longitude" name="longitude" type="number" min="-180" max="180" step="any" required value="${e(draft.longitude)}" placeholder="127.0" /></label></div>
    <p class="hint">시연할 때는 실제 위치 대신 예시 좌표를 사용해주세요.</p>
    <button class="primary" ${busy ? "disabled" : ""}>${busy ? "약속을 만들고 있어요…" : "약속 만들기"}</button></form>
    ${button("돌아가기", "home", true)}`;
}

async function checkInvitation() {
  if (!invitation || invitationChecking) return;
  const invite = invitation;
  invitationChecking = true;
  invitationCheckFailed = false;
  render();
  try {
    const preview = await request(`/${invite.pickupId}/invitation-preview`, {
      method: "POST", body: { inviteToken: invite.inviteToken },
    });
    if (invite === invitation) invitationPreview = preview;
  } catch (error) {
    if (invite !== invitation) return;
    if (error instanceof ApiError && error.code === "INVITE_UNAVAILABLE") {
      unavailableInvitation = "이 초대 링크는 더 이상 사용할 수 없어요.";
      invitation = null;
    } else invitationCheckFailed = true;
  } finally {
    invitationChecking = false;
    render();
  }
}

function nativeInvitationAction() {
  if (!supportsIOSApp(globalThis.navigator)) return "";
  const url = nativeInvitationUrl(invitation);
  if (!url) return "";
  return `<aside class="app-release-note"><strong>iOS 앱은 아직 정식 출시 전이에요.</strong><p>앱을 설치하지 않아도 이 웹에서 바로 참여할 수 있어요.</p><details class="test-app-handoff"><summary>테스트 앱을 설치한 경우</summary><a class="button quiet" href="${e(url)}">테스트 앱에서 초대 열기</a><p class="hint">별도로 제공받은 테스트 앱이 설치된 기기에서만 열려요. 설치하지 않았다면 아래 웹 참여 버튼을 이용해주세요.</p></details></aside>`;
}

function joinForm() {
  if (unavailableInvitation)
    return `<section class="card"><h1>${e(unavailableInvitation)}</h1><p>운전자에게 새 초대 링크를 받아 열어주세요.</p>${button("처음으로", "home", true)}</section>`;
  if (!invitation)
    return `<section class="card"><h1>초대가 필요해요.</h1><p>운전자에게 받은 링크를 다시 열어주세요.</p>${button("처음으로", "home", true)}</section>`;
  if (!invitationPreview)
    return invitationCheckFailed
      ? `<section class="card"><h1>초대를 확인하지 못했어요.</h1><p>인터넷 연결을 확인한 뒤 다시 시도해주세요.</p>${button("초대 다시 확인", "retry-invitation")}</section>`
      : '<section class="card" role="status"><h1>초대를 확인하고 있어요.</h1></section>';
  return `<section class="intro small"><p class="eyebrow">마중 약속 초대</p><h1>이 장소에서 만날까요?</h1><p>가입 없이 참여할 수 있어요.</p></section>
    <section class="card"><div class="place"><span>만날 장소</span><strong>${e(invitationPreview.placeLabel)}</strong></div>${nativeInvitationAction()}</section>
    <form id="join-form" class="card"><p class="hint">이름이나 가입 없이 참여해요. 이 링크는 한 사람만 쓸 수 있어요. 참여하면 만날 장소·차량 위치·도착 시간과 내 준비 상태를 공유해요. 휴대전화의 이동 위치나 연락처는 요청하지 않아요.</p>
    <button class="primary" ${busy ? "disabled" : ""}>${busy ? "연결하고 있어요…" : "약속에 참여하기"}</button></form>`;
}

function placeCard() {
  return snapshot?.place
    ? `<div class="place"><span>함께 만날 장소</span><strong>${e(snapshot.place.label)}</strong></div>`
    : "";
}

function connection() {
  return `<div class="connection ${online ? "connected" : "disconnected"}"><span class="dot"></span>${online ? "서버에서 상태를 확인했어요" : "연결을 확인하고 있어요"}
    ${button("다시 확인", "refresh", true)}</div>`;
}

function invitationCard() {
  const invite = session.invite;
  if (!invite)
    return `<p class="hint">이 탭에는 초대 링크가 남아 있지 않아요. 새로 초대해주세요.</p>`;
  const url = invitationUrl(location.origin, session.pickupId, invite.token);
  return `<div class="invite-card"><h2>기다리는 사람을 초대해요.</h2><p>링크로 참여한 뒤 운전자 확인이 필요해요.</p>
    <div class="button-pair">${button("초대 링크 복사", "copy-invite")}
    <a class="button quiet" href="${e(url)}" target="_blank" rel="noopener noreferrer">초대 화면 열기</a></div>
    ${manualLink ? `<label for="invite-url">길게 눌러 링크 복사<input id="invite-url" readonly value="${e(url)}" /></label>` : ""}
    <p class="hint">한 번만 참여할 수 있어요. 이 링크를 가진 사람에게만 전달해주세요.</p></div>`;
}

function driverProposal() {
  const proposal = snapshot.placeProposal;
  if (!proposal) return "";
  return `<div class="proposal"><span>${proposal.proposedBy === "DRIVER" ? "운전자가 제안한 장소" : "탑승자가 제안한 장소"}</span><strong>${e(proposal.place.label)}</strong>
    <small>위도 ${e(proposal.place.latitude.toFixed(5))} · 경도 ${e(proposal.place.longitude.toFixed(5))} · 확정 장소는 그대로예요.</small>
    ${button("제안 지우기", "propose-clear", true, !online)}</div>`;
}

function driver() {
  const status = snapshot.status;
  const guest = snapshot.participant;
  let content = "";
  if (status === "INVITING")
    content = `<h1>참여를 기다리고 있어요.</h1>${placeCard()}${invitationCard()}`;
  if (status === "WAITING_APPROVAL")
    content = `<span class="badge">참여 요청</span><h1>${e(guest.displayName)} 님이<br />참여했어요.</h1><p>초대한 사람이 맞는지 확인해주세요.<br />확인하면 이번 픽업 동안 위치를 공유해요.</p>${placeCard()}${button("확인하고 공유 시작", "approve", false, !online)}`;
  if (status === "INVITE_EXPIRED")
    content = `<span class="badge">초대 만료</span><h1>다시 초대해주세요.</h1><p>참여 기한이 지났어요.<br />새 초대를 만들면 이전 링크는 쓸 수 없게 돼요.</p>${placeCard()}`;
  if (["ACTIVE", "ARRIVED"].includes(status))
    content = `<span class="badge">${status === "ARRIVED" ? "도착 안내" : "약속 진행 중"}</span>
    <h1>${status === "ARRIVED" ? "함께 만났나요?" : "출발 준비를<br />확인해요."}</h1>
    <div class="readiness"><span>${e(guest.displayName)} 님</span><strong>${e(readinessText[guest.readiness])}</strong><small>${online ? "서버에 저장된 준비 상태예요." : "마지막으로 확인한 준비 상태예요."}</small></div>${placeCard()}
    ${driverProposal()}<p class="hint">이 웹에서 만든 픽업에는 차량 앱이 연결되어 있지 않아요.</p>
    ${button(status === "ARRIVED" ? "탑승 확인 · 픽업 완료" : "도착 알리기", status === "ARRIVED" ? "complete" : "arrive", false, !online)}
    ${button("탑승자 끊기", "disconnect", true, !online)}`;
  return `${connection()}<section class="card driver"><p class="eyebrow">운전자 확인 화면</p>${content}
    ${["INVITING", "WAITING_APPROVAL", "INVITE_EXPIRED"].includes(status) ? button("새 초대 만들기", "rotate", true, !online) : ""}
    ${button("픽업 취소", "cancel", true, !online)}</section>
    <p class="hint center">이 화면은 개발 확인용이에요. 운전 중에는 조작하지 마세요.</p>`;
}

function arrivalPushCard() {
  const state = pushState({
    publicKey: pushKey,
    ...browserPushEnvironment(),
    subscribed: pushFlag(session.pickupId),
  });
  return pushCard(state, { busy: pushBusy, message: pushMessage });
}

async function toggleArrivalPush(turnOn) {
  if (pushBusy || !session || session.role !== "guest") return;
  const current = session;
  pushBusy = true;
  pushMessage = "";

  // Instant visual feedback for the toggle switch in the DOM!
  const switchBtn = root.querySelector(".push-toggle-switch");
  const pushCard = root.querySelector(".push-card");
  if (switchBtn) {
    switchBtn.classList.toggle("is-on", turnOn);
    switchBtn.classList.toggle("is-off", !turnOn);
    switchBtn.setAttribute("aria-checked", turnOn ? "true" : "false");
  }
  if (pushCard) {
    pushCard.classList.toggle("is-active", turnOn);
  }

  try {
    if (turnOn) {
      const subscription = await enableArrivalPush(pushKey);
      await request(`/${current.pickupId}/arrival-push`, {
        method: "PUT",
        token: current.token,
        body: subscription,
      });
      setPushFlag(current.pickupId, true);
    } else {
      await request(`/${current.pickupId}/arrival-push`, { method: "DELETE", token: current.token });
      setPushFlag(current.pickupId, false);
      // Keep the browser subscription: another pickup may still use it.
    }
  } catch (error) {
    pushMessage = pushErrorText(error);
  } finally {
    pushBusy = false;
    render();
  }
}

let activeTabModal = null; // null | "voice" | "proposal" | "push" | "info"

function guest() {
  const status = snapshot.status;
  if (["WAITING_APPROVAL", "INVITE_EXPIRED"].includes(status))
    return `${connection()}<section class="card"><span class="badge">${status === "INVITE_EXPIRED" ? "참여 기한 만료" : "참여 요청 완료"}</span>
    <h1>${status === "INVITE_EXPIRED" ? "새 초대를<br />받아주세요." : "운전자 확인을<br />기다리고 있어요."}</h1><p>${status === "INVITE_EXPIRED" ? "운전자에게 새 링크를 요청해주세요." : "확인되면 이 화면에서<br />약속 장소와 도착 정보를 볼 수 있어요."}</p>
    <div class="empty-state">아직 차량 위치를 공유하지 않아요.</div>
    ${status === "WAITING_APPROVAL" ? unavailableProposal("운전자가 확인하면 다른 장소를 제안할 수 있어요.") : ""}</section>`;

  const current = vehicleView(
    vehicleForPlace(snapshot, vehicle),
    timing,
    deadline,
    performance.now(),
    online,
    status,
  );

  const etaText = pickupEtaLabel(status, current, online);

  const vehicleName = snapshot.vehicleName ? e(snapshot.vehicleName) : "";
  const proposal = proposalBlock({
    proposal: snapshot.placeProposal,
    picking,
    mapReady: Boolean(pickupMap),
    status,
  });

  return `${connection()}<section class="card pickup-live mobility-app-view">
    <div class="pickup-header-row">
      <span class="badge">${status === "ARRIVED" ? "도착 안내" : "약속 진행 중"}</span>
      <h1 data-guest-pickup-heading>${e(guestPickupHeading(status, current, online))}</h1>
    </div>

    <div class="pickup-eta-summary" role="status" aria-live="polite">
      <strong class="floating-eta">${e(etaText)}</strong>
      ${vehicleName ? `<span class="eta-vehicle-name">${vehicleName}</span>` : ""}
    </div>

    ${readinessControl({ participant: snapshot.participant, online, sending: readinessSending, pendingValue: pendingReadiness, retry: pendingReadiness })}
    <div class="pickup-place-tools" data-proposal-area>
    <div class="pickup-place-card">
      <div class="place-card-info">
        <span class="place-card-badge">만날 약속 장소</span>
        <strong class="place-card-name">📍 ${e(snapshot.place?.label || "장소 확인 중")}</strong>
      </div>
      ${proposal ? `<div class="pickup-place-proposal">${proposal}</div>` : ""}
    </div>

    <!-- The time stays outside the map so map controls cannot cover it. -->
    ${pickupMap && snapshot.place ? '<div class="map-wrapper"><div id="map-slot" class="pickup-map"></div></div>' : ""}
    <p class="vehicle-freshness" role="status">${e(vehicleFreshnessText(current))}</p>
    ${pickupMap && snapshot.place ? '<button type="button" class="quiet map-recenter" data-action="map-recenter">차량·만날 장소 다시 보기</button>' : ""}
    </div>


    ${quickMessageControl({ value: guestQuickMsgText, message: snapshot.quickMessage?.text, online, attributes: 'data-role="guest"' })}

    <!-- 5. Arrival Notification (도착 알림) -->
    <div class="arrival-push-section">
      ${status === "ACTIVE" ? arrivalPushCard() : ""}
    </div>

    <!-- 6. Footer Info Links -->
    <div class="pickup-footer-links">
      <a href="https://majung.cloud/privacy" target="_blank" rel="noopener noreferrer">개인정보 처리방침</a>
      <span class="footer-divider">·</span>
      <a href="/privacy" target="_blank" rel="noopener noreferrer">위치 공유 안내</a>
    </div>
  </section>`;
}

let pickupStream = null, streamSession = null, streamConnected = false;
let streamRefreshPending = false, lastSafetyRefresh = 0;
function syncPickupStream() {
  const wanted = !document.hidden && session?.role === "guest" && ["ACTIVE","ARRIVED"].includes(snapshot?.status) ? session : null;
  if (wanted === streamSession) return;
  pickupStream?.close(); pickupStream=null; streamSession=wanted; streamConnected=false;
  if (!wanted) return;
  pickupStream=openPickupStream({path:`/api/v1/pickups/${wanted.pickupId}/events`,token:wanted.token,
    onState:connected=>{ if (streamSession===wanted) streamConnected=connected; },
    onChange:()=>{ if(streamSession===wanted) streamRefreshPending=true; },
    onFallback:()=>{ if(streamSession===wanted) {streamConnected=false;streamRefreshPending=true;} }});
}
function render() {
  syncPickupStream();
  void upgradeStoredArrivalPush();
  if (session?.role === 'guest' && location.search !== `?pickup=${session.pickupId}`)
    history.replaceState(null, '', `/?pickup=${session.pickupId}${location.hash || ''}`);
  const critical = pickupStatusNotice(finished || snapshot, snapshot?.status === "ARRIVED" && pickupMap ? '<button type="button" data-action="map-recenter" class="primary">차량 위치 확인</button>' : "");
  root.querySelectorAll?.('[data-action="propose-start"]').forEach(button=>{button.hidden=snapshot?.status !== "ACTIVE";});
  const criticalNode = root.querySelector("[data-critical-status]");
  if (criticalNode && criticalNode.innerHTML !== critical) criticalNode.innerHTML = critical;
  const mustEnd = finished || !session || terminalStatuses.has(snapshot?.status) || (picking && snapshot?.status !== "ACTIVE");
  // Keep the editor intact, but never defer arrival, revocation or location removal.
  if (!mustEnd && picking && proposalPanel.hasFocus()) { updateFocusedMap(); return; }
  if (!mustEnd && root.contains(document.activeElement) && document.activeElement?.tagName === "INPUT") { updateFocusedMap(); return; }
  if (picking && snapshot?.status !== "ACTIVE") {
    picking = false;
    proposalPanel.reset();
  }
  let content;
  if (finished)
    content = `<section class="card end"><span class="end-mark">✓</span><span class="badge">위치 공유 종료</span><h1>${{ COMPLETED: "잘 만났어요!", CANCELLED: "약속이 취소됐어요.", EXPIRED: "약속 시간이 지났어요." }[finished.status]}</h1><p>차량 위치와 도착 예정 시간은<br />더 이상 볼 수 없어요.</p>${button("처음으로", "home", true)}</section>`;
  else if (session && !snapshot)
    content = `<section class="card"><h1>${online ? "약속을 확인하고 있어요." : "약속에 연결하고 있어요."}</h1><p>잠시 후 다시 확인해주세요.</p>${button("다시 확인", "refresh", true)}${button("이 탭에서 나가기", "leave", true)}</section>`;
  else if (session) content = session.role === "driver" ? driver() : guest();
  else if (hostInvitation) content = hostShare();
  else
    content =
      page === "create" ? createForm() : page === "join" ? joinForm() : home();
  const fromPush = !session && /^\?pickup=[0-9a-f-]{36}$/.test(location.search || '') ? '<section class="notice" role="status"><strong>원래 열어둔 픽업 화면을 확인해주세요</strong><p>이 새 탭에는 초대 참여 정보가 없어요. 기존 탭으로 돌아가거나 받은 초대 링크를 다시 열어주세요.</p></section>' : '';
  const markup = `<div data-critical-status>${critical}</div>${fromPush}${alerts()}${content}`;
  if (markup !== renderedMarkup) {
    const focused = document.activeElement;
    const focusId = root.contains(focused) ? focused.id : null;
    const focusName = root.contains(focused) && focused.name ? focused.name : null;
    const focusAction = root.contains(focused) ? focused.dataset?.action : null;
    const selectionStart = focused?.selectionStart;
    const selectionEnd = focused?.selectionEnd;
    root.innerHTML = markup;
    renderedMarkup = markup;
    const nextFocus = focusId
      ? root.querySelector(`#${CSS.escape(focusId)}`)
      : focusName
        ? root.querySelector(`input[name="${CSS.escape(focusName)}"]`)
        : focusAction
          ? root.querySelector(`[data-action="${CSS.escape(focusAction)}"]`)
          : null;
    if (nextFocus) {
      nextFocus.focus({ preventScroll: true });
      if (typeof selectionStart === "number" && typeof selectionEnd === "number") {
        try { nextFocus.setSelectionRange(selectionStart, selectionEnd); } catch {}
      }
    }
  }
  if (pickupMap && session?.role === "guest" && snapshot) {
    pickupMap.attach(root.querySelector("#map-slot"));
    pickupMap.update(
      snapshot.place,
      vehicleView(vehicleForPlace(snapshot, vehicle), timing, deadline, performance.now(), online, snapshot.status),
      snapshot.placeProposal?.place,
    );
    if (picking) {
      proposalPanel.attach(root.querySelector("[data-proposal-slot]"));
      pickupMap.startPicking((point) => proposalPanel.setPoint(point));
    } else pickupMap.stopPicking();
  }
  document.title = session
    ? `마중 · ${session.role === "driver" ? "운전자 확인" : "나의 약속"}`
    : "마중 · 함께 만날 약속";
}

function updateFocusedMap() {
  const view=vehicleView(vehicleForPlace(snapshot,vehicle),timing,deadline,performance.now(),online,snapshot?.status);
  const heading = root.querySelector('[data-guest-pickup-heading]');
  if (heading) heading.textContent = guestPickupHeading(snapshot?.status, view, online);
  const eta=root.querySelector('.floating-eta');
  if (eta) eta.textContent=pickupEtaLabel(snapshot?.status,view,online);
  const freshness=root.querySelector('.vehicle-freshness');
  if (freshness) freshness.textContent=vehicleFreshnessText(view);
  if (pickupMap && session?.role === 'guest' && snapshot) pickupMap.update(snapshot.place,
    vehicleView(vehicleForPlace(snapshot, vehicle), timing, deadline, performance.now(), online, snapshot.status), snapshot.placeProposal?.place);
}

function handleError(error) {
  if (
    error instanceof ApiError &&
    [401, 403, 404].includes(error.status) &&
    error.code !== "APPROVAL_REQUIRED"
  ) {
    forgetSession();
    invitation = null;
    page = "home";
    message =
      "이 약속에 접근할 수 없어요. 운전자가 연결을 끊었거나 초대가 다시 발급됐을 수 있어요.";
    return;
  }
  message =
    error instanceof ApiError
      ? error.message
      : "서버 응답을 확인하지 못했어요. 연결을 확인한 뒤 다시 시도해주세요.";
  if (!(error instanceof ApiError)) {
    online = false;
    vehicle = null;
    deadline = 0;
    timing = null;
  }
}

async function refresh() {
  if (!session || refreshing || busy || readinessSending || document.hidden) return;
  refreshing = true;
  const currentSession = session;
  const generation = epoch;
  const prevSnapshot = snapshot;
  const readinessRevisionAtStart = readinessRevision;
  try {
    const data = await request(`/${currentSession.pickupId}`, {
      token: currentSession.token,
    });
    if (generation !== epoch || currentSession !== session || busy || readinessRevisionAtStart !== readinessRevision) return;
    reopenedInvitation = null;
    snapshot = data;
    online = true;
    message = "";

    // Immediate feedback when proposal state updates or driver responds
    if (prevSnapshot && currentSession.role === "guest") {
      const prevProposal = prevSnapshot.placeProposal;
      const newProposal = data.placeProposal;
      if (prevProposal?.proposedBy === "PASSENGER" && !newProposal) {
        if (data.place?.label && data.place.label === prevProposal.place?.label) {
          showToast(`운전자가 제안한 장소(“${data.place.label}”)를 수락했어요! 만날 장소가 변경되었습니다.`, "success", 5000);
        } else if (data.place?.label && data.place.label !== prevSnapshot.place?.label) {
          showToast(`만날 장소가 “${data.place.label}”(으)로 확정되었습니다!`, "success", 5000);
        }
      } else if (!prevProposal && newProposal?.proposedBy === "DRIVER") {
        showToast(`운전자가 새로운 장소(“${newProposal.place?.label}”)를 제안했어요!`, "info", 5000);
      }

      // 1. Vehicle Arrival Detection
      if (prevSnapshot.status !== "ARRIVED" && data.status === "ARRIVED") {
        showToast("차량이 차량이 도착했어요!", "arrival", 7000);
        if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
          try { navigator.vibrate([200, 100, 200, 100, 300]); } catch (_) {}
        }

      }
    }

    if (terminalStatuses.has(data.status)) {
      if (prevSnapshot && prevSnapshot.status !== data.status && data.status === "COMPLETED") {
        showToast("탑승이 확인되어 픽업이 완료되었어요. 잘 만났어요!", "success", 5000);
      }
      finish(data);
      return;
    }
    if (["ACTIVE", "ARRIVED"].includes(data.status)) {
      if (session.invite) {
        delete session.invite;
        storeSession();
      }
      if (session.role === "guest") {
        const started = performance.now();
        const state = await request(
          `/${currentSession.pickupId}/vehicle-state`,
          { token: currentSession.token },
        );
        if (generation !== epoch || currentSession !== session || busy || readinessRevisionAtStart !== readinessRevision) return;
        vehicle = vehicleForPlace(snapshot, state);
        const received = performance.now();
        deadline = vehicleDeadline(state, started, received);
        timing = vehicleTiming(state, started, received);

        // Imminent arrival alert (<= 60 seconds)
        const currentView = vehicleView(
          vehicleForPlace(snapshot, vehicle),
          timing,
          deadline,
          performance.now(),
          online,
          data.status,
        );
        if (
          data.status === "ACTIVE" &&
          currentView &&
          currentView.remainingSeconds > 0 &&
          currentView.remainingSeconds <= 60 &&
          !currentSession.imminentAlerted
        ) {
          currentSession.imminentAlerted = true;
          showToast("차량이 곧 도착해요! 만날 준비를 해주세요.", "info", 4500);
          if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
            try { navigator.vibrate([100, 60, 100]); } catch (_) {}
          }
        }
      }
    } else {
      vehicle = null;
      deadline = 0;
    timing = null;
    }
  } catch (error) {
    if (generation !== epoch || currentSession !== session || busy || readinessRevisionAtStart !== readinessRevision) return;
    // Any failed read invalidates the displayed position, even if it is an HTTP error.
    online = false;
    vehicle = null;
    deadline = 0;
    timing = null;
    if (reopenedInvitation && error instanceof ApiError && [401, 403].includes(error.status)) {
      const nextInvitation = reopenedInvitation;
      reopenedInvitation = null;
      forgetSession();
      invitation = nextInvitation;
      invitationPreview = null;
      void checkInvitation();
      page = "join";
      message = "";
    } else handleError(error);
  } finally {
    refreshing = false;
    render();
  }
}

async function mutate(action) {
  if (busy) return;
  busy = true;
  epoch += 1;
  message = "";
  notice = "";
  render();
  try {
    await action();
  } catch (error) {
    handleError(error);
  } finally {
    busy = false;
    render();
    await refresh();
  }
}

root.addEventListener("input", (event) => {
  if (event.target.name === "quickMsg") {
    guestQuickMsgText = event.target.value;
    const counter=event.target.closest?.('.voice-composer-card')?.querySelector('[data-message-count]');
    if (counter) counter.textContent=`${guestQuickMsgText.length}/50자`;
  }
});

root.addEventListener("focusout", (event) => {
  if (event.target.name === "quickMsg") {
    setTimeout(() => {
      if (!root.contains(document.activeElement) || document.activeElement?.tagName !== "INPUT") {
        render();
      }
    }, 50);
  }
});

root.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  if (!form.reportValidity() || busy) return;
  const fields = new FormData(form);
  if (form.classList?.contains?.("quick-msg-form") || form.className?.includes?.("quick-msg-form")) {
    const msg = fields.get("quickMsg")?.trim() || guestQuickMsgText.trim();
    if (!msg || !session || session.role !== "guest") return;
    if (msg.length > 50) { message = "메시지는 50자까지 보낼 수 있어요."; render(); return; }
    await mutate(async () => {
      await request(`/${session.pickupId}/quick-message`, {
        method: "POST",
        token: session.token,
        body: { message: msg },
      });
      guestQuickMsgText = "";
      notice = quickMessageSavedText;
      showToast(quickMessageSavedText, "info", 5000);
    });
    return;
  }
  if (form.id === "create-form") {
    if (!developmentToolsEnabled) return;
    draft.label = fields.get("label").trim();
    draft.latitude = fields.get("latitude");
    draft.longitude = fields.get("longitude");
    if (!draft.label) {
      message = "만날 장소를 입력해주세요.";
      render();
      return;
    }
    await mutate(async () => {
      const created = await request("", {
        method: "POST",
        body: {
          place: {
            label: draft.label,
            latitude: Number(draft.latitude),
            longitude: Number(draft.longitude),
          },
        },
      });
      session = {
        role: "driver",
        pickupId: created.pickupId,
        token: created.driverToken,
        invite: {
          token: created.inviteToken,
          expiresAt: created.inviteExpiresAt,
        },
      };
      storeSession();
    });
  } else if (form.id === "join-form" && invitation && invitationPreview) {
    const invite = invitation;
    await mutate(async () => {
      let joined;
      try {
        joined = await request(`/${invite.pickupId}/participants`, {
          method: "POST",
          body: { inviteToken: invite.inviteToken },
        });
      } catch (error) {
        if (!(error instanceof ApiError) ||
            !["PICKUP_ENDED", "PICKUP_NOT_FOUND", "INVITE_UNAVAILABLE", "FORBIDDEN"].includes(error.code)) throw error;
        unavailableInvitation = error.code === "PICKUP_ENDED"
          ? "이미 끝난 픽업이에요."
          : "이 초대 링크는 더 이상 사용할 수 없어요.";
        invitation = null;
        return;
      }
      session = {
        role: "guest",
        pickupId: invite.pickupId,
        token: joined.participantToken,
        participantId: joined.participantId,
      };
      invitation = null;
      storeSession();
    });
  }
});

async function sendProposal(place) {
  await mutate(async () => {
    snapshot = await request(`/${session.pickupId}/place-proposal`, {
      method: "PUT",
      token: session.token,
      body: { place },
    });
    picking = false;
    proposalPanel.reset();
    notice = "장소를 제안했어요. 운전자가 확인할 때까지 약속 장소는 그대로예요.";
    showToast("📍 차량으로 새 장소 제안을 보냈어요! 운전자 확인을 기다리는 중입니다.", "info", 4500);
  });
}

async function sendReadiness(value) {
  if (busy || readinessSending || !session || session.role !== "guest" || !["READY", "PREPARING"].includes(value)) return;
  const current = session;
  const generation = epoch;
  pendingReadiness = value;
  readinessSending = true;
  readinessRevision++;
  message = "";
  beginReadinessSend(root, value);
  try {
    const result = await request(`/${current.pickupId}/readiness`, {
      method: "PUT", token: current.token,
      body: { readiness: value, sequence: nextSequence(snapshot) },
    });
    if (current !== session || generation !== epoch) return;
    snapshot = result;
    pendingReadiness = null;
    notice = "준비 상태를 저장했어요.";
  } catch (error) {
    if (current === session && generation === epoch) handleError(error);
  } finally {
    readinessSending = false;
    render();
    if (current === session && generation === epoch) await refresh();
  }
}

root.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target || busy || target.disabled) return;
  const action = target.dataset.action;
  if (action === "toggle-tab") {
    const tab = target.dataset.tab;
    activeTabModal = activeTabModal === tab ? null : tab;
    render();
    return;
  }
  if (action === "close-tab-modal") {
    activeTabModal = null;
    render();
    return;
  }
  if (action === "push-on" || action === "push-off") {
    await toggleArrivalPush(action === "push-on");
    return;
  }
  if (action === "retry-invitation") { void checkInvitation(); return; }
  if (action === "retry-map") { void loadConfiguration(true); return; }
  if (action === "propose-start" && session?.role === "guest" && snapshot?.status === "ACTIVE") {
    picking = true;
    render();
    root.querySelector("[data-proposal-area]")?.scrollIntoView?.({block:"start"});
    return;
  }
  if (action === "propose-withdraw" && session?.role === "guest" && online) {
    await mutate(async () => {
      snapshot = await request(`/${session.pickupId}/place-proposal`, { method: "DELETE", token: session.token });
      notice = "장소 제안을 취소했어요.";
      showToast("장소 제안을 취소했어요.", "info", 3000);
    });
    return;
  }
  if (action === "prepare" && !developmentToolsEnabled) return;
  if (["home", "prepare"].includes(action)) {
    finished = null;
    message = "";
    notice = "";
    invitation = null;
    page = action === "prepare" ? "create" : "home";
    render();
    return;
  }
  if (action === "leave") {
    if (
      !confirm("이 탭의 세션을 지울까요? 다시 참여하려면 새 초대가 필요해요.")
    )
      return;
    forgetSession();
    page = "home";
    render();
    return;
  }
  if (action === "refresh") {
    await refresh();
    return;
  }
  if (["share-passenger-invite", "copy-passenger-invite"].includes(action) && hostInvitation) {
    const url = invitationUrl(location.origin, hostInvitation.pickupId, hostInvitation.inviteToken);
    try {
      if (action === "share-passenger-invite" && navigator.share) {
        await navigator.share({title: "마중 픽업 초대", text: "이 링크에서 픽업에 참여해주세요.", url});
        notice = "초대 공유 창을 닫았어요.";
      } else {
        await navigator.clipboard.writeText(url);
        notice = "탑승자에게 보낼 초대 링크를 복사했어요.";
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        manualLink = true;
        notice = "아래 링크를 직접 복사해주세요.";
      }
    }
    render();
    return;
  }
  if (action === "copy-invite") {
    const url = invitationUrl(
      location.origin,
      session.pickupId,
      session.invite.token,
    );
    try {
      await navigator.clipboard.writeText(url);
      notice = "초대 링크를 복사했어요.";
    } catch {
      manualLink = true;
      notice = "아래 링크를 직접 복사해주세요.";
    }
    render();
    return;
  }
  if (["ready", "preparing", "retry-readiness"].includes(action)) {
    if (!online) return;
    await sendReadiness(
      action === "retry-readiness"
        ? pendingReadiness
        : action === "ready"
          ? "READY"
          : "PREPARING",
    );
    return;
  }
  if (action === "map-recenter") { pickupMap?.recenter(); root.querySelector(".pickup-map")?.scrollIntoView?.({block:"center",behavior:"smooth"}); return; }
  if (action === "guest-quick-msg") {
    if (!online || !session || session.role !== "guest") return;
    const msg = target.dataset.msg;
    if (!msg) return;
    await mutate(async () => {
      await request(`/${session.pickupId}/quick-message`, {method:"POST", token:session.token, body:{message:msg}});
      notice = quickMessageSavedText;
    });
    return;
  }
  if (!session || session.role !== "driver" || !online) return;
  const confirmations = {
    rotate: "새 초대를 만들까요? 이전 링크는 쓸 수 없게 돼요.",
    disconnect: "연결된 탑승자를 끊을까요? 이 탑승자는 더 이상 위치를 볼 수 없고 새 초대가 만들어져요.",
    cancel: "픽업을 취소할까요? 차량 위치 공유도 종료돼요.",
    complete: "탑승을 확인했나요? 픽업을 완료하면 위치 공유가 종료돼요.",
  };
  if (confirmations[action] && !confirm(confirmations[action])) return;
  const paths = {
    approve: `/participants/${snapshot.participant?.participantId}/approval`,
    arrive: "/arrival",
    complete: "/completion",
    cancel: "/cancellation",
    rotate: "/invitations",
    disconnect: "/participant",
    "propose-clear": "/place-proposal",
  };
  if (!paths[action]) return;
  await mutate(async () => {
    const result = await request(`/${session.pickupId}${paths[action]}`, {
      method: ["disconnect", "propose-clear"].includes(action) ? "DELETE" : "POST",
      token: session.token,
    });
    if (action === "rotate" || action === "disconnect") {
      session.invite = {
        token: result.inviteToken,
        expiresAt: result.expiresAt,
      };
      storeSession();
      manualLink = false;
      notice = action === "disconnect" ? "탑승자를 끊고 새 초대를 만들었어요." : "새 초대를 만들었어요.";
    } else {
      snapshot = result;
      if (terminalStatuses.has(result.status)) finish(result);
    }
  });
});

document.addEventListener("visibilitychange", () => {
  vehicle = null;
  deadline = 0;
  timing = null;
  if (!document.hidden) {
    render();
    void refresh();
  }
});
window.addEventListener("offline", () => {
  online = false;
  vehicle = null;
  deadline = 0;
  timing = null;
  render();
});
window.addEventListener("online", () => {
  void refresh();
});
// Re-render each second so the countdown and "N초 전" stay current; render() skips unchanged markup.
setInterval(() => {
  if (session?.role === "guest" && snapshot && !document.hidden) render();
}, 1000);
setInterval(() => {
  syncPickupStream();
  const now=performance.now();
  if (!streamRefreshPending && now-lastSafetyRefresh<(streamConnected?30000:3000)) return;
  if (busy || refreshing || document.hidden) return;
  streamRefreshPending=false; lastSafetyRefresh=now;
  void refresh();
}, 1000);
render();
if (session) void refresh();
if (invitation) void checkInvitation();

let configurationLoading = false;
async function loadConfiguration(retry = false) {
  if (configurationLoading || pickupMap) return;
  configurationLoading = true;
  if (retry) { notice = "지도를 다시 불러오고 있어요."; render(); }
  try {
    const response = await fetch("/api/v1/config", {
      cache: "no-store", credentials: "omit", redirect: "error",
      referrerPolicy: "no-referrer", signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error();
    const configuration = await response.json();
    developmentToolsEnabled = configuration.developmentToolsEnabled === true;
    pushKey = typeof configuration.webPushPublicKey === "string" ? configuration.webPushPublicKey : null;
    render();
    const maps = await loadKakaoMaps(configuration.kakaoMapJavaScriptKey);
    if (!maps) throw new Error();
    proposalMaps = maps;
    pickupMap = createPickupMap(maps);
    if (retry) notice = "";
  } catch {
    if (retry) notice = "지도를 불러오지 못했어요. 잠시 후 다시 시도해주세요.";
  } finally {
    configurationLoading = false;
    render();
  }
}
void loadConfiguration();

window.addEventListener("pagehide",()=>{pickupStream?.close();pickupStream=null;streamSession=null;});
window.addEventListener("pageshow", event => {
  if (!event.persisted) return;
  online = false;
  vehicle = null;
  deadline = 0;
  timing = null;
  render();
  void refresh();
});
document.addEventListener("visibilitychange",()=>{syncPickupStream();if(!document.hidden)streamRefreshPending=true;});

if (globalThis.navigator?.serviceWorker?.addEventListener) navigator.serviceWorker.addEventListener('message', event => {
  if (event.data?.type==='MAJUNG_PICKUP_REFRESH') { lastSafetyRefresh=0; void refresh(); }
});

// Update an existing worker without asking for notification permission on page load.
void globalThis.navigator?.serviceWorker?.getRegistration?.('/')?.then(registration=>registration?.update()).catch(()=>{});

async function upgradeStoredArrivalPush() {
  const current=session;
  if (!pushKey || current?.role!=='guest' || !pushFlag(current.pickupId) || upgradedPushFor===current || !['ACTIVE','ARRIVED'].includes(snapshot?.status)) return;
  upgradedPushFor=current;
  try {
    const body=await existingArrivalSubscription(pushKey);
    if (body && session===current) await request(`/${current.pickupId}/arrival-push`,{method:'PUT',token:current.token,body});
  } catch { /* An explicit toggle can retry; never replay a failed subscription write. */ }
}
