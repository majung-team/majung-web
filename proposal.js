import { escapeHtml as e } from "./model.js";

// A proposal never changes the confirmed place; the driver decides on the car.
export const proposalLabelMax = 120;

export function buildProposal(label, point) {
  const text = String(label ?? "").trim();
  if (!Number.isFinite(point?.latitude) || !Number.isFinite(point?.longitude) ||
      Math.abs(point.latitude)>90 || Math.abs(point.longitude)>180 ||
      (point.latitude===0 && point.longitude===0)) {
    return { error: "장소를 검색해 고르거나 지도를 눌러 핀을 놓아주세요." };
  }
  if (!text) return { error: "어떤 곳인지 짧게 적어주세요. 예: 정문 앞" };
  if (text.length > proposalLabelMax) return { error: `장소 설명은 ${proposalLabelMax}자까지 적을 수 있어요.` };
  return { place: { label: text, latitude: point.latitude, longitude: point.longitude } };
}

// Keep the confirmed/proposed text and withdrawal available when the map fails.
export function proposalBlock({ proposal, picking, mapReady, status }) {
  if (status !== "ACTIVE") return "";
  const summary = proposal
    ? `<div class="proposal">
        <div class="proposal-badge-row">
          <span class="proposal-badge">${proposal.proposedBy === "DRIVER" ? "운전자가 제안한 장소" : "내가 제안한 장소"}</span>
          <span class="proposal-status-tag">${proposal.proposedBy === "DRIVER" ? "수락 대기 중" : "운전자 확인 대기 중"}</span>
        </div>
        <strong class="proposal-place-name">${e(proposal.place.label)}</strong>
        <p class="proposal-desc">${proposal.proposedBy === "DRIVER" ? "마음에 들지 않으면 다른 장소를 제안할 수 있어요. " : ""}운전자가 확인할 때까지 약속 장소는 그대로예요.</p>
        ${proposal.proposedBy === "PASSENGER" ? '<button type="button" data-action="propose-withdraw" class="quiet proposal-withdraw-btn">제안 취소</button>' : ""}
      </div>`
    : "";
  const control = !mapReady
    ? '<button type="button" class="quiet" disabled>다른 장소 제안하기</button><p class="hint" role="status">지도를 열 수 없어 장소를 선택할 수 없어요. 화면을 새로고침해 주세요.</p>'
    : picking
    ? '<div data-proposal-slot></div>'
    : `<button type="button" data-action="propose-start" class="quiet">다른 장소 제안하기</button>`;
  return `${summary}${control}`;
}

// The panel keeps its own DOM so typed text survives the screens' periodic re-render.
// The DOM is built on first use so importing this module never touches the document.
export function createProposalPanel({ onSubmit, onCancel, onBlur, searchPlaces, onSelectPoint }) {
  let parts = null;
  let point = null;
  let selectedPlace = null;
  const search = createProposalSearch(searchPlaces, () => renderSearch());

  function renderSearch() {
    if (!parts?.results) return;
    const state = search.state();
    parts.searchButton.disabled = state.busy;
    parts.searchButton.textContent = state.busy ? "검색 중…" : "검색";

    if (selectedPlace) {
      parts.results.innerHTML = `
        <div class="selected-place-card">
          <div class="selected-place-info">
            <span class="selected-place-badge">선택된 장소</span>
            <strong class="selected-place-title">📍 ${e(selectedPlace.label)}</strong>
            ${selectedPlace.address ? `<span class="selected-place-address">${e(selectedPlace.address)}</span>` : ""}
          </div>
          <button type="button" class="selected-place-change-btn" data-proposal-reopen>다른 장소 검색</button>
        </div>
      `;
      return;
    }

    parts.results.innerHTML = `${state.message ? `<p class="hint">${e(state.message)}</p>` : ""}${
      state.items.length
        ? `<ul class="place-results">${state.items
            .map(
              (place, index) =>
                `<li><button type="button" data-proposal-result="${index}" aria-pressed="${Boolean(
                  point &&
                    point.latitude === place.latitude &&
                    point.longitude === place.longitude &&
                    parts.input?.value === place.label,
                )}"><strong>${e(place.label)}</strong><span>${e(
                  place.address || "지도에서 위치를 확인해주세요",
                )}</span></button></li>`,
            )
            .join(
              "",
            )}</ul><div class="pager"><button type="button" data-proposal-page="${
            state.page - 1
          }" ${state.page === 1 || state.busy ? "disabled" : ""}>이전</button><span>${
            state.page
          } 페이지</span><button type="button" data-proposal-page="${state.page + 1}" ${
            !state.hasNext || state.busy ? "disabled" : ""
          }>다음</button></div>`
        : ""
    }`;
  }

  function build() {
    if (parts) return parts;
    const element = document.createElement("div");
    element.className = "proposal-panel";
    element.innerHTML = `${
      searchPlaces
        ? `<form data-proposal-search class="place-search-bar">
            <div class="search-input-wrap">
              <span class="search-input-icon">🔍</span>
              <input aria-label="만날 장소 검색" data-proposal-query class="search-input" maxlength="80" required placeholder="만날 장소나 주소 검색 (예: 의왕역)" autocomplete="off" />
            </div>
            <button type="submit" class="search-submit-btn" data-proposal-search-button>검색</button>
          </form>
          <div data-proposal-results aria-live="polite"></div>`
        : ""
    }
    <div class="proposal-memo-group">
      <label class="proposal-field-label" for="proposal-place-name">장소 이름 (필수)</label>
      <input id="proposal-place-name" required data-proposal-label class="proposal-detail-input" maxlength="${proposalLabelMax}" placeholder="예: 1번 출구 앞 택시 승강장" autocomplete="off" />
    </div>
    <div class="proposal-memo-group">
      <label class="proposal-field-label" for="proposal-memo">상세 위치 설명 (선택)</label>
      <input id="proposal-memo" data-proposal-memo class="proposal-detail-input" maxlength="${proposalLabelMax}" placeholder="예: 택시 승강장 옆" autocomplete="off" />
    </div>
    <p class="hint" data-proposal-hint></p>
    <p class="alert" role="alert" data-proposal-error hidden></p>
    <div class="button-pair">
      <button type="button" class="primary proposal-send-btn" data-proposal-send>이 장소로 변경 제안</button>
      <button type="button" class="quiet proposal-cancel-btn" data-proposal-close>닫기</button>
    </div>`;
    parts = {
      element,
      input: element.querySelector("[data-proposal-label]"),
      memo: element.querySelector("[data-proposal-memo]"),
      hint: element.querySelector("[data-proposal-hint]"),
      error: element.querySelector("[data-proposal-error]"),
      query: element.querySelector("[data-proposal-query]"),
      searchButton: element.querySelector("[data-proposal-search-button]"),
      results: element.querySelector("[data-proposal-results]"),
    };
    if (searchPlaces) {
      element.querySelector("[data-proposal-search]").addEventListener("submit", (event) => {
        event.preventDefault();
        selectedPlace = null;
        void search.find(parts.query.value);
      });
      parts.results.addEventListener("click", (event) => {
        const reopen = event.target.closest("[data-proposal-reopen]");
        if (reopen) {
          selectedPlace = null;
          renderSearch();
          return;
        }
        const result = event.target.closest("[data-proposal-result]");
        const page = event.target.closest("[data-proposal-page]");
        if (result) {
          const place = search.choose(Number(result.dataset.proposalResult));
          if (!place) return;
          if (onSelectPoint?.(place) === false) {
            showError("지도를 다시 연 뒤 장소를 선택해주세요.");
            return;
          }
          point = { latitude: place.latitude, longitude: place.longitude };
          selectedPlace = place;
          parts.input.value = place.label;
          showError("");
          refreshHint();
          renderSearch();
        } else if (page && !page.disabled) {
          void search.find(search.state().keyword, Number(page.dataset.proposalPage));
        }
      });
    }
    element.querySelector("[data-proposal-send]").addEventListener("click", async () => {
      const name = parts.input.value.trim();
      const memo = parts.memo.value.trim();
      const result = buildProposal(name && memo ? `${name} · ${memo}` : name, point);
      showError(result.error);
      if (result.place) {
        const sendBtn = element.querySelector("[data-proposal-send]");
        if (sendBtn) {
          sendBtn.disabled = true;
          sendBtn.textContent = "제안 보내는 중…";
        }
        try {
          await onSubmit(result.place);
        } finally {
          if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.textContent = "이 장소로 변경 제안";
          }
        }
      }
    });
    element.querySelector("[data-proposal-close]").addEventListener("click", () => onCancel());
    parts.input.addEventListener("input", () => showError(""));
    parts.memo.addEventListener("input", () => showError(""));
    element.addEventListener("focusout", () =>
      setTimeout(() => {
        if (!element.contains(document.activeElement)) onBlur?.();
      }, 0),
    );
    refreshHint();
    return parts;
  }
  function showError(text) {
    const { error } = build();
    error.textContent = text || "";
    error.hidden = !text;
  }
  function refreshHint() {
    parts.hint.textContent = point
      ? "지도의 핀을 터치해 원하는 위치로 조정할 수 있어요."
      : "장소를 검색해 고르거나 지도를 눌러 핀을 놓아주세요.";
  }

  return {
    attach(slot) {
      const { element } = build();
      if (slot && slot !== element) slot.replaceWith(element);
    },
    setPoint(next) {
      build();
      point = next;
      showError("");
      refreshHint();
    },
    hasFocus: () => Boolean(parts && parts.element.contains(document.activeElement)),
    reset() {
      point = null;
      selectedPlace = null;
      search.reset();
      if (!parts) return;
      if (parts.query) parts.query.value = "";
      parts.input.value = "";
      parts.memo.value = "";
      const sendBtn = parts.element?.querySelector("[data-proposal-send]");
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.textContent = "이 장소로 변경 제안";
      }
      showError("");
      refreshHint();
    },
  };
}


// Closing the panel invalidates pending searches; results never select or send themselves.
export function createProposalSearch(searchPlaces, onUpdate = () => {}) {
  let generation=0;
  let state={busy:false,items:[],page:1,hasNext:false,keyword:"",done:false,message:""};
  return {
    state:()=>state,
    choose:index=>!state.busy && Number.isInteger(index) ? state.items[index] ?? null : null,
    async find(query,page=1) {
      const keyword=String(query??"").trim();
      if (state.busy) return;
      if (!keyword || keyword.length>80 || !Number.isInteger(page) || page<1 || page>3) {
        state={...state,message:"장소명이나 주소를 80자 이내로 적어주세요."};onUpdate();return;
      }
      const current=++generation;
      state={busy:true,items:[],page,hasNext:false,keyword,done:false,message:""};onUpdate();
      try {
        const result=await searchPlaces(keyword,page);
        if (current!==generation) return;
        state={...state,items:result.items,hasNext:result.hasNext,done:true,
          message:result.partial ? "일부 결과를 불러오지 못했어요. 이름과 주소를 확인해주세요." : result.items.length ? "" : "검색 결과가 없어요. 지역 이름을 더 적거나 지도에서 골라주세요."};
      } catch {
        if (current!==generation) return;
        state={...state,message:"검색을 완료하지 못했어요. 다시 검색하거나 지도에서 골라주세요."};
      } finally {
        if (current===generation) {state={...state,busy:false};onUpdate();}
      }
    },
    reset(){generation++;state={busy:false,items:[],page:1,hasNext:false,keyword:"",done:false,message:""};onUpdate();},
  };
}
