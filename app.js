import { openPickupStream } from "./stream.js";
import { request, ApiError } from "./api.js";
import {
  parseInvitation,
  parseHostInvitation,
  validSession,
  invitationUrl,
  nextSequence,
  readinessDeliveryText,
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
import { loadKakaoMaps, createPickupMap } from "./map.js";
import { proposalBlock, createProposalPanel } from "./proposal.js";

const root = document.querySelector("#app");
const storageKey = "majung.pickup.session.v1";
let invitation = parseInvitation(location.hash);
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
  if (!invitation && !hostInvitation && !invalidInvitation && validSession(restored)) session = restored;
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

const proposalPanel = createProposalPanel({
  onSubmit: (place) => void sendProposal(place),
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
  return `${message ? `<div class="alert" role="alert">${e(message)}</div>` : ""}
    ${notice ? `<p class="notice" role="status">${e(notice)}</p>` : ""}
    ${!storageAvailable ? '<p class="hint">이 브라우저에서는 세션을 저장할 수 없어요. 새로고침하면 다시 초대가 필요해요.</p>' : ""}`;
}

function home() {
  return `<section class="intro service-intro"><p class="eyebrow">함께 만날 약속, 마중</p>
    <h1>차가 언제 오는지<br />함께 확인해요.</h1><p>만날 장소를 정하고 준비 상태를 전해보세요.<br />차량이 출발하면 위치와 도착 시간을 확인할 수 있어요.</p>
    <a class="primary service-start" href="/account">마중 시작하기</a></section>
    <section class="card service-guide"><h2>처음이라면 이렇게 시작해요.</h2><ol><li><strong>운전자를 찾아요.</strong><span>카카오로 로그인하고 닉네임이나 마중 ID로 찾아주세요.</span></li><li><strong>만날 장소를 보내요.</strong><span>장소를 검색하고 운전자가 수락하면 픽업 대기에 들어가요.</span></li><li><strong>위치와 시간을 함께 봐요.</strong><span>내 픽업이 시작되면 준비 상태를 전하고 도착 시간을 확인해요.</span></li></ol></section>
    <section class="card"><h2>초대 링크를 받았나요?</h2><p>받은 링크를 열면 이 화면 대신 이번 픽업이 바로 열려요. 링크 초대는 회원가입 없이 참여할 수 있어요.</p></section>
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

function joinForm() {
  if (!invitation)
    return `<section class="card"><h1>초대가 필요해요.</h1><p>운전자에게 받은 링크를 다시 열어주세요.</p>${button("처음으로", "home", true)}</section>`;
  return `<section class="intro small"><p class="eyebrow">마중 약속 초대</p><h1>함께 만날 약속에<br />참여할까요?</h1><p>참여하면 바로 연결돼서 만날 장소와<br />차량의 도착 정보를 볼 수 있어요.</p></section>
    <form id="join-form" class="card"><p class="hint">이름이나 가입 없이 참여해요. 이 링크는 한 사람만 쓸 수 있고, 휴대전화 위치나 연락처는 요청하지 않아요.</p>
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
  render();
  try {
    if (turnOn) {
      const endpoint = await enableArrivalPush(pushKey);
      await request(`/${current.pickupId}/arrival-push`, {
        method: "PUT",
        token: current.token,
        body: { endpoint },
      });
      setPushFlag(current.pickupId, true);
    } else {
      await request(`/${current.pickupId}/arrival-push`, { method: "DELETE", token: current.token });
      setPushFlag(current.pickupId, false);
      await disableBrowserPush();
    }
  } catch (error) {
    pushMessage = pushErrorText(error);
  } finally {
    pushBusy = false;
    render();
  }
}

function guest() {
  const status = snapshot.status;
  if (["WAITING_APPROVAL", "INVITE_EXPIRED"].includes(status))
    return `${connection()}<section class="card"><span class="badge">${status === "INVITE_EXPIRED" ? "참여 기한 만료" : "참여 요청 완료"}</span>
    <h1>${status === "INVITE_EXPIRED" ? "새 초대를<br />받아주세요." : "운전자 확인을<br />기다리고 있어요."}</h1><p>${status === "INVITE_EXPIRED" ? "운전자에게 새 링크를 요청해주세요." : "확인되면 이 화면에서<br />약속 장소와 도착 정보를 볼 수 있어요."}</p>
    <div class="empty-state">아직 차량 위치를 공유하지 않아요.</div></section>`;
  const current = vehicleView(
    vehicleForPlace(snapshot, vehicle),
    timing,
    deadline,
    performance.now(),
    online,
    status,
  );
  return `${connection()}<section class="card pickup-live"><span class="badge">${status === "ARRIVED" ? "도착 안내" : "약속 진행 중"}</span>
    <h1>${status === "ARRIVED" ? "차량이 도착했어요." : "마중 차량이 오고 있어요"}</h1>
    ${status === "ARRIVED" ? "<p>확정된 약속 장소에서 만나세요.<br />탑승 확인 후 공유가 종료돼요.</p>" : ""}
    <div class="arrival${current?.kind === "stale" ? " stale" : ""}" id="arrival-info">${
      !online
        ? "<h2>인터넷 연결을 확인하세요.</h2><p>지난 위치와 도착 시간을 숨겼어요.<br />연결이 돌아오면 다시 확인할게요.</p>"
        : status === "ARRIVED"
          ? "<h2>약속 장소에 도착했어요.</h2><p>탑승한 뒤 운전자에게 픽업 완료를 확인해주세요.</p>"
          : current?.kind === "lost"
            ? `<h2>위치 확인 중</h2><p>마지막 갱신 ${e(ageText(current.ageMillis))}<br />차량에서 새 정보를 보내면 다시 표시할게요.</p>`
            : current
              ? `<span>도착까지</span><strong>${current.remainingSeconds > 0 ? `약 ${Math.ceil(current.remainingSeconds / 60)}<small>분</small>` : "곧 도착"}</strong><p>${current.kind === "stale" ? `마지막 갱신 ${e(ageText(current.ageMillis))} · 남은 시간을 이어서 세고 있어요.` : `차량 정보 수신 시각 ${e(new Date(vehicle.receivedAt).toLocaleTimeString("ko-KR"))}`}</p>${pickupMap ? "" : `<div class="coordinates">차량 위치 · 위도 ${e(current.latitude.toFixed(5))}<br />경도 ${e(current.longitude.toFixed(5))}</div>`}`
              : `<h2>${vehicle?.freshness === "WAITING" ? "차량 정보를 기다리고 있어요." : "최신 정보를 확인하고 있어요."}</h2><p>${vehicle?.freshness === "WAITING" ? "차량에서 정보를 보내면<br />도착 예정 시간을 확인할 수 있어요." : "지난 위치와 도착 시간은 표시하지 않아요."}</p>`
    }</div>
    ${pickupMap && snapshot.place ? '<div id="map-slot" class="pickup-map"></div>' : ""}
    ${placeCard()}${proposalBlock({ proposal: snapshot.placeProposal, picking, mapReady: Boolean(pickupMap), status })}<div class="readiness"><strong>${e(readinessText[snapshot.participant.readiness])}</strong><small>${pendingReadiness ? "전송 결과를 확인하지 못했어요. 다시 확인한 뒤 재전송해주세요." : e(readinessDeliveryText(snapshot.participant, online))}</small></div>
    <div class="button-pair">${button("준비 중", "preparing", snapshot.participant.readiness !== "PREPARING", !online)}${button("준비 완료", "ready", snapshot.participant.readiness !== "READY", !online)}</div>
    ${pendingReadiness && online ? button("선택한 상태 다시 보내기", "retry-readiness", true) : ""}
    <p class="hint">탑승하면 운전자가 픽업을 완료하고 위치 공유를 끝내요.</p>
    ${status === "ACTIVE" ? arrivalPushCard() : ""}</section>`;
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
  // Typing a place description must not be interrupted by the periodic redraw.
  if (picking && proposalPanel.hasFocus()) return;
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
  const markup = `${alerts()}${content}`;
  if (markup !== renderedMarkup) {
    const focused = document.activeElement;
    const focusId = root.contains(focused) ? focused.id : null;
    const focusAction = root.contains(focused) ? focused.dataset?.action : null;
    root.innerHTML = markup;
    renderedMarkup = markup;
    const nextFocus = focusId
      ? root.querySelector(`#${CSS.escape(focusId)}`)
      : focusAction
        ? root.querySelector(`[data-action="${CSS.escape(focusAction)}"]`)
        : null;
    nextFocus?.focus({ preventScroll: true });
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
  if (!session || refreshing || busy || document.hidden) return;
  refreshing = true;
  const currentSession = session;
  const generation = epoch;
  try {
    const data = await request(`/${currentSession.pickupId}`, {
      token: currentSession.token,
    });
    if (generation !== epoch || currentSession !== session || busy) return;
    snapshot = data;
    online = true;
    message = "";
    if (terminalStatuses.has(data.status)) {
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
        if (generation !== epoch || currentSession !== session || busy) return;
        vehicle = vehicleForPlace(snapshot, state);
        const received = performance.now();
        deadline = vehicleDeadline(state, started, received);
        timing = vehicleTiming(state, started, received);
      }
    } else {
      vehicle = null;
      deadline = 0;
    timing = null;
    }
  } catch (error) {
    if (generation !== epoch || currentSession !== session || busy) return;
    // Any failed read invalidates the displayed position, even if it is an HTTP error.
    online = false;
    vehicle = null;
    deadline = 0;
    timing = null;
    handleError(error);
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

root.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  if (!form.reportValidity() || busy) return;
  const fields = new FormData(form);
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
  } else if (form.id === "join-form" && invitation) {
    const invite = invitation;
    await mutate(async () => {
      const joined = await request(`/${invite.pickupId}/participants`, {
        method: "POST",
        body: { inviteToken: invite.inviteToken },
      });
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
  });
}

async function sendReadiness(value) {
  pendingReadiness = value;
  await mutate(async () => {
    const result = await request(`/${session.pickupId}/readiness`, {
      method: "PUT",
      token: session.token,
      body: { readiness: value, sequence: nextSequence(snapshot) },
    });
    snapshot = result;
    pendingReadiness = null;
    notice = "준비 상태를 서버에 저장했어요.";
  });
}

root.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target || busy || target.disabled) return;
  const action = target.dataset.action;
  if (action === "push-on" || action === "push-off") {
    await toggleArrivalPush(action === "push-on");
    return;
  }
  if (action === "propose-start" && session?.role === "guest") {
    picking = true;
    render();
    return;
  }
  if (action === "propose-withdraw" && session?.role === "guest" && online) {
    await mutate(async () => {
      snapshot = await request(`/${session.pickupId}/place-proposal`, { method: "DELETE", token: session.token });
      notice = "장소 제안을 취소했어요.";
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
// Start closed: a failed configuration read must not expose the development form.
void fetch("/api/v1/config", {
  cache: "no-store",
  credentials: "omit",
  redirect: "error",
  referrerPolicy: "no-referrer",
  signal: AbortSignal.timeout(8000),
}).then(async (response) => {
  if (response.ok) {
    const configuration = await response.json();
    developmentToolsEnabled = configuration.developmentToolsEnabled === true;
    pushKey = typeof configuration.webPushPublicKey === "string" ? configuration.webPushPublicKey : null;
    render();
    void loadKakaoMaps(configuration.kakaoMapJavaScriptKey)
      .then((maps) => {
        if (!maps) return;
        pickupMap = createPickupMap(maps);
        render();
      })
      .catch(() => { /* Without the map the screen keeps the text-only layout. */ });
  }
}).catch(() => { /* Invitation access remains available without development tools. */ });

window.addEventListener("pagehide",()=>{pickupStream?.close();pickupStream=null;streamSession=null;});
document.addEventListener("visibilitychange",()=>{syncPickupStream();if(!document.hidden)streamRefreshPending=true;});
