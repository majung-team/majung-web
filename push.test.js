import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  browserPushEnvironment,
  pushState,
  pushCard,
  pushErrorText,
  applicationServerKey,
  pushFlag,
  setPushFlag,
} from "./push.js";
import { createAccountClient } from "./account-api.js";

const ready = { publicKey: "key", supported: true, ios: false, standalone: false, permission: "default", subscribed: false };

test("서버에 키가 없으면 알림 카드를 숨김", () => {
  assert.equal(pushState({ ...ready, publicKey: null }), "hidden");
  assert.equal(pushCard("hidden"), "");
});

test("브라우저 지원·권한·구독에 따라 상태를 고름", () => {
  assert.equal(pushState(ready), "off");
  assert.equal(pushState({ ...ready, subscribed: true }), "on");
  assert.equal(pushState({ ...ready, permission: "denied" }), "blocked");
  assert.equal(pushState({ ...ready, supported: false }), "unsupported");
  // iPhone only gets web push from an app added to the home screen.
  assert.equal(pushState({ ...ready, supported: false, ios: true }), "ios-install");
  assert.equal(pushState({ ...ready, supported: false, ios: true, standalone: true }), "unsupported");
});

test("iPhone 브라우저 탭과 홈 화면 앱, 데스크톱을 구분", () => {
  const tab = browserPushEnvironment({}, { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", standalone: false });
  assert.deepEqual([tab.supported, tab.ios, tab.standalone], [false, true, false]);
  const installed = browserPushEnvironment(
    { PushManager: {}, Notification: { permission: "granted" }, matchMedia: () => ({ matches: true }) },
    { userAgent: "iPhone", serviceWorker: {}, standalone: true },
  );
  assert.deepEqual([installed.supported, installed.ios, installed.standalone, installed.permission], [true, true, true, "granted"]);
  const desktop = browserPushEnvironment(
    { PushManager: {}, Notification: { permission: "default" }, matchMedia: () => ({ matches: false }) },
    { userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 0, serviceWorker: {} },
  );
  assert.deepEqual([desktop.supported, desktop.ios, desktop.standalone], [true, false, false]);
});

test("카드는 상태에 맞는 버튼만 보여주고 속성을 이스케이프", () => {
  assert.match(pushCard("off", { attributes: 'data-id="a"' }), /data-action="push-on" data-id="a"/);
  assert.match(pushCard("on"), /data-action="push-off"/);
  for (const state of ["blocked", "ios-install", "unsupported"]) assert.doesNotMatch(pushCard(state), /<button/);
  assert.match(pushCard("off", { busy: true }), /disabled/);
  assert.doesNotMatch(pushCard("off", { message: "<img onerror=x>" }), /<img/);
  assert.match(pushCard("off", { message: "실패" }), /role="alert"/);
  // The card must not promise delivery it cannot guarantee.
  assert.doesNotMatch(pushCard("off"), /반드시|보장/);
});

test("오류 코드를 사용자 문구로 바꿈", () => {
  assert.match(pushErrorText({ code: "denied" }), /권한/);
  assert.match(pushErrorText({ code: "PUSH_DISABLED" }), /사용할 수 없어요/);
  assert.match(pushErrorText({ code: "INVALID_PUSH_ENDPOINT" }), /주소/);
  assert.match(pushErrorText(new Error("network")), /다시 시도/);
});

test("공개 키 문자열을 구독용 65바이트 점으로 바꿈", () => {
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
  const decoded = applicationServerKey(point.toString("base64url"));
  assert.ok(decoded instanceof Uint8Array);
  assert.equal(decoded.length, 65);
  assert.deepEqual(Buffer.from(decoded), point);
});

test("저장소가 없어도 구독 표시는 실패하지 않고 꺼진 상태", () => {
  assert.equal(pushFlag("request-1"), false);
  assert.doesNotThrow(() => setPushFlag("request-1", true));
});

test("계정 클라이언트는 도착 알림 경로만 새로 허용하고 CSRF를 요구", async () => {
  const calls = [];
  const client = createAccountClient(async (path, options) => {
    calls.push({ path, options });
    return new Response(JSON.stringify(path.endsWith("/session") ? { csrfToken: "fixture-csrf" } : { subscribed: true }), { status: 200 });
  });
  const id = "12345678-1234-1234-1234-123456789abc";
  await assert.rejects(client(`/ride-requests/${id}/arrival-push`, { method: "PUT", body: { endpoint: "x" } }), (error) => error.code === "CSRF_REQUIRED");
  await client("/auth/session");
  const result = await client(`/ride-requests/${id}/arrival-push`, { method: "PUT", body: { endpoint: "https://fcm.googleapis.com/x" } });
  assert.equal(result.subscribed, true);
  assert.equal(calls.at(-1).options.headers["X-CSRF-TOKEN"], "fixture-csrf");
  await client(`/ride-requests/${id}/arrival-push`, { method: "DELETE" });
  await assert.rejects(client(`/ride-requests/${id}/other`, { method: "PUT" }), /Unknown account endpoint/);
});

function loadServiceWorker() {
  const handlers = {};
  const shown = [];
  const opened = [];
  const closed = [];
  const self = {
    addEventListener: (name, handler) => (handlers[name] = handler),
    registration: { showNotification: (title, options) => (shown.push({ title, options }), Promise.resolve()) },
    clients: { matchAll: async () => self.windows, openWindow: async (url) => opened.push(url) },
    windows: [],
  };
  vm.runInNewContext(readFileSync(new URL("./sw.js", import.meta.url), "utf8"), { self });
  const run = (name, event) => {
    let pending;
    handlers[name]({ ...event, waitUntil: (promise) => (pending = promise) });
    return pending;
  };
  return { self, shown, opened, closed, run };
}

test("서비스 워커는 내용 없는 푸시에 고정 문구 알림을 띄움", async () => {
  const worker = loadServiceWorker();
  await worker.run("push", { data: null });
  assert.equal(worker.shown.length, 1);
  assert.equal(worker.shown[0].title, "마중");
  assert.match(worker.shown[0].options.body, /3분/);
  assert.equal(worker.shown[0].options.tag, "majung-arrival");
});

test("알림을 누르면 열려 있는 창으로 가고 없으면 내 연결 화면을 연다", async () => {
  const worker = loadServiceWorker();
  let focused = 0;
  worker.self.windows = [{ focus: () => (focused++, Promise.resolve()) }];
  await worker.run("notificationclick", { notification: { close: () => worker.closed.push(1) } });
  assert.equal(focused, 1);
  assert.equal(worker.closed.length, 1);
  worker.self.windows = [];
  await worker.run("notificationclick", { notification: { close: () => {} } });
  assert.deepEqual(worker.opened, ["/account"]);
});
