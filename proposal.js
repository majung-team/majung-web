import { escapeHtml as e } from "./model.js";

// A proposal never changes the confirmed place; the driver decides on the car.
export const proposalLabelMax = 120;

export function buildProposal(label, point) {
  const text = String(label ?? "").trim();
  if (!Number.isFinite(point?.latitude) || !Number.isFinite(point?.longitude)) {
    return { error: "지도에서 만나고 싶은 곳을 눌러 핀을 놓아주세요." };
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
export function createProposalPanel({ onSubmit, onCancel, onBlur }) {
  let parts = null;
  let point = null;

  function build() {
    if (parts) return parts;
    const element = document.createElement("div");
    element.className = "proposal-panel";
    element.innerHTML = `<p class="hint" data-proposal-hint></p>
    <label>장소 설명<input data-proposal-label maxlength="${proposalLabelMax}" placeholder="예: 정문 앞" autocomplete="off" /></label>
    <p class="alert" role="alert" data-proposal-error hidden></p>
    <div class="button-pair"><button type="button" class="primary" data-proposal-send>제안 보내기</button><button type="button" class="quiet" data-proposal-close>닫기</button></div>`;
    parts = {
      element,
      input: element.querySelector("[data-proposal-label]"),
      hint: element.querySelector("[data-proposal-hint]"),
      error: element.querySelector("[data-proposal-error]"),
    };
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
      : "지도에서 만나고 싶은 곳을 눌러 핀을 놓아주세요.";
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
      if (!parts) return;
      parts.input.value = "";
      showError("");
      refreshHint();
    },
  };
}
