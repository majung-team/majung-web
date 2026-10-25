import { createAccountClient, AccountError } from "./account-api.js";
import { escapeHtml as e } from "./model.js";

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
let linkedVehicles = [];
let vehicleRequest = null;
let vehiclePair = null;
function readVehiclePair() {
  const match=/^#vehicle\/([a-f0-9-]{36})\/([A-Za-z0-9_-]{43})$/.exec(location.hash);
  if (match) {
    vehiclePair={challengeId:match[1],code:match[2],until:Date.now()+300000}; vehicleRequest=null;
    try { sessionStorage.setItem("majung.vehiclePair",JSON.stringify(vehiclePair)); sessionStorage.removeItem("majung.vehicleRequest"); } catch { }
  } else {
    try {
      const stored=JSON.parse(sessionStorage.getItem("majung.vehiclePair")||"null");
      vehiclePair=stored?.until>Date.now()?stored:null;
      if (!vehiclePair) sessionStorage.removeItem("majung.vehiclePair");
      vehicleRequest=JSON.parse(sessionStorage.getItem("majung.vehicleRequest")||"null");
    } catch { }
  }
  if (location.hash.startsWith("#vehicle/")) history.replaceState(null,"",location.pathname+location.search);
}
readVehiclePair();
window.addEventListener("hashchange",()=>{ if (!location.hash.startsWith("#vehicle/")) return; readVehiclePair(); if (!busy) run(refresh); });
function clearVehiclePair() {
  vehiclePair=null; vehicleRequest=null;
  try { sessionStorage.removeItem("majung.vehiclePair"); sessionStorage.removeItem("majung.vehicleRequest"); } catch { }
}
function rideRow(source) {
  const item={...source};
  if (performance.now()>=item._etaUntil) item.currentPickupRemainingSeconds=null;
  const labels={PENDING:"운전자 응답 대기",QUEUED:"수락됨 · 픽업 대기",ACTIVE:"내 픽업 진행 중",COMPLETED:"탑승 완료",CANCELLED:"취소됨",REJECTED:"거절됨",EXPIRED:"만료됨"};
  const current=tracking.get(item.requestId);
  const fresh=current?.vehicle.freshness==="FRESH" && performance.now()<current.validUntil;
  const waiting=item.status==="QUEUED" ? `<p>내 앞에 ${Number(item.peopleAhead)||0}건이 있어요.</p><p class="hint">${item.currentPickupRemainingSeconds == null ? "현재 진행 중인 픽업의 남은 시간은 아직 확인할 수 없어요." : `현재 진행 중인 픽업 장소까지 약 ${Math.max(1,Math.ceil(item.currentPickupRemainingSeconds/60))}분 남았어요.`}<br />${item.currentPickupRemainingSeconds == null ? "내 장소 도착 예정 시간도 아직 정해지지 않았어요." : "위 시간은 내 장소 도착 예정 시간이 아니에요. 실제 탑승 시간에 따라 더 걸릴 수 있어요."}</p>` : "";
  const active=current ? `<p data-ride-eta="${e(item.requestId)}">${current.pickup.status==="ARRIVED"?"차가 도착했어요.":fresh?`내 장소까지 약 ${Math.max(1,Math.ceil(current.vehicle.durationSeconds/60))}분` : "차량의 새 위치와 시간을 기다리고 있어요."}</p><p>내 준비 상태 · ${e(current.pickup.participant.readiness==="READY"?"준비 완료":"준비 중")}</p>${button("준비 완료","ride-ready",`data-id="${e(item.requestId)}"`)}${button("준비 중","ride-preparing",`data-id="${e(item.requestId)}"`,true)}` : "";
  return `<li class="person-row ride-row">${person(item.nickname,item.majungId)}<strong>${e(labels[item.status]||item.status)}</strong><p>내가 요청한 장소 · ${e(item.place.label)}</p>${waiting}${active}${item.status==="PENDING"?`<p class="hint">${e(new Date(item.expiresAt).toLocaleTimeString("ko-KR"))}까지 응답이 없으면 만료돼요.</p>`:""}${["PENDING","QUEUED"].includes(item.status)?button("마중 요청 취소","ride-cancel",`data-id="${e(item.requestId)}"`,true):""}</li>`;
}
function rideSections() {
  const form=rideTarget?`<section class="card confirmation"><h2>${e(rideTarget.nickname)} 님께 마중 요청</h2><p class="majung-id">${e(rideTarget.majungId)}</p><p>지금 있는 위치에서 만나는 요청이에요. 차량 QR이나 기존 연결은 필요하지 않아요.</p>${button(ridePlace?"현재 위치 다시 선택":"현재 위치 선택","ride-location","",true)}<p class="hint">${ridePlace?`위치를 선택했어요 · 정확도 약 ${Math.ceil(ridePlace.accuracy)}m` : "위치 권한을 허용한 뒤 만날 장소 설명을 적어주세요."}</p><form id="ride-form"><label>만날 장소 설명<input name="rideLabel" value="${e(rideLabel)}" required maxlength="120" placeholder="예: 정문 앞 주차장 입구" /></label><p class="hint">안전하게 정차할 수 있는 곳인지 확인해주세요. 운전자가 확인하고 수락해야 픽업 대기에 들어가요.</p><button class="primary" ${busy||!ridePlace?"disabled":""}>이 장소로 마중 요청</button></form>${button("돌아가기","ride-dismiss","",true)}</section>`:"";
  const pair=vehiclePair||vehicleRequest?`<section class="card"><h2>내 계정과 차량 연결</h2><p>운전자 본인의 차량에서 연 QR인지 확인해주세요. 탑승자는 이 연결을 할 필요가 없어요.</p>${vehicleRequest?`<p>차량에서 ${e(info.member.nickname)} 님의 연결을 승인해주세요.</p>${button("연결 상태 확인","refresh","",true)}`:button("이 계정으로 차량 연결 요청","vehicle-claim")}${button("차량 연결 요청 닫기","vehicle-dismiss","",true)}</section>`:"";
  return `${pair}<section class="card"><h2>내 차량</h2><p class="hint">차량 연결은 운전자만 필요해요. 탑승자는 운전자를 찾아 바로 요청할 수 있어요.</p>${linkedVehicles.length?linkedVehicles.map(vehicle=>`<p>${e(vehicle.vehicleName)} ${button("계정 연결 해제","vehicle-detach",`data-id="${e(vehicle.vehicleId)}"`,true)}</p>`).join(""):"<p>연결된 차량이 없어요. 운전자라면 차량 앱의 계정 연결 QR을 스캔해주세요.</p>"}</section>${form}<section class="card"><div class="section-heading"><h2>내 마중 요청</h2>${button("새로 확인","refresh","",true)}</div><p class="hint">운전자를 검색해 장소와 함께 요청할 수 있어요. 연결 이력이 없어도 가능해요.</p>${rides.length?`<ul class="person-list">${rides.map(rideRow).join("")}</ul>`:"<p>아직 보낸 마중 요청이 없어요.</p>"}</section>`;
}
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
function render() {
  root.setAttribute("aria-busy", String(busy));
  const alerts = `${error ? `<div class="alert" role="alert">${e(error)}</div>` : ""}${notice ? `<p class="notice" role="status">${e(notice)}</p>` : ""}`;
  if (info === null) {
    root.innerHTML = `<section class="intro small"><p class="eyebrow">내 연결</p><h1>${busy ? "내 연결을 확인하고 있어요." : "내 연결을 불러오지 못했어요."}</h1><p>${busy ? "잠시만 기다려주세요." : "연결을 확인한 뒤 다시 불러와주세요."}</p></section>${alerts}${!busy ? button("다시 확인", "refresh", "", true) : ""}`;
    return;
  }
  if (!info.authenticated) {
    root.innerHTML = `<section class="intro small"><p class="eyebrow">내 연결</p><h1>찾아두면,<br />다음 만남이 편해져요.</h1><p>닉네임으로 운전자를 찾아 마중을 요청하세요.<br />같은 닉네임은 마중 ID로 구분할 수 있어요.</p></section>${alerts}
      <section class="card"><h2>마중 시작하기</h2><ol class="account-steps"><li>카카오로 로그인해요.</li><li>마중에서 쓸 닉네임을 정해요.</li><li>운전자를 찾아 만날 장소와 함께 요청해요.</li></ol>
      ${info?.loginEnabled ? '<a class="kakao-login" href="/api/v1/auth/login">카카오로 시작하기</a>' : '<p class="hint">로그인 기능을 준비하고 있어요. 받은 픽업 초대는 기존 링크에서 열 수 있어요.</p>'}
      ${button("다시 확인", "refresh", "", true)}<p class="hint">연결을 수락해도 차량 위치는 공유되지 않아요.</p></section>`;
    return;
  }
  const profile = info.member;
  const ready = profile.profileReady;
  root.innerHTML = `<section class="intro small account-heading"><div><p class="eyebrow">내 연결</p><h1>${ready ? `${e(profile.nickname)} 님` : "어떤 이름으로<br />만날까요?"}</h1><p class="majung-id">내 마중 ID · ${e(profile.majungId)}</p></div>${button("로그아웃", "logout", "", true)}</section>${alerts}
    <section class="card"><h2>${ready ? "내 닉네임" : "먼저 닉네임을 정해주세요."}</h2><form id="nickname-form"><label for="nickname">닉네임<input id="nickname" name="nickname" value="${e(nickname)}" minlength="2" maxlength="20" required autocomplete="nickname" placeholder="2~20자" /></label><p class="hint">닉네임은 같을 수 있어요. 마중 ID는 바뀌지 않아요.</p><button class="primary" ${busy ? "disabled" : ""}>${ready ? "닉네임 저장" : "이 이름으로 시작하기"}</button></form></section>
    ${ready ? `<section class="card"><h2>사람 찾기</h2><form id="search-form"><label for="query">닉네임 또는 마중 ID<input id="query" name="query" value="${e(query)}" minlength="2" maxlength="32" required placeholder="찾을 사람의 닉네임" autocomplete="off" /></label><button class="primary" ${busy ? "disabled" : ""}>검색</button></form>
      ${searchDone ? results.length ? `<p class="hint">닉네임이 같다면 마중 ID까지 확인해주세요.</p><ul class="person-list">${results.map(item => `<li class="person-row">${person(item.nickname, item.majungId)}${button("마중 요청", "ride-open", `data-id="${e(item.memberId)}"`)}${button("연결만 요청", "request", `data-id="${e(item.memberId)}"`,true)}</li>`).join("")}</ul>` : '<p class="empty-account">검색 결과가 없어요. 닉네임이나 마중 ID를 다시 확인해주세요.</p>' : '<p class="hint">이름·마중 ID만 표시해요. 차량 위치와 픽업 정보는 공개하지 않아요.</p>'}
      ${searchDone ? pager("search", searchPage, results.length) : ""}</section>
      <section class="card"><div class="section-heading"><h2>연결 목록</h2>${button("새로 확인", "refresh", "", true)}</div><p class="hint">연결 요청은 받은 사람이 수락해야 연결돼요.<br />마중 요청·픽업 승인은 별도로 진행해요.</p>
      ${connections.length ? `<ul class="person-list">${connections.map(connectionRow).join("")}</ul>` : '<p class="empty-account">이 페이지에 표시할 연결이 없어요.</p>'}${pager("connections", connectionPage, connections.length)}</section>` : ""}
    ${ready ? rideSections() : ""}
    ${pendingAction ? `<section class="card confirmation" role="region" aria-label="연결 변경 확인"><h2>${e(pendingAction.label)}할까요?</h2><p>${e(pendingAction.nickname)} · ${e(pendingAction.majungId)}</p><div class="row-actions">${button("확인", "confirm-action")}${button("돌아가기", "dismiss-action", "", true)}</div></section>` : ""}`;
}
async function refresh() {
  info = await api("/auth/session");
  if (info.authenticated) {
    if (!nickname) nickname = info.member.profileReady ? info.member.nickname : "";
    connections = await api(`/connections?page=${connectionPage}`);
    linkedVehicles = await api("/vehicle-links");
    const requestedAt=performance.now();
    rides = (await api("/ride-requests")).requests.map(item=>({...item,_etaUntil:requestedAt+Number(item.currentPickupValidForMillis||0)}));
    tracking.clear();
    for (const ride of rides.filter(item=>item.status==="ACTIVE")) {
      try {
        const requestedAt=performance.now();
        const data=await api(`/ride-requests/${ride.requestId}/tracking`);
        tracking.set(ride.requestId,{...data,validUntil:requestedAt+Number(data.vehicle.validForMillis||0)});
      }
      catch (failure) { if (![403,404,410].includes(failure.status)) throw failure; }
    }
    if (vehicleRequest) {
      try {
        const state=await api(`/vehicle-links/requests/${vehicleRequest.challengeId}`);
        if (state.status==="LINKED") { clearVehiclePair(); notice="차량 연결을 마쳤어요."; linkedVehicles=await api("/vehicle-links"); }
      } catch (failure) { if ([404,410].includes(failure.status)) clearVehiclePair(); else throw failure; }
    }
  } else { connections = []; results = []; searchDone = false; pendingAction = null; }
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
});
root.addEventListener("submit", event => {
  event.preventDefault();
  const type = event.target.id;
  run(async () => {
    if (type === "ride-form") {
      if (!rideTarget || !ridePlace || !rideLabel.trim()) return;
      if (Date.now()-ridePlace.at>120000) throw new AccountError(400,"LOCATION_OLD","현재 위치를 다시 선택해주세요.");
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
    rideTarget=results.find(item=>item.memberId===target.dataset.id); ridePlace=null; rideLabel=""; rideRequestId=crypto.randomUUID(); render(); root.querySelector(".confirmation")?.scrollIntoView({block:"center"}); return;
  }
  if (action === "ride-dismiss") { rideTarget=null; ridePlace=null; render(); return; }
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
      ridePlace={latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy,at:Date.now()};
    } else if (action === "ride-cancel") {
      if (!window.confirm("이 마중 요청을 취소할까요?")) return;
      await api(`/ride-requests/${target.dataset.id}/cancel`,{method:"POST"}); await refresh();
    } else if (action === "ride-ready" || action === "ride-preparing") {
      const current=tracking.get(target.dataset.id); if (!current) return;
      await api(`/ride-requests/${target.dataset.id}/readiness`,{method:"PUT",body:{readiness:action==="ride-ready"?"READY":"PREPARING",sequence:current.pickup.participant.readinessSequence+1}}); await refresh();
    } else if (action === "vehicle-claim") {
      if (!vehiclePair || vehiclePair.until<=Date.now()) { clearVehiclePair(); throw new AccountError(410,"QR_EXPIRED","QR이 만료됐어요. 차량에서 다시 열어주세요."); }
      vehicleRequest=await api("/vehicle-links/requests",{method:"POST",body:{challengeId:vehiclePair.challengeId,code:vehiclePair.code}});
      try { sessionStorage.removeItem("majung.vehiclePair"); sessionStorage.setItem("majung.vehicleRequest",JSON.stringify(vehicleRequest)); } catch { }
      vehiclePair=null; await refresh();
    } else if (action === "vehicle-dismiss") {
      if (vehicleRequest) await api(`/vehicle-links/requests/${vehicleRequest.challengeId}/cancel`,{method:"POST"});
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
setInterval(() => {
  if (document.hidden || busy || !info?.authenticated || rideTarget || root.contains(document.activeElement) && document.activeElement?.tagName === "INPUT") return;
  const visible=()=>JSON.stringify({member:info?.member,authenticated:info?.authenticated,connections,rides:rides.map(({_etaUntil,...item})=>item),linkedVehicles,vehicleRequest,tracking:[...tracking].map(([id,{validUntil,...data}])=>[id,data])});
  const before=visible(); busy=true;
  refresh().then(()=>{ busy=false; if (visible()!==before) render(); }).catch(failure=>{
    busy=false;
    if (failure.status===401) { info=null; rides=[]; tracking.clear(); linkedVehicles=[]; rideTarget=null; ridePlace=null; render(); }
    else if (error!=="상태를 새로 확인하지 못했어요. 새로 확인을 눌러주세요.") { error="상태를 새로 확인하지 못했어요. 새로 확인을 눌러주세요."; render(); }
  });
}, 10000);

setInterval(()=>{
  let expired=false;
  for (const current of tracking.values()) if (current.vehicle.freshness==="FRESH" && performance.now()>=current.validUntil) {
    current.vehicle={...current.vehicle,freshness:"STALE",latitude:null,longitude:null,durationSeconds:null}; expired=true;
  }
  for (const item of rides) if (item.currentPickupRemainingSeconds!=null && performance.now()>=item._etaUntil) { item.currentPickupRemainingSeconds=null; expired=true; }
  if (expired) {
    for (const [id,current] of tracking) {
      if (current.vehicle.freshness!=="FRESH" && current.pickup.status!=="ARRIVED") {
        const node=root.querySelector(`[data-ride-eta="${CSS.escape(id)}"]`);
        if(node) node.textContent="차량의 새 위치와 시간을 기다리고 있어요.";
      }
    }
    if (!busy && !rideTarget && document.activeElement?.tagName!=="INPUT") render();
  }
},1000);
