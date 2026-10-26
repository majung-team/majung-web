import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as model from "./model.js";
import * as push from "./push.js";
import * as maps from "./map.js";
import * as proposal from "./proposal.js";
import { AccountError } from "./account-api.js";

// Execute the real account entry point with an isolated DOM shell and controlled API clock.
async function screen() {
  let now = 0, seconds = 420, fail = false, authenticated = true, trackingReads = 0;
  let readinessSequence = 1, readinessReceivedSequence = 0, placeProposal = null;
  const timers = [], events = {}, rootEvents = {}, writes = [];
  let streamCallbacks=null, streamClosed=false;
  const root = { innerHTML: "", setAttribute() {}, addEventListener(name, callback) { rootEvents[name] = callback; }, contains: () => false, querySelector: () => null };
  const api = async (path, options = {}) => {
    if (path === "/ride-requests" && options.method === "POST") { writes.push(options.body); return {}; }
    if (fail) throw new Error("test network outage");
    if (path === "/auth/session") return { authenticated, member: { nickname: "시험 탑승자", majungId: "test", profileReady: true } };
    if (path === "/connections" || path.startsWith("/connections?")) return [];
    if (path === "/vehicle-links") return [];
    if (path === "/ride-requests") return { requests: [{ requestId: "test-ride", status: "ACTIVE", nickname: "시험 운전자", majungId: "driver", place: { label: "시험 장소" } }] };
    if (path.endsWith("/tracking")) {
      trackingReads++;
      return { pickup: { status: "ACTIVE", placeProposal, participant: { readiness: "READY", readinessSequence, readinessReceivedSequence } }, vehicle: { freshness: "FRESH", durationSeconds: seconds, latitude: 37, longitude: 127, ageMillis: 0, validForMillis: 30000 } };
    }
    throw new Error(`Unexpected test route ${path}`);
  };
  const context = vm.createContext({
    openPickupStream: callbacks => { streamCallbacks=callbacks; return {close(){streamClosed=true;callbacks.onState(false);}}; },
    ...model, ...push, ...maps, ...proposal, e: model.escapeHtml, AccountError, createAccountClient: () => api,
    document: { querySelector: () => root, hidden: false, activeElement: null, addEventListener: (name, callback) => { events[name] = callback; }, createElement: () => ({ innerHTML: "", setAttribute(){}, remove(){}, addEventListener() {}, contains: () => false, querySelector: () => ({ addEventListener() {}, hidden: false, value: "", textContent: "" }) }) },
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
    root, context, events, rootEvents, writes,
    stream: () => streamCallbacks, closed: () => streamClosed,
    reads: () => trackingReads,
    proposal: value => { placeProposal = value; },
    receipt: (sequence, received) => { readinessSequence = sequence; readinessReceivedSequence = received; },
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

test("계정 화면은 차량 수신 후 전달 완료로 바꾸고 새 선택은 다시 대기", async () => {
  const app = await screen();
  assert.match(app.root.innerHTML, /차량 앱으로 전달을 기다리고/);
  await app.tick(1000);
  app.receipt(1, 1);
  await app.tick(4000);
  assert.match(app.root.innerHTML, /차량 앱에 전달됐어요/);
  app.receipt(2, 1);
  await app.tick(7000);
  assert.doesNotMatch(app.root.innerHTML, /차량 앱에 전달됐어요/);
  assert.match(app.root.innerHTML, /차량 앱으로 전달을 기다리고/);
});

test("지도에서 명시적으로 고른 지점만 장소 설명과 함께 요청", async () => {
  const app = await screen();
  vm.runInContext('rideTarget={memberId:"driver"}; rideLabel="시험 정문"; rideRequestId="test-request";', app.context);
  app.rootEvents.submit({preventDefault(){}, target:{id:"ride-form"}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.writes.length,0); // Merely opening the form is not a location selection.
  vm.runInContext('ridePlace={latitude:37.3,longitude:127.3,source:"map",at:0};', app.context);
  app.rootEvents.submit({preventDefault(){}, target:{id:"ride-form"}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.writes.length,1);
  assert.deepEqual({...app.writes[0].place},{label:"시험 정문",latitude:37.3,longitude:127.3});
});

test("오래된 GPS 선택은 지도 핀과 달리 다시 선택해야 요청 가능", async () => {
  const app = await screen();
  vm.runInContext('rideTarget={memberId:"driver"}; rideLabel="시험 정문"; ridePlace={latitude:37.3,longitude:127.3,source:"gps",at:0};', app.context);
  app.rootEvents.submit({preventDefault(){}, target:{id:"ride-form"}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.writes.length,0);
  assert.match(app.root.innerHTML,/현재 위치를 다시 선택/);
});

test("장소 검색 후 폼을 닫으면 늦은 결과가 다음 요청에 섞이지 않음", async () => {
  const app = await screen();
  let finish;
  app.context.createPlacePicker=()=>({attach(){},destroy(){}});
  app.context.searchPickupPlaces=()=>new Promise(resolve=>{finish=resolve;});
  vm.runInContext('placeMaps={services:{Places:class {},Geocoder:class {}}}; rideTarget={memberId:"driver"}; rideRequestId="old-request"; placeKeyword="시험";',app.context);
  const pending=vm.runInContext('searchPlaces()',app.context);
  vm.runInContext('rideTarget=null; clearPlacePicker(); rideTarget={memberId:"other-driver"}; rideRequestId="new-request";',app.context);
  finish({items:[{label:"이전 요청 결과",latitude:37.3,longitude:127.3}],hasNext:false,partial:false});
  await pending;
  assert.equal(vm.runInContext('placeCandidates.length',app.context),0);
  assert.equal(vm.runInContext('placeSearchBusy',app.context),false);
});

test("검색 결과 선택은 이름·좌표만 장소에 적용하고 전송은 별도 확인", async () => {
  const app = await screen();
  vm.runInContext('rideTarget={memberId:"driver"}; placeCandidates=[{label:"시험 정문",address:"시험 주소",latitude:37.3,longitude:127.3,id:"provider-only"}];',app.context);
  app.rootEvents.click({target:{closest:()=>({dataset:{action:"place-select",index:"0"}})}});
  assert.equal(app.writes.length,0);
  assert.equal(vm.runInContext('rideLabel',app.context),'시험 정문');
  assert.equal(vm.runInContext('ridePlace.source',app.context),'search');
  assert.equal(vm.runInContext('ridePlace.latitude',app.context),37.3);
  assert.equal(vm.runInContext('ridePlace.id',app.context),undefined);
});

test("통합 계정 화면은 준비 상태 수신 확인과 별도 제안을 함께 표시", async () => {
  const app = await screen();
  app.proposal({proposedBy:"PASSENGER",place:{label:"시험 제안 장소",latitude:37.3,longitude:127.3}});
  app.receipt(1,1);
  vm.runInContext('pickupMap={attach(){},update(){},startPicking(){},stopPicking(){}};',app.context);
  await app.tick(1000);
  assert.match(app.root.innerHTML,/차량 앱에 전달됐어요/);
  assert.match(app.root.innerHTML,/내가 제안한 장소/);
  assert.match(app.root.innerHTML,/시험 제안 장소/);
  assert.match(app.root.innerHTML,/운전자가 확인할 때까지 약속 장소는 그대로/);
});

test("SSE 연결 중에는 변경 신호로 조회하고 끊기면 3초 조회로 복귀",async()=>{
  const app=await screen();
  app.stream().onState(true);
  await app.tick(1000);
  const reads=app.reads();
  app.seconds(600);
  await app.tick(5000);
  assert.equal(app.reads(),reads);
  app.stream().onChange();
  await app.tick(5100);
  assert.match(app.root.innerHTML,/약 10분/);
  app.stream().onFallback();
  app.seconds(180); await app.tick(5200);
  assert.match(app.root.innerHTML,/약 3분/);
  app.context.document.hidden=true;app.events.visibilitychange();
  assert.equal(app.closed(),true);
});

test("픽업·사람 찾기·내 정보를 나누고 요청을 열면 픽업으로 이동",async()=>{
  const app=await screen();
  const click=action=>app.rootEvents.click({target:{closest:()=>({dataset:{action},disabled:false})}});
  assert.match(app.root.innerHTML,/data-ride-eta/);
  assert.doesNotMatch(app.root.innerHTML,/id="nickname-form"/);
  click("tab-people");
  assert.match(app.root.innerHTML,/id="search-form"/);
  assert.doesNotMatch(app.root.innerHTML,/data-ride-eta/);
  click("tab-settings");
  assert.match(app.root.innerHTML,/id="nickname-form"/);
  assert.match(app.root.innerHTML,/내 차량/);
  click("tab-pickup");
  assert.match(app.root.innerHTML,/data-ride-eta/);
});
