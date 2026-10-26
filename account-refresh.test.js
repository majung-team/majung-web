import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as model from "./model.js";
import * as push from "./push.js";
import { AccountError } from "./account-api.js";

// Execute the real account entry point with an isolated DOM shell and controlled API clock.
async function screen() {
  let now = 0, seconds = 420, fail = false, authenticated = true, trackingReads = 0;
  const timers = [], events = {};
  const root = { innerHTML: "", setAttribute() {}, addEventListener() {}, contains: () => false, querySelector: () => null };
  const api = async path => {
    if (fail) throw new Error("test network outage");
    if (path === "/auth/session") return { authenticated, member: { nickname: "시험 탑승자", majungId: "test", profileReady: true } };
    if (path === "/connections" || path.startsWith("/connections?")) return [];
    if (path === "/vehicle-links") return [];
    if (path === "/ride-requests") return { requests: [{ requestId: "test-ride", status: "ACTIVE", nickname: "시험 운전자", majungId: "driver", place: { label: "시험 장소" } }] };
    if (path.endsWith("/tracking")) {
      trackingReads++;
      return { pickup: { status: "ACTIVE", participant: { readiness: "READY" } }, vehicle: { freshness: "FRESH", durationSeconds: seconds, latitude: 37, longitude: 127, ageMillis: 0, validForMillis: 30000 } };
    }
    throw new Error(`Unexpected test route ${path}`);
  };
  const context = vm.createContext({
    ...model, ...push, e: model.escapeHtml, AccountError, createAccountClient: () => api,
    document: { querySelector: () => root, hidden: false, activeElement: null, addEventListener: (name, callback) => { events[name] = callback; } },
    window: { addEventListener() {} }, location: { href: "https://test.invalid/account", hash: "", search: "", pathname: "/account" },
    history: { replaceState() {} }, sessionStorage: { getItem: () => null, removeItem() {} },
    performance: { now: () => now }, URL, AbortSignal, fetch: async () => ({ ok: true, json: async () => ({}) }),
    setInterval: callback => timers.push(callback), CSS: { escape: value => value },
  });
  const source = (await readFile(new URL("./account.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
  vm.runInContext(source, context);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle();
  return {
    root, context, events,
    reads: () => trackingReads,
    seconds: value => { seconds = value; },
    failure: value => { fail = value; },
    authenticated: value => { authenticated = value; },
    tick: async time => { now = time; timers[0](); await settle(); },
  };
}

test("계정 픽업은 3초 후 새 ETA를 반영하고 통신 실패 시 숨겼다가 복구", async () => {
  const app = await screen();
  assert.match(app.root.innerHTML, /약 7분/);
  await app.tick(1000);
  const reads = app.reads();
  app.seconds(720);
  await app.tick(3999);
  assert.equal(app.reads(), reads);
  await app.tick(4000);
  assert.match(app.root.innerHTML, /약 12분/);
  app.failure(true);
  await app.tick(7000);
  assert.doesNotMatch(app.root.innerHTML, /data-ride-eta/);
  assert.match(app.root.innerHTML, /상태를 새로 확인하지 못했어요/);
  app.failure(false); app.seconds(180);
  await app.tick(10000);
  assert.match(app.root.innerHTML, /약 3분/);
  assert.doesNotMatch(app.root.innerHTML, /상태를 새로 확인하지 못했어요/);
  app.authenticated(false);
  await app.tick(13000);
  assert.doesNotMatch(app.root.innerHTML, /data-ride-eta/);
});

test("숨긴 화면에서는 조회하지 않고 다시 열면 새로 확인", async () => {
  const app = await screen();
  await app.tick(1000);
  const reads = app.reads();
  app.context.document.hidden = true;
  await app.tick(6000);
  assert.equal(app.reads(), reads);
  app.context.document.hidden = false;
  app.events.visibilitychange();
  await app.tick(6100);
  assert.equal(app.reads(), reads + 1);
});

test("직접 새로 확인에 실패해도 이전 위치와 ETA를 숨김", async () => {
  const app = await screen();
  assert.match(app.root.innerHTML, /data-ride-eta/);
  app.failure(true);
  await vm.runInContext("run(refresh)", app.context);
  assert.doesNotMatch(app.root.innerHTML, /data-ride-eta/);
});
