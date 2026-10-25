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
  if (!info?.authenticated) {
    root.innerHTML = `<section class="intro small"><p class="eyebrow">내 연결</p><h1>찾아두면,<br />다음 만남이 편해져요.</h1><p>닉네임으로 사람을 찾아 연결해두세요.<br />같은 닉네임은 마중 ID로 구분할 수 있어요.</p></section>${alerts}
      <section class="card"><h2>마중 시작하기</h2><ol class="account-steps"><li>카카오로 로그인해요.</li><li>마중에서 쓸 닉네임을 정해요.</li><li>상대를 찾아 연결 요청을 보내요.</li></ol>
      ${info?.loginEnabled ? '<a class="kakao-login" href="/api/v1/auth/login">카카오로 시작하기</a>' : '<p class="hint">로그인 기능을 준비하고 있어요. 받은 픽업 초대는 기존 링크에서 열 수 있어요.</p>'}
      ${button("다시 확인", "refresh", "", true)}<p class="hint">연결을 수락해도 차량 위치는 공유되지 않아요.</p></section>`;
    return;
  }
  const profile = info.member;
  const ready = profile.profileReady;
  root.innerHTML = `<section class="intro small account-heading"><div><p class="eyebrow">내 연결</p><h1>${ready ? `${e(profile.nickname)} 님` : "어떤 이름으로<br />만날까요?"}</h1><p class="majung-id">내 마중 ID · ${e(profile.majungId)}</p></div>${button("로그아웃", "logout", "", true)}</section>${alerts}
    <section class="card"><h2>${ready ? "내 닉네임" : "먼저 닉네임을 정해주세요."}</h2><form id="nickname-form"><label for="nickname">닉네임<input id="nickname" name="nickname" value="${e(nickname)}" minlength="2" maxlength="20" required autocomplete="nickname" placeholder="2~20자" /></label><p class="hint">닉네임은 같을 수 있어요. 마중 ID는 바뀌지 않아요.</p><button class="primary" ${busy ? "disabled" : ""}>${ready ? "닉네임 저장" : "이 이름으로 시작하기"}</button></form></section>
    ${ready ? `<section class="card"><h2>사람 찾기</h2><form id="search-form"><label for="query">닉네임 또는 마중 ID<input id="query" name="query" value="${e(query)}" minlength="2" maxlength="32" required placeholder="찾을 사람의 닉네임" autocomplete="off" /></label><button class="primary" ${busy ? "disabled" : ""}>검색</button></form>
      ${searchDone ? results.length ? `<p class="hint">닉네임이 같다면 마중 ID까지 확인해주세요.</p><ul class="person-list">${results.map(item => `<li class="person-row">${person(item.nickname, item.majungId)}${button("연결 요청", "request", `data-id="${e(item.memberId)}"`)}</li>`).join("")}</ul>` : '<p class="empty-account">검색 결과가 없어요. 닉네임이나 마중 ID를 다시 확인해주세요.</p>' : '<p class="hint">이름·마중 ID만 표시해요. 차량 위치와 픽업 정보는 공개하지 않아요.</p>'}
      ${searchDone ? pager("search", searchPage, results.length) : ""}</section>
      <section class="card"><div class="section-heading"><h2>연결 목록</h2>${button("새로 확인", "refresh", "", true)}</div><p class="hint">연결 요청은 받은 사람이 수락해야 연결돼요.<br />마중 요청·픽업 승인은 별도로 진행해요.</p>
      ${connections.length ? `<ul class="person-list">${connections.map(connectionRow).join("")}</ul>` : '<p class="empty-account">이 페이지에 표시할 연결이 없어요.</p>'}${pager("connections", connectionPage, connections.length)}</section>` : ""}
    ${pendingAction ? `<section class="card confirmation" role="region" aria-label="연결 변경 확인"><h2>${e(pendingAction.label)}할까요?</h2><p>${e(pendingAction.nickname)} · ${e(pendingAction.majungId)}</p><div class="row-actions">${button("확인", "confirm-action")}${button("돌아가기", "dismiss-action", "", true)}</div></section>` : ""}`;
}
async function refresh() {
  info = await api("/auth/session");
  if (info.authenticated) {
    if (!nickname) nickname = info.member.profileReady ? info.member.nickname : "";
    connections = await api(`/connections?page=${connectionPage}`);
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
    if (failure.status === 401) { info = null; connections = []; results = []; searchDone = false; pendingAction = null; }
    if (failure.status === 403) {
      // Recover CSRF for the next explicit action; never replay a mutation automatically.
      try { info = await api("/auth/session"); } catch { info = null; }
    }
  } finally { busy = false; render(); }
}
root.addEventListener("input", event => {
  if (event.target.name === "nickname") nickname = event.target.value;
  if (event.target.name === "query") query = event.target.value;
});
root.addEventListener("submit", event => {
  event.preventDefault();
  const type = event.target.id;
  run(async () => {
    if (type === "nickname-form") {
      info.member = await api("/accounts/me", {method: "PATCH", body: {nickname}});
      nickname = info.member.nickname; notice = "닉네임을 저장했어요.";
    } else if (type === "search-form") { searchPage = 0; searchedQuery = query; await search(); }
  });
});
root.addEventListener("click", event => {
  const target = event.target.closest("button[data-action]");
  if (!target || busy) return;
  const action = target.dataset.action;
  if (action.startsWith("confirm-") && action !== "confirm-action") {
    const item = connections.find(item => item.connectionId === target.dataset.id);
    if (!item) return;
    pendingAction = {...item, action: action.slice(8), label: {disconnect: "연결 해제", reject: "요청 거절", cancel: "요청 취소"}[action.slice(8)]};
    render(); root.querySelector(".confirmation")?.scrollIntoView({block: "center"}); return;
  }
  if (action === "dismiss-action") { pendingAction = null; render(); return; }
  run(async () => {
    if (action === "refresh") { await refresh(); notice = "연결 목록을 다시 확인했어요."; }
    else if (action === "logout") {
      await api("/auth/logout", {method: "POST"}); info = null; nickname = ""; connections = []; results = []; pendingAction = null;
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
