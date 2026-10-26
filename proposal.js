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

// The picker needs the map; without it the whole block stays hidden.
export function proposalBlock({ proposal, picking, mapReady, status }) {
  if (!mapReady || status !== "ACTIVE") return "";
  const summary = proposal
    ? `<div class="proposal"><span>${proposal.proposedBy === "DRIVER" ? "운전자가 제안한 장소" : "내가 제안한 장소"}</span>
      <strong>${e(proposal.place.label)}</strong>
      <small>${proposal.proposedBy === "DRIVER" ? "마음에 들지 않으면 다른 장소를 제안할 수 있어요. " : ""}운전자가 확인할 때까지 약속 장소는 그대로예요.</small>
      ${proposal.proposedBy === "PASSENGER" ? '<button type="button" data-action="propose-withdraw" class="quiet">제안 취소</button>' : ""}</div>`
    : "";
  const control = picking
    ? '<div data-proposal-slot></div>'
    : `<button type="button" data-action="propose-start" class="quiet">다른 장소 제안하기</button>`;
  return `${summary}${control}`;
}

// The panel keeps its own DOM so typed text survives the screens' periodic re-render.
// The DOM is built on first use so importing this module never touches the document.
export function createProposalPanel({ onSubmit, onCancel, onBlur, searchPlaces, onSelectPoint }) {
  let parts = null;
  let point = null;
  const search = createProposalSearch(searchPlaces, () => renderSearch());

  function renderSearch() {
    if (!parts?.results) return;
    const state=search.state();
    parts.searchButton.disabled=state.busy;
    parts.searchButton.textContent=state.busy ? "찾는 중…" : "장소 찾기";
    parts.results.innerHTML=`${state.message ? `<p class="hint">${e(state.message)}</p>` : ""}${state.done ? `<p class="hint">‘${e(state.keyword)}’ 검색 결과 · 이름과 주소를 확인해주세요.</p>` : ""}${state.items.length ? `<ul class="place-results">${state.items.map((place,index)=>`<li><button type="button" data-proposal-result="${index}"><strong>${e(place.label)}</strong><span>${e(place.address || "지도에서 위치를 확인해주세요")}</span></button></li>`).join("")}</ul><div class="pager"><button type="button" data-proposal-page="${state.page-1}" ${state.page===1 || state.busy ? "disabled" : ""}>이전 결과</button><span>${state.page} 페이지</span><button type="button" data-proposal-page="${state.page+1}" ${!state.hasNext || state.busy ? "disabled" : ""}>다음 결과</button></div>` : ""}`;
  }

  function build() {
    if (parts) return parts;
    const element = document.createElement("div");
    element.className = "proposal-panel";
    element.innerHTML = `${searchPlaces ? `<form data-proposal-search class="place-search-form"><label>새 장소 검색<input data-proposal-query maxlength="80" required placeholder="장소명 또는 주소" autocomplete="off" /></label><button class="primary" data-proposal-search-button>장소 찾기</button></form><p class="hint">검색어는 카카오에 전달돼요. 결과를 고른 뒤 핀 위치를 확인해주세요.</p><div data-proposal-results aria-live="polite"></div>` : ""}<p class="hint" data-proposal-hint></p>
    <label>장소 설명<input data-proposal-label maxlength="${proposalLabelMax}" placeholder="예: 정문 앞" autocomplete="off" /></label>
    <p class="alert" role="alert" data-proposal-error hidden></p>
    <div class="button-pair"><button type="button" class="primary" data-proposal-send>제안 보내기</button><button type="button" class="quiet" data-proposal-close>닫기</button></div>`;
    parts = {
      element,
      input: element.querySelector("[data-proposal-label]"),
      hint: element.querySelector("[data-proposal-hint]"),
      error: element.querySelector("[data-proposal-error]"),
      query: element.querySelector("[data-proposal-query]"),
      searchButton: element.querySelector("[data-proposal-search-button]"),
      results: element.querySelector("[data-proposal-results]"),
    };
    if (searchPlaces) {
      element.querySelector("[data-proposal-search]").addEventListener("submit", event => {
        event.preventDefault(); void search.find(parts.query.value);
      });
      parts.results.addEventListener("click", event => {
        const result=event.target.closest("[data-proposal-result]");
        const page=event.target.closest("[data-proposal-page]");
        if (result) {
          const place=search.choose(Number(result.dataset.proposalResult));
          if (!place) return;
          if (onSelectPoint?.(place)===false) { showError("지도를 다시 연 뒤 장소를 선택해주세요."); return; }
          point={latitude:place.latitude,longitude:place.longitude};
          parts.input.value=place.label;showError("");refreshHint();
        } else if (page && !page.disabled) void search.find(search.state().keyword,Number(page.dataset.proposalPage));
      });
    }
    element.querySelector("[data-proposal-send]").addEventListener("click", () => {
      const result = buildProposal(parts.input.value, point);
      showError(result.error);
      if (result.place) onSubmit(result.place);
    });
    element.querySelector("[data-proposal-close]").addEventListener("click", () => onCancel());
    parts.input.addEventListener("input", () => showError(""));
    element.addEventListener("focusout", () =>
      setTimeout(() => { if (!element.contains(document.activeElement)) onBlur?.(); }, 0));
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
      ? "핀을 놓았어요. 다른 곳을 누르면 옮길 수 있어요."
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
      search.reset();
      if (!parts) return;
      if (parts.query) parts.query.value="";
      parts.input.value = "";
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
