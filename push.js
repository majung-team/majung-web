import { escapeHtml as e } from "./model.js";

export class PushError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function browserPushEnvironment(
  win = globalThis.window,
  nav = globalThis.navigator,
) {
  const ios =
    /iP(hone|ad|od)/.test(nav?.userAgent || "") ||
    (nav?.platform === "MacIntel" && nav?.maxTouchPoints > 1);
  return {
    supported: Boolean(
      nav && "serviceWorker" in nav && win && "PushManager" in win && "Notification" in win,
    ),
    ios,
    standalone: nav?.standalone === true || Boolean(win?.matchMedia?.("(display-mode: standalone)").matches),
    permission: win && "Notification" in win ? win.Notification.permission : "denied",
  };
}

export function pushState({ publicKey, supported, ios, standalone, permission, subscribed }) {
  if (!publicKey) return "hidden";
  if (!supported) return ios && !standalone ? "ios-install" : "unsupported";
  if (permission === "denied") return "blocked";
  return subscribed ? "on" : "off";
}

const texts = {
  off: "차량이 약 3분 안에 도착하면 알려드려요. 화면을 닫아도 받을 수 있어요.",
  on: "도착 약 3분 전에 알림을 보낼게요. 알림은 한 번만 보내요.",
  blocked: "알림이 차단되어 있어요. 브라우저 설정에서 허용한 뒤 다시 시도해주세요.",
  "ios-install": "iPhone은 홈 화면에 추가한 앱에서만 알림을 받을 수 있어요. 공유 버튼에서 ‘홈 화면에 추가’한 뒤, 그 앱에서 로그인해 알림을 허용해주세요.",
  unsupported: "이 브라우저는 도착 알림을 지원하지 않아요. 이 화면을 열어 두면 안에서 확인할 수 있어요.",
};

export function pushCard(state, { busy = false, message = "", attributes = "" } = {}) {
  if (state === "hidden") return "";
  const action = state === "off" ? "push-on" : state === "on" ? "push-off" : null;
  const label = state === "off" ? "도착 알림 받기" : "알림 끄기";
  return `<div class="push-card"><strong>도착 3분 전 알림</strong><p class="hint">${e(texts[state])}</p>${
    message ? `<p class="hint" role="alert">${e(message)}</p>` : ""
  }${
    action
      ? `<button type="button" data-action="${action}" ${attributes} class="${state === "off" ? "primary" : "quiet"}" ${busy ? "disabled" : ""}>${busy ? "처리하고 있어요…" : label}</button>`
      : ""
  }</div>`;
}

export function pushErrorText(error) {
  if (error?.code === "denied") return "알림 권한이 허용되지 않았어요.";
  if (error?.code === "PUSH_DISABLED") return "지금은 도착 알림을 사용할 수 없어요.";
  if (error?.code === "INVALID_PUSH_ENDPOINT") return "이 브라우저의 알림 주소를 사용할 수 없어요.";
  return "알림 설정을 바꾸지 못했어요. 잠시 후 다시 시도해주세요.";
}

export function applicationServerKey(publicKey) {
  const base64 = publicKey.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function sameKey(subscription, key) {
  const current = subscription.options?.applicationServerKey;
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === key.length && bytes.every((value, index) => value === key[index]);
}

/** Asks for permission (must run from a click) and returns the browser's push address. */
export async function enableArrivalPush(publicKey) {
  if ((await Notification.requestPermission()) !== "granted") throw new PushError("denied");
  const key = applicationServerKey(publicKey);
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  // An address made for another server key can never receive our pushes.
  if (subscription && !sameKey(subscription, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  return subscription.endpoint;
}

export async function disableBrowserPush() {
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    await (await registration?.pushManager.getSubscription())?.unsubscribe();
  } catch {
    /* The server-side subscription is already removed; a leftover browser subscription is harmless. */
  }
}

const flagKey = (id) => `majung.push.${id}`;

export function pushFlag(id) {
  try {
    return sessionStorage.getItem(flagKey(id)) === "1";
  } catch {
    return false;
  }
}

export function setPushFlag(id, on) {
  try {
    if (on) sessionStorage.setItem(flagKey(id), "1");
    else sessionStorage.removeItem(flagKey(id));
  } catch {
    /* Without storage the button simply shows its initial state after a reload. */
  }
}
