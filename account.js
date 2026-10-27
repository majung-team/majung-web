import { openPickupStream } from "./stream.js";
import { createAccountClient, AccountError } from "./account-api.js";
import { escapeHtml as e, vehicleDeadline, vehicleTiming, vehicleView, vehicleForPlace, etaText, ageText, readinessDeliveryText } from "./model.js";
import { browserPushEnvironment, pushState, pushCard, pushErrorText, enableArrivalPush, disableBrowserPush, pushFlag, setPushFlag } from "./push.js";
import { loadKakaoMaps, createPickupMap, createPlacePicker, searchPickupPlaces } from "./map.js";
import { proposalBlock, createProposalPanel } from "./proposal.js";

const root = document.querySelector("#account-app");
const api = createAccountClient();
let info = null;
let connections = [];
let results = [];
let query = "";
let searchedQuery = "";
let nickname = "";
let busy = false;
let error = "";
let notice = "";
let searchDone = false;
let searchPage = 0;
let connectionPage = 0;
let pendingAction = null;
let rideTarget = null;
let ridePlace = null;
let rideLabel = "";
let rideRequestId = null;
let rides = [];
let tracking = new Map();
let networkAvailable = globalThis.navigator?.onLine !== false;
let recoveringNetwork = false;
let networkEpoch = 0;
let linkedVehicles = [];
let vehicleRequest = null;
let vehiclePair = null;
let pairingGeneration = 0;
function readVehiclePair() {
  const match=/^#(vehicle|enroll)\/([a-f0-9-]{36})\/([A-Za-z0-9_-]{43})$/.exec(location.hash);
  if (match) {
    pairingGeneration++;
    vehiclePair={kind:match[1],challengeId:match[2],code:match[3],until:Date.now()+300000}; vehicleRequest=null;
    try { sessionStorage.setItem("majung.vehiclePair",JSON.stringify(vehiclePair)); sessionStorage.removeItem("majung.vehicleRequest"); } catch { }
  } else {
    try {
      const stored=JSON.parse(sessionStorage.getItem("majung.vehiclePair")||"null");
      vehiclePair=stored?.until>Date.now()?stored:null;
      if (!vehiclePair) sessionStorage.removeItem("majung.vehiclePair");
      vehicleRequest=JSON.parse(sessionStorage.getItem("majung.vehicleRequest")||"null");
    } catch { }
  }
  if (/^#(?:vehicle|enroll)\//.test(location.hash)) history.replaceState(null,"",location.pathname+location.search);
}
readVehiclePair();
window.addEventListener("hashchange",()=>{ if (!/^#(?:vehicle|enroll)\//.test(location.hash)) return; readVehiclePair(); if (!busy) run(refresh); });
function vehicleRequestPath(request) {
  return `/vehicle-links/${request.kind === "enroll" ? "enrollments" : "requests"}/${request.challengeId}`;
}
function clearVehiclePair() {
  pairingGeneration++;
  vehiclePair=null; vehicleRequest=null;
  try { sessionStorage.removeItem("majung.vehiclePair"); sessionStorage.removeItem("majung.vehicleRequest"); } catch { }
}
function rideRow(source) {
  const item={...source};
  if (performance.now()>=item._etaUntil) item.currentPickupRemainingSeconds=null;
  const labels={INVITED:"운전자가 보낸 초대 · 내 응답 대기",PENDING:"운전자 응답 대기",QUEUED:"수락됨 · 픽업 대기",ACTIVE:"내 픽업 진행 중",COMPLETED:"탑승 완료",CANCELLED:"취소됨",REJECTED:"거절됨",EXPIRED:"만료됨"};
  const current=tracking.get(item.requestId);
  const waiting=item.status==="QUEUED" ? `<p>내 앞에 ${Number(item.peopleAhead)||0}건이 있어요.</p><p class="hint">${item.currentPickupRemainingSeconds == null ? "현재 진행 중인 픽업의 남은 시간은 아직 확인할 수 없어요." : `현재 진행 중인 픽업 장소까지 약 ${Math.max(1,Math.ceil(item.currentPickupRemainingSeconds/60))}분 남았어요.`}<br />${item.currentPickupRemainingSeconds == null ? "내 장소 도착 예정 시간도 아직 정해지지 않았어요." : "위 시간은 내 장소 도착 예정 시간이 아니에요. 실제 탑승 시간에 따라 더 걸릴 수 있어요."}</p>` : "";
  const active=current ? `<p data-ride-eta="${e(item.requestId)}">${e(rideEtaText(current))}</p>${pickupMap && current.pickup.place ? '<div class="pickup-map" data-ride-map></div>' : ""}${current.pickup.status==="ACTIVE"?ridePushCard(item.requestId):""}<p>내 준비 상태 · ${e(current.pickup.participant.readiness==="READY"?"준비 완료":"준비 중")}</p><p class="hint">${e(readinessDeliveryText(current.pickup.participant))}</p><div class="readiness-options" role="group" aria-label="내 준비 상태">${button("준비 중","ride-preparing",`data-id="${e(item.requestId)}" aria-pressed="${current.pickup.participant.readiness==="PREPARING"}"`,current.pickup.participant.readiness!=="PREPARING")}${button("준비 완료","ride-ready",`data-id="${e(item.requestId)}" aria-pressed="${current.pickup.participant.readiness==="READY"}"`,current.pickup.participant.readiness!=="READY")}</div>${proposalBlock({proposal:current.pickup.placeProposal,picking:pickingRide===item.requestId,mapReady:Boolean(pickupMap),status:current.pickup.status})}` : "";
  return `<li class="person-row ride-row" data-state="${e(item.status)}">${person(item.nickname,item.majungId)}<strong>${e(labels[item.status]||item.status)}</strong><p>${item.status==="ACTIVE" ? "만날 장소" : item.driverInvitation?"운전자가 제안한 장소":"내가 요청한 장소"} · ${e(item.place.label)}</p>${waiting}${active}${item.status==="INVITED"?`<p>이 장소에서 탈까요? 수락해도 내 픽업이 시작되기 전에는 차량 위치가 공유되지 않아요.</p><p class="hint">${e(new Date(item.expiresAt).toLocaleTimeString("ko-KR"))}까지 응답해주세요.</p>${button("이 장소에서 탈게요","invitation-accept",`data-id="${e(item.requestId)}"`)}${button("초대 거절","invitation-reject",`data-id="${e(item.requestId)}"`,true)}`:""}${item.status==="PENDING"?`<p class="hint">${e(new Date(item.expiresAt).toLocaleTimeString("ko-KR"))}까지 응답이 없으면 만료돼요.</p>`:""}${["PENDING","QUEUED"].includes(item.status)?button("마중 요청 취소","ride-cancel",`data-id="${e(item.requestId)}"`,true):""}</li>`;
}
let pushKey=null, pushBusyId=null, pushMessageFor=null, pushMessage="";
function ridePushCard(requestId) {
  const state=pushState({publicKey:pushKey,...browserPushEnvironment(),subscribed:pushFlag(requestId)});
  return pushCard(state,{busy:pushBusyId===requestId,message:pushMessageFor===requestId?pushMessage:"",attributes:`data-id="${e(requestId)}"`});
}
let pickupMap = null;
let placeMaps = null, placePicker = null;
let placeKeyword = "", placeSearchedKeyword = "", placeCandidates = [];
let placeSearchPage = 1, placeSearchNext = false, placeSearchDone = false;
let placeSearchBusy = false, placeSearchMessage = "", placeSearchGeneration = 0;
function resetPlaceSearch() {
  placeSearchGeneration++; placeSearchBusy = false; placeKeyword = "";
  placeSearchedKeyword = ""; placeCandidates = []; placeSearchPage = 1;
  placeSearchNext = false; placeSearchDone = false; placeSearchMessage = "";
}
function placeSearchPanel() {
  if (!placeMaps?.services?.Places || !placeMaps?.services?.Geocoder) return "";
  return `<form id="place-search-form" class="place-search-form"><label for="place-keyword">만날 장소 검색<input id="place-keyword" name="placeKeyword" value="${e(placeKeyword)}" maxlength="80" required placeholder="예: 서울역 1번 출구, 서울 중구 세종대로 110" autocomplete="off" /></label><button class="primary" ${busy||placeSearchBusy?"disabled":""}>${placeSearchBusy?"찾는 중…":"장소 찾기"}</button></form>
    <p class="hint">검색어는 카카오에 전달돼요. 지역 이름을 함께 적으면 찾기 쉬워요.</p>
    <div aria-live="polite">${placeSearchMessage?`<p class="hint">${e(placeSearchMessage)}</p>`:""}${placeSearchDone?`<p class="hint">‘${e(placeSearchedKeyword)}’ 검색 결과 · 이름과 주소를 확인해주세요.</p>${placeCandidates.length?`<ul class="place-results">${placeCandidates.map((place,index)=>`<li><button type="button" data-action="place-select" data-index="${index}" aria-pressed="${ridePlace?.source==="search" && ridePlace.latitude===place.latitude && ridePlace.longitude===place.longitude && ridePlace.label===place.label}" ${busy||placeSearchBusy?"disabled":""}><strong>${e(place.label)}</strong><span>${e(place.address || "주소 정보 없음 · 지도에서 위치를 확인해주세요")}</span></button></li>`).join("")}</ul><div class="pager">${button("이전 결과","place-search-previous",placeSearchPage===1||placeSearchBusy?"disabled":"",true)}<span>${placeSearchPage} 페이지</span>${button("다음 결과","place-search-next",!placeSearchNext||placeSearchBusy?"disabled":"",true)}</div>`:'<p class="hint">검색 결과가 없어요. 지역·주소를 더 적거나 지도에서 선택해주세요.</p>'}`:""}</div>`;
}
async function searchPlaces(page = 1) {
  if (!rideTarget || !placeMaps || busy || placeSearchBusy) return;
  const keyword = page===1 ? placeKeyword.trim() : placeSearchedKeyword;
  if (!keyword) { placeSearchMessage="장소명이나 주소를 적어주세요."; render(); return; }
  const generation=++placeSearchGeneration, requestId=rideRequestId;
  placeSearchBusy=true; placeSearchMessage=""; placeSearchDone=false; placeCandidates=[];
  render();
  try {
    const result=await searchPickupPlaces(placeMaps,keyword,page);
    if (generation!==placeSearchGeneration || requestId!==rideRequestId || !rideTarget) return;
    placeCandidates=result.items; placeSearchNext=result.hasNext; placeSearchPage=page;
    placeSearchedKeyword=keyword; placeSearchDone=true;
    if (result.partial) placeSearchMessage="일부 검색을 불러오지 못했어요. 표시된 결과를 확인하거나 다시 검색해주세요.";
  } catch {
    if (generation!==placeSearchGeneration || requestId!==rideRequestId || !rideTarget) return;
    placeSearchMessage="장소 검색을 완료하지 못했어요. 다시 검색하거나 지도·현재 위치로 선택해주세요.";
  } finally {
    if (generation===placeSearchGeneration && requestId===rideRequestId && rideTarget) { placeSearchBusy=false; render(); }
  }
}
function clearPlacePicker() { placePicker?.destroy(); placePicker = null; resetPlaceSearch(); }
function updatePlacePicker() {
  if (!rideTarget) { clearPlacePicker(); return; }
  if (!placeMaps) return;
  placePicker ??= createPlacePicker(placeMaps, point => {
    if (!rideTarget || busy) return;
    ridePlace = {...point, source:"map", at:Date.now()};
    render();
  });
  placePicker.attach(root.querySelector("[data-place-picker]"), ridePlace, !busy);
}
function selectedPlaceText() {
  if (!ridePlace) return "아직 장소를 고르지 않았어요. 검색 결과를 선택하거나 지도·현재 위치로 골라주세요.";
  if (ridePlace.source === "search") return `검색에서 고른 장소 · ${ridePlace.label}. 핀 위치를 확인하고 설명을 보완해주세요.`;
  return ridePlace.source === "map" ? "지도에서 고른 장소예요. 핀 위치와 아래 설명을 확인해주세요."
    : `현재 위치를 선택했어요 · 정확도 약 ${Math.ceil(ridePlace.accuracy)}m. 지도에서 핀을 옮길 수도 있어요.`;
}
let pickingRide = null;
const proposalPanel = createProposalPanel({
  onSubmit: place => { void submitRideProposal(place); },
  searchPlaces: (keyword,page) => searchPickupPlaces(placeMaps,keyword,page),
  onSelectPoint: place => pickupMap?.selectPickingPoint(place) ?? false,
  onCancel: () => { pickingRide=null; proposalPanel.reset(); render(); },
  onBlur: () => { if (!busy) render(); },
});
async function submitRideProposal(place) {
  const requestId=pickingRide;
  if (!requestId) return;
  await run(async () => {
    await api(`/ride-requests/${requestId}/place-proposal`,{method:"PUT",body:{place}});
    pickingRide=null; proposalPanel.reset();
    await refresh(); notice="장소를 제안했어요. 운전자가 확인할 때까지 약속 장소는 그대로예요.";
  });
}
// One passenger has at most one ACTIVE ride, so a single map follows that ride.
function updateRideMap() {
  if (!pickupMap) return;
  pickupMap.attach(root.querySelector("[data-ride-map]"));
  const [current]=[...tracking.values()];
  if (current) pickupMap.update(current.pickup.place,vehicleView(vehicleForPlace(current.pickup,current.vehicle),current.timing,current.deadline,performance.now(),networkAvailable,current.pickup.status),current.pickup.placeProposal?.place);
  if (pickingRide && current && tracking.has(pickingRide) && current.pickup.status==="ACTIVE") {
    proposalPanel.attach(root.querySelector("[data-proposal-slot]"));
    pickupMap.startPicking(point => proposalPanel.setPoint(point));
  } else {
    if (pickingRide) { pickingRide=null; proposalPanel.reset(); }
    pickupMap.stopPicking();
  }
}
function rideEtaText(current) {
  if (current.pickup.status==="ARRIVED") return "차가 도착했어요.";
  const view=vehicleView(vehicleForPlace(current.pickup,current.vehicle),current.timing,current.deadline,performance.now(),networkAvailable,current.pickup.status);
  if (!view) return "도착 시간을 확인하고 있어요.";
  if (view.kind==="lost") return `위치 확인 중 · 마지막 갱신 ${ageText(view.ageMillis)}`;
  const eta=`내 장소까지 ${etaText(view)}`;
  return view.kind==="stale" ? `${eta} · 마지막 갱신 ${ageText(view.ageMillis)}` : eta;
}
function rideSections() {
  const form=rideTarget?`<section class="card confirmation"><h2>${e(rideTarget.nickname)} 님께 마중 요청</h2><p class="majung-id">${e(rideTarget.majungId)}</p><p>장소명·주소로 검색한 뒤 만날 곳을 선택해주세요. 지도나 현재 위치로도 고를 수 있어요.</p>${placeSearchPanel()}${button("현재 위치 선택","ride-location","",true)}${placeMaps?`<div class="pickup-map" data-place-picker></div>${button("지도 중심을 만날 장소로 선택","ride-map-center","",true)}`:'<p class="hint">지도를 불러오지 못하면 현재 위치로 요청할 수 있어요.</p>'}<p class="hint" aria-live="polite">${e(selectedPlaceText())}</p><form id="ride-form"><label>만날 장소 설명<input name="rideLabel" value="${e(rideLabel)}" required maxlength="120" placeholder="예: 정문 앞 주차장 입구" /></label><p class="hint">안전하게 정차할 수 있는 곳인지 확인해주세요. 운전자가 확인하고 수락해야 픽업 대기에 들어가요.</p><button class="primary" ${busy||placeSearchBusy||!ridePlace?"disabled":""}>이 장소로 마중 요청</button></form>${button("돌아가기","ride-dismiss","",true)}</section>`:"";
  const pair=vehiclePair||vehicleRequest?`<section class="card"><h2>${(vehiclePair?.kind || vehicleRequest?.kind) === "enroll" ? "차량과 운전자 처음 연결" : "내 계정과 차량 연결"}</h2><p>운전자 본인의 차량 화면에 표시된 QR인지 확인해주세요. 로그인한 계정을 차량에서 한 번 더 확인하면 연결돼요. 관리자 코드는 필요 없어요. 탑승자는 이 연결을 할 필요가 없어요.</p>${vehicleRequest?`<p>차량에서 ${e(info.member.nickname)} 님의 연결을 승인해주세요.</p>${button("연결 상태 확인","refresh","",true)}`:button("이 계정으로 차량 연결 요청","vehicle-claim")}${button("차량 연결 요청 닫기","vehicle-dismiss","",true)}</section>`:"";
  return `${pair}${accountTab === "settings" ? `<section class="card"><h2>내 차량</h2><p class="hint">차량 연결은 운전자만 필요해요. 탑승자는 운전자를 찾아 바로 요청할 수 있어요.</p>${linkedVehicles.length?linkedVehicles.map(vehicle=>`<p>${e(vehicle.vehicleName)} ${button("계정 연결 해제","vehicle-detach",`data-id="${e(vehicle.vehicleId)}"`,true)}</p>`).join(""):"<p>연결된 차량이 없어요. 운전자라면 차량 앱의 계정 연결 QR을 스캔해주세요.</p>"}</section>` : ""}${accountTab === "pickup" ? `${form}<section class="card${rides.some(ride=>ride.status==="ACTIVE") ? " active-pickup-card" : ""}"><div class="section-heading"><h2>${rides.some(ride=>ride.status==="ACTIVE") ? "진행 중인 픽업" : "받은 초대와 내 마중 요청"}</h2>${button("새로 확인","refresh","",true)}</div>${rides.some(ride=>ride.status==="ACTIVE") ? "" : '<p class="hint">받은 초대를 확인하거나 사람 찾기에서 새 마중을 요청해보세요.</p>'}${rides.length?`<ul class="person-list">${[...rides].sort((a,b)=>({ACTIVE:0,INVITED:1,QUEUED:2,PENDING:3}[a.status]??4)-({ACTIVE:0,INVITED:1,QUEUED:2,PENDING:3}[b.status]??4)).map(rideRow).join("")}</ul>`:`<div class="empty-pickup"><strong>다음 만남을 준비해볼까요?</strong><p>운전자를 찾아 만날 장소와 함께 요청해보세요.<br />초대받았다면 목록에 표시돼요.</p>${button("운전자 찾기", "tab-people")}</div>`}</section>` : ""}`;
}
let accountTab = "pickup";
const failedLogin = new URL(location.href).searchParams.get("login") === "failed";
if (location.search) history.replaceState(null, "", location.pathname);

const button = (label, action, attrs = "", secondary = false) =>
  `<button type="button" data-action="${action}" ${attrs} class="${secondary ? "quiet" : "primary"}" ${busy ? "disabled" : ""}>${label}</button>`;
const pager = (kind, page, count) => `<div class="pager">${button("이전", `${kind}-previous`, page === 0 ? "disabled" : "", true)}<span>${page + 1} 페이지</span>${button("다음", `${kind}-next`, count < 20 || page >= 50 ? "disabled" : "", true)}</div>`;
function person(name, id) { return `<div class="person-name"><strong>${e(name)}</strong><span class="majung-id">${e(id)}</span></div>`; }
function connectionRow(item) {
  const status = item.status === "ACCEPTED" ? "연결됨" : item.direction === "INCOMING" ? "받은 연결 요청" : "상대의 확인을 기다리고 있어요";
  const controls = item.status === "ACCEPTED"
    ? button("연결 해제", "confirm-disconnect", `data-id="${e(item.connectionId)}"`, true)
    : item.direction === "INCOMING"
      ? button("연결 수락", "accept", `data-id="${e(item.connectionId)}"`) + button("거절", "confirm-reject", `data-id="${e(item.connectionId)}"`, true)
      : button("요청 취소", "confirm-cancel", `data-id="${e(item.connectionId)}"`, true);
  return `<li class="person-row">${person(item.nickname, item.majungId)}<span class="connection-state">${status}</span><div class="row-actions">${controls}</div></li>`;
}
let rideStream=null, streamedRide=null, accountStreamConnected=false;
let streamRevision=0;
function syncRideStream() {
  const active=info?.authenticated && networkAvailable && !document.hidden ? rides.find(ride=>ride.status==="ACTIVE")?.requestId ?? null : null;
  if(active===streamedRide)return;
  rideStream?.close();rideStream=null;streamedRide=active;accountStreamConnected=false;
  if(!active)return;
  rideStream=openPickupStream({path:`/api/v1/ride-requests/${active}/events`,
    onState:connected=>{if(streamedRide===active){accountStreamConnected=connected;const indicator=root.querySelector("[data-live-connection]");if(indicator)indicator.textContent=connected?"실시간으로 확인 중":"연결 상태 확인 중";}},
    onChange:()=>{if(streamedRide===active){streamRevision++;nextRefreshAt=0;}},
    onFallback:()=>{if(streamedRide===active){accountStreamConnected=false;streamRevision++;nextRefreshAt=0;}}});
}
function render() {
  syncRideStream();
  if (!info?.authenticated) clearPlacePicker();
  root.setAttribute("aria-busy", String(busy));
  const connectionAlert = !networkAvailable ? '<p class="alert" role="status">인터넷 연결이 끊겼어요. 차량 위치와 도착 시간은 다시 연결한 뒤 확인할게요.</p>' : recoveringNetwork ? '<p class="notice" role="status">다시 연결됐어요. 최신 픽업 정보를 확인하고 있어요.</p>' : "";
  const alerts = `${connectionAlert}${error ? `<div class="alert" role="alert">${e(error)}</div>` : ""}${notice ? `<p class="notice" role="status">${e(notice)}</p>` : ""}`;
  if (info === null) {
    root.innerHTML = `<section class="intro small"><p class="eyebrow">내 연결</p><h1>${busy ? "내 연결을 확인하고 있어요." : "내 연결을 불러오지 못했어요."}</h1><p>${busy ? "잠시만 기다려주세요." : "연결을 확인한 뒤 다시 불러와주세요."}</p></section>${alerts}${!busy ? button("다시 확인", "refresh", "", true) : ""}`;
    return;
  }
  if (!info.authenticated) {
    root.innerHTML = `<section class="intro small"><p class="eyebrow">내 연결</p><h1>찾아두면,<br />다음 만남이 편해져요.</h1><p>닉네임으로 운전자를 찾아 마중을 요청하세요.<br />같은 닉네임은 마중 ID로 구분할 수 있어요.</p></section>${alerts}
      <section class="card"><h2>마중 시작하기</h2><ol class="account-steps"><li>카카오로 로그인해요.</li><li>마중에서 쓸 닉네임을 정해요.</li><li>운전자를 찾아 만날 장소와 함께 요청해요.</li></ol>
      <p class="hint">로그인에는 카카오 회원번호를 사용하고 마중 ID와 닉네임을 관리해요. 이메일·사진·친구 목록은 요청하지 않아요. 아래 ‘위치 공유·보관 안내’를 확인해주세요.</p>
      ${info?.loginEnabled ? '<a class="kakao-login" href="/api/v1/auth/login">카카오로 시작하기</a>' : '<p class="hint">로그인 기능을 준비하고 있어요. 받은 픽업 초대는 기존 링크에서 열 수 있어요.</p>'}
      ${button("다시 확인", "refresh", "", true)}<p class="hint">연결을 수락해도 차량 위치는 공유되지 않아요.</p></section>`;
    return;
  }
  const profile = info.member;
  const ready = profile.profileReady;
  const activePickup = accountTab === "pickup" && rides.some(ride => ride.status === "ACTIVE");
  root.innerHTML = `<section class="account-welcome account-heading${activePickup ? " compact" : ""}"><div><p class="eyebrow">마중</p><h1>${ready ? `${e(profile.nickname)} 님` : "어떤 이름으로<br />만날까요?"}</h1><p class="majung-id">내 마중 ID · ${e(profile.majungId)}</p></div></section>${alerts}
    ${ready ? `<nav class="account-nav${activePickup ? " bottom-nav" : ""}" aria-label="마중 메뉴">${[["pickup","픽업"],["people","사람 찾기"],["settings","내 정보"]].map(([key,label])=>`<button type="button" data-action="tab-${key}" aria-current="${accountTab===key?"page":"false"}">${label}</button>`).join("")}</nav>${rides.some(ride=>ride.status==="ACTIVE") ? `<p class="live-connection" data-live-connection role="status">${accountStreamConnected ? "실시간으로 확인 중" : "연결 상태 확인 중"}</p>` : ""}` : ""}
    ${(!ready || accountTab === "settings") ? `<section class="card"><h2>${ready ? "내 닉네임" : "먼저 닉네임을 정해주세요."}</h2><form id="nickname-form"><label for="nickname">닉네임<input id="nickname" name="nickname" value="${e(nickname)}" minlength="2" maxlength="20" required autocomplete="nickname" placeholder="2~20자" /></label><p class="hint">닉네임은 같을 수 있어요. 마중 ID는 바뀌지 않아요.</p><button class="primary" ${busy ? "disabled" : ""}>${ready ? "닉네임 저장" : "이 이름으로 시작하기"}</button></form>${ready ? button("로그아웃", "logout", "", true) : ""}</section>` : ""}
    ${ready && accountTab === "people" ? `<section class="card"><p class="eyebrow">새 마중 요청</p><h2>누구를 만날까요?</h2><form id="search-form"><label for="query">닉네임 또는 마중 ID<input id="query" name="query" value="${e(query)}" minlength="2" maxlength="32" required placeholder="찾을 사람의 닉네임" autocomplete="off" /></label><button class="primary" ${busy ? "disabled" : ""}>검색</button></form>
      ${searchDone ? results.length ? `<p class="hint">닉네임이 같다면 마중 ID까지 확인해주세요.</p><ul class="person-list">${results.map(item => `<li class="person-row">${person(item.nickname, item.majungId)}${button("마중 요청", "ride-open", `data-id="${e(item.memberId)}"`)}${button("연결만 요청", "request", `data-id="${e(item.memberId)}"`,true)}</li>`).join("")}</ul>` : '<p class="empty-account">검색 결과가 없어요. 닉네임이나 마중 ID를 다시 확인해주세요.</p>' : '<p class="hint">이름·마중 ID만 표시해요. 차량 위치와 픽업 정보는 공개하지 않아요.</p>'}
      ${searchDone ? pager("search", searchPage, results.length) : ""}</section>
      <section class="card"><div class="section-heading"><h2>연결 목록</h2>${button("새로 확인", "refresh", "", true)}</div><p class="hint">연결 요청은 받은 사람이 수락해야 연결돼요.<br />마중 요청·픽업 승인은 별도로 진행해요.</p>
      ${connections.length ? `<ul class="person-list">${connections.map(connectionRow).join("")}</ul>` : '<p class="empty-account">이 페이지에 표시할 연결이 없어요.</p>'}${pager("connections", connectionPage, connections.length)}</section>` : ""}
    ${ready ? rideSections() : ""}
    ${pendingAction ? `<section class="card confirmation" role="region" aria-label="연결 변경 확인"><h2>${e(pendingAction.label)}할까요?</h2><p>${e(pendingAction.nickname)} · ${e(pendingAction.majungId)}</p><div class="row-actions">${button("확인", "confirm-action")}${button("돌아가기", "dismiss-action", "", true)}</div></section>` : ""}`;
  updateRideMap();
  updatePlacePicker();
}
async function refresh() {
  const epochAtStart=networkEpoch;
  try {
  info = await api("/auth/session");
  if (info.authenticated) {
    if (!nickname) nickname = info.member.profileReady ? info.member.nickname : "";
    connections = await api(`/connections?page=${connectionPage}`);
    linkedVehicles = await api("/vehicle-links");
    const requestedAt=performance.now();
    rides = (await api("/ride-requests")).requests.map(item=>({...item,
      currentPickupRemainingSeconds:networkAvailable && epochAtStart===networkEpoch ? item.currentPickupRemainingSeconds : null,
      _etaUntil:requestedAt+Number(item.currentPickupValidForMillis||0)}));
    tracking.clear();
    for (const ride of rides.filter(item=>item.status==="ACTIVE")) {
      try {
        const requestedAt=performance.now();
        const data=await api(`/ride-requests/${ride.requestId}/tracking`);
        const receivedAt=performance.now();
        if (networkAvailable && epochAtStart===networkEpoch) tracking.set(ride.requestId,{...data,deadline:vehicleDeadline(data.vehicle,requestedAt,receivedAt),timing:vehicleTiming(data.vehicle,requestedAt,receivedAt)});
      }
      catch (failure) { if (![403,404,410].includes(failure.status)) throw failure; }
    }
    if (vehicleRequest) {
      const generation=pairingGeneration;
      try {
        const state=await api(vehicleRequestPath(vehicleRequest));
        if (generation!==pairingGeneration) return;
        if (state.status==="LINKED") { clearVehiclePair(); notice="차량 연결을 마쳤어요."; linkedVehicles=await api("/vehicle-links"); }
      } catch (failure) { if ([404,410].includes(failure.status)) { if (generation===pairingGeneration) clearVehiclePair(); } else throw failure; }
    }
  } else { connections = []; results = []; rides = []; tracking.clear(); linkedVehicles = []; searchDone = false; pendingAction = null; }
  } catch (failure) {
    tracking.clear();
    for (const ride of rides) ride.currentPickupRemainingSeconds=null;
    throw failure;
  } finally {
    if (!networkAvailable || epochAtStart!==networkEpoch) hideAccountVehicle();
    else recoveringNetwork=false;
  }
}
function hideAccountVehicle() {
  for (const current of tracking.values()) {current.vehicle=null;current.deadline=0;current.timing=null;}
  for (const ride of rides) ride.currentPickupRemainingSeconds=null;
}
async function search() {
  results = await api(`/accounts/search?query=${encodeURIComponent(searchedQuery)}&page=${searchPage}`);
  searchDone = true;
}
async function run(work) {
  if (busy) return;
  busy = true; error = ""; notice = ""; render();
  try { await work(); }
  catch (failure) {
    error = failure instanceof AccountError ? failure.message : "화면을 불러오지 못했어요. 잠시 후 다시 확인해주세요.";
    if (failure.status === 401) { rides=[]; linkedVehicles=[]; tracking.clear(); rideTarget=null; ridePlace=null; info = null; connections = []; results = []; searchDone = false; pendingAction = null; }
    if (failure.status === 403) {
      // Recover CSRF for the next explicit action; never replay a mutation automatically.
      try { info = await api("/auth/session"); } catch { info = null; }
    }
  } finally { busy = false; render(); }
}
root.addEventListener("input", event => {
  if (event.target.name === "nickname") nickname = event.target.value;
  if (event.target.name === "query") query = event.target.value;
  if (event.target.name === "rideLabel") rideLabel = event.target.value;
  if (event.target.name === "placeKeyword") placeKeyword = event.target.value;
});
root.addEventListener("submit", event => {
  event.preventDefault();
  const type = event.target.id;
  if (type === "place-search-form") { void searchPlaces(); return; }
  run(async () => {
    if (type === "ride-form") {
      if (!rideTarget || !ridePlace || !rideLabel.trim() || placeSearchBusy) return;
      if (ridePlace.source === "gps" && Date.now()-ridePlace.at>120000) throw new AccountError(400,"LOCATION_OLD","현재 위치를 다시 선택해주세요.");
      await api("/ride-requests",{method:"POST",body:{driverId:rideTarget.memberId,requestId:rideRequestId,place:{label:rideLabel.trim(),latitude:ridePlace.latitude,longitude:ridePlace.longitude}}});
      rideTarget=null; ridePlace=null; rideLabel=""; rideRequestId=null;
      await refresh(); notice="운전자에게 마중을 요청했어요. 수락하면 픽업 대기에 들어가요.";
    } else if (type === "nickname-form") {
      info.member = await api("/accounts/me", {method: "PATCH", body: {nickname}});
      nickname = info.member.nickname; notice = "닉네임을 저장했어요.";
    } else if (type === "search-form") { searchPage = 0; searchedQuery = query; await search(); }
  });
});
root.addEventListener("click", event => {
  const target = event.target.closest("button[data-action]");
  if (!target || busy) return;
  const action = target.dataset.action;
  if (action === "ride-open") {
    clearPlacePicker(); accountTab="pickup"; rideTarget=results.find(item=>item.memberId===target.dataset.id); ridePlace=null; rideLabel=""; rideRequestId=crypto.randomUUID(); render(); root.querySelector(".confirmation")?.scrollIntoView({block:"center"}); return;
  }
  if (action === "place-search-previous" || action === "place-search-next") {
    const page=placeSearchPage+(action==="place-search-next"?1:-1);
    if (page>=1 && page<=3 && (action==="place-search-previous" || placeSearchNext)) void searchPlaces(page);
    return;
  }
  if (action === "place-select") {
    if (placeSearchBusy || !rideTarget) return;
    const chosen=placeCandidates[Number(target.dataset.index)];
    if (!chosen) return;
    ridePlace={latitude:chosen.latitude,longitude:chosen.longitude,label:chosen.label,source:"search",at:Date.now()};
    rideLabel=chosen.label;
    render(); root.querySelector("[data-place-picker]")?.scrollIntoView({block:"center"}); return;
  }
  if (action?.startsWith("tab-")) {
    const next=action.slice(4);
    if (!["pickup","people","settings"].includes(next)) return;
    accountTab=next; render(); return;
  }
  if (action === "ride-map-center") { placePicker?.chooseCenter(); return; }
  if (action === "propose-start") { const [id]=[...tracking.keys()]; if (!id) return; pickingRide=id; render(); return; }
  if (action === "propose-withdraw") {
    const [id]=[...tracking.keys()]; if (!id) return;
    run(async () => { await api(`/ride-requests/${id}/place-proposal`,{method:"DELETE"}); await refresh(); notice="장소 제안을 취소했어요."; });
    return;
  }
  if (action === "ride-dismiss") { rideTarget=null; ridePlace=null; render(); return; }
  if (action === "push-on" || action === "push-off") { toggleRidePush(target.dataset.id, action === "push-on"); return; }
  if (action.startsWith("confirm-") && action !== "confirm-action") {
    const item = connections.find(item => item.connectionId === target.dataset.id);
    if (!item) return;
    pendingAction = {...item, action: action.slice(8), label: {disconnect: "연결 해제", reject: "요청 거절", cancel: "요청 취소"}[action.slice(8)]};
    render(); root.querySelector(".confirmation")?.scrollIntoView({block: "center"}); return;
  }
  if (action === "dismiss-action") { pendingAction = null; render(); return; }
  run(async () => {
    if (action === "ride-location") {
      if (!navigator.geolocation) throw new AccountError(400,"LOCATION_UNAVAILABLE","이 브라우저에서 위치를 사용할 수 없어요.");
      const position=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,()=>reject(new AccountError(400,"LOCATION_UNAVAILABLE","위치 권한과 휴대전화 GPS를 확인한 뒤 다시 선택해주세요.")),{enableHighAccuracy:true,timeout:15000,maximumAge:0}));
      if (position.coords.accuracy>300) throw new AccountError(400,"LOCATION_INACCURATE","위치 오차가 커요. GPS가 잘 잡히는 곳에서 다시 선택해주세요.");
      ridePlace={latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy,source:"gps",at:Date.now()};
    } else if (action === "invitation-accept" || action === "invitation-reject") {
      const invite=rides.find(item=>item.requestId===target.dataset.id && item.status==="INVITED");
      if (!invite) return;
      const accepting=action==="invitation-accept";
      if (!window.confirm(`${invite.nickname} 님의 초대를 ${accepting?"수락":"거절"}할까요?\n만날 장소 · ${invite.place.label}`)) return;
      await api(`/ride-requests/${invite.requestId}/${accepting?"accept":"reject"}-invitation`,{method:"POST"});
      await refresh(); notice=accepting?"초대를 수락했어요. 운전자가 내 픽업을 시작하면 위치를 확인할 수 있어요.":"초대를 거절했어요.";
    } else if (action === "ride-cancel") {
      if (!window.confirm("이 마중 요청을 취소할까요?")) return;
      await api(`/ride-requests/${target.dataset.id}/cancel`,{method:"POST"}); await refresh();
    } else if (action === "ride-ready" || action === "ride-preparing") {
      const current=tracking.get(target.dataset.id); if (!current) return;
      await api(`/ride-requests/${target.dataset.id}/readiness`,{method:"PUT",body:{readiness:action==="ride-ready"?"READY":"PREPARING",sequence:current.pickup.participant.readinessSequence+1}}); await refresh();
    } else if (action === "vehicle-claim") {
      if (!vehiclePair || vehiclePair.until<=Date.now()) { clearVehiclePair(); throw new AccountError(410,"QR_EXPIRED","QR이 만료됐어요. 차량에서 다시 열어주세요."); }
      const generation=pairingGeneration;
      const pair=vehiclePair;
      const claimed=await api(pair.kind === "enroll" ? `/vehicle-links/enrollments/${pair.challengeId}` : "/vehicle-links/requests",
        {method:"POST",body:pair.kind === "enroll" ? {code:pair.code} : {challengeId:pair.challengeId,code:pair.code}});
      if (generation!==pairingGeneration) return;
      vehicleRequest={...claimed,kind:pair.kind,challengeId:pair.challengeId};
      try { sessionStorage.removeItem("majung.vehiclePair"); sessionStorage.setItem("majung.vehicleRequest",JSON.stringify(vehicleRequest)); } catch { }
      vehiclePair=null; await refresh();
    } else if (action === "vehicle-dismiss") {
      if (vehicleRequest) await api(`${vehicleRequestPath(vehicleRequest)}/cancel`,{method:"POST"});
      clearVehiclePair();
    } else if (action === "vehicle-detach") {
      if (!window.confirm("차량에서 이 운전자 계정 연결을 해제할까요?")) return;
      await api(`/vehicle-links/${target.dataset.id}`,{method:"DELETE"}); await refresh();
    } else if (action === "refresh") { await refresh(); notice = "최신 상태를 확인했어요."; }
    else if (action === "logout") {
      await api("/auth/logout", {method: "POST"}); clearVehiclePair(); rideTarget=null; ridePlace=null; rides=[]; tracking.clear(); info = null; nickname = ""; connections = []; results = []; pendingAction = null;
      await refresh(); notice = "로그아웃했어요.";
    } else if (action === "request") {
      await api("/connections", {method: "POST", body: {memberId: target.dataset.id}});
      connectionPage = 0; await refresh(); notice = "연결 상태를 확인했어요. 받은 사람이 수락하면 연결돼요.";
    } else if (action === "accept" || action === "confirm-action") {
      const id = action === "accept" ? target.dataset.id : pendingAction.connectionId;
      const change = action === "accept" ? "accept" : pendingAction.action;
      await api(`/connections/${id}/${change}`, {method: "POST"}); pendingAction = null;
      await refresh(); notice = "연결 상태를 반영했어요.";
    } else if (action.startsWith("search-")) {
      searchPage += action.endsWith("next") ? 1 : -1; await search();
    } else if (action.startsWith("connections-")) {
      connectionPage += action.endsWith("next") ? 1 : -1; await refresh();
    }
  });
});
run(async () => {
  await refresh();
  if (failedLogin) error = "카카오 로그인을 마치지 못했어요. 다시 시도해주세요.";
});

// Pause while the user enters a form; mutations are never retried by polling.
let nextRefreshAt = 0;
window.addEventListener("offline",()=>{
  networkAvailable=false;recoveringNetwork=false;networkEpoch++;streamRevision++;
  hideAccountVehicle();syncRideStream();render();
});
window.addEventListener("online",()=>{
  networkAvailable=true;recoveringNetwork=true;networkEpoch++;streamRevision++;
  nextRefreshAt=0;render();
});
document.addEventListener("visibilitychange", () => {
  syncRideStream();
  if (!document.hidden) nextRefreshAt = 0;
});
setInterval(() => {
  if (!networkAvailable || document.hidden || busy || !info?.authenticated || rideTarget || root.contains(document.activeElement) && document.activeElement?.tagName === "INPUT") return;
  if (performance.now() < nextRefreshAt) return;
  const visible=()=>JSON.stringify({recoveringNetwork,member:info?.member,authenticated:info?.authenticated,connections,rides:rides.map(({_etaUntil,...item})=>item),linkedVehicles,vehicleRequest,tracking:[...tracking].map(([id,{deadline,timing,...data}])=>[id,data])});
  const before=visible(); const previousError=error; const revisionAtStart=streamRevision; busy=true;
  refresh().then(()=>{
    busy=false;
    if (error === "상태를 새로 확인하지 못했어요. 새로 확인을 눌러주세요.") error="";
    if (visible()!==before || error!==previousError) render();
  }).catch(failure=>{
    busy=false;
    // A failed account read must not leave the previous vehicle position or countdown visible.
    tracking.clear();
    for (const ride of rides) ride.currentPickupRemainingSeconds=null;
    if (failure.status===401) { info=null; rides=[]; linkedVehicles=[]; rideTarget=null; ridePlace=null; }
    else error="상태를 새로 확인하지 못했어요. 새로 확인을 눌러주세요.";
    render();
  }).finally(()=>{
    // A change arriving while this read is in flight still needs its own refresh.
    nextRefreshAt=streamRevision!==revisionAtStart ? 0 : performance.now()+(accountStreamConnected?30000:rides.some(ride=>ride.status==="ACTIVE")?3000:10000);
  });
}, 1000);

setInterval(()=>{
  let expired=false;
  // Update the countdown text in place; a full render would interrupt typing.
  for (const [id,current] of tracking) {
    const node=root.querySelector(`[data-ride-eta="${CSS.escape(id)}"]`);
    const text=rideEtaText(current);
    if (node && node.textContent!==text) node.textContent=text;
  }
  for (const item of rides) if (item.currentPickupRemainingSeconds!=null && performance.now()>=item._etaUntil) { item.currentPickupRemainingSeconds=null; expired=true; }
  updateRideMap();
  if (expired && !busy && !rideTarget && document.activeElement?.tagName!=="INPUT") render();
},1000);

async function toggleRidePush(requestId, turnOn) {
  if (pushBusyId || !requestId) return;
  pushBusyId=requestId; pushMessageFor=requestId; pushMessage=""; render();
  try {
    if (turnOn) {
      const endpoint=await enableArrivalPush(pushKey);
      await api(`/ride-requests/${requestId}/arrival-push`,{method:"PUT",body:{endpoint}});
      setPushFlag(requestId,true);
    } else {
      await api(`/ride-requests/${requestId}/arrival-push`,{method:"DELETE"});
      setPushFlag(requestId,false);
      await disableBrowserPush();
    }
  } catch (failure) { pushMessage=pushErrorText(failure); }
  finally { pushBusyId=null; render(); }
}

// Start without push: a failed configuration read keeps the page working and hides the notice card.
void fetch("/api/v1/config", { cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(8000) })
  .then(response => response.ok ? response.json() : null)
  .then(configuration => { pushKey = typeof configuration?.webPushPublicKey === "string" ? configuration.webPushPublicKey : null; if (pushKey && tracking.size && !busy) render(); return loadKakaoMaps(configuration?.kakaoMapJavaScriptKey); })
  .then(maps => { if (!maps) return; placeMaps=maps; pickupMap=createPickupMap(maps); if ((tracking.size || rideTarget) && !busy) render(); })
  .catch(() => { });

window.addEventListener("pagehide",()=>{rideStream?.close();rideStream=null;streamedRide=null;});
