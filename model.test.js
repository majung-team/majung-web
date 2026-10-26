import test from "node:test";
import assert from "node:assert/strict";
import {
  parseInvitation,
  validSession,
  invitationUrl,
  vehicleDeadline,
  visibleVehicle,
  nextSequence,
  escapeHtml,
} from "./model.js";
const id = "12345678-1234-1234-1234-123456789abc";
const token = "x".repeat(43);
const vehicle = {
  freshness: "FRESH",
  latitude: 37,
  longitude: 127,
  durationSeconds: 120,
  validForMillis: 30000,
};
test("초대는 fragment의 UUID와 43자리 토큰만 허용", () => {
  assert.deepEqual(parseInvitation(`#join/${id}/${token}`), {
    pickupId: id,
    inviteToken: token,
  });
  for (const hash of [
    `#join/${id}/short`,
    `#join/../${token}`,
    `#join/${id}/${token}/extra`,
    "#main",
  ])
    assert.equal(parseInvitation(hash), null);
  assert.equal(
    new URL(invitationUrl("https://example.test", id, token)).search,
    "",
  );
});
test("탑승자 세션은 참여자 ID까지 있어야 복원", () => {
  assert.equal(validSession({ role: "driver", pickupId: id, token }), true);
  assert.equal(validSession({ role: "guest", pickupId: id, token }), false);
  assert.equal(
    validSession({ role: "guest", pickupId: id, token, participantId: id }),
    true,
  );
  assert.equal(validSession({ role: "admin", pickupId: id, token }), false);
});
test("정보 유효 시간은 서버 잔여 시간에서 왕복 시간을 차감", () => {
  assert.equal(vehicleDeadline(vehicle, 100, 500), 30100);
  assert.equal(
    vehicleDeadline({ ...vehicle, validForMillis: 50 }, 100, 500),
    500,
  );
  assert.equal(
    vehicleDeadline({ ...vehicle, freshness: "STALE" }, 100, 500),
    0,
  );
  assert.equal(
    vehicleDeadline({ ...vehicle, validForMillis: undefined }, 100, 500),
    0,
  );
});
test("승인 전·연결 끊김·만료·종료 때 이전 위치를 노출하지 않음", () => {
  assert.equal(visibleVehicle(vehicle, 1000, 999, true, "ACTIVE"), vehicle);
  for (const args of [
    [1000, 1000, true, "ACTIVE"],
    [1000, 900, false, "ACTIVE"],
    [1000, 900, true, "WAITING_APPROVAL"],
    [1000, 900, true, "COMPLETED"],
  ])
    assert.equal(visibleVehicle(vehicle, ...args), null);
  assert.equal(
    visibleVehicle({ ...vehicle, latitude: null }, 1000, 900, true, "ACTIVE"),
    null,
  );
});
test("준비 상태 순서와 사용자 입력 이스케이프", () => {
  assert.equal(nextSequence({ participant: { readinessSequence: 4 } }), 5);
  assert.equal(
    escapeHtml('<img onerror="x">&'),
    "&lt;img onerror=&quot;x&quot;&gt;&amp;",
  );
});

import { parseHostInvitation } from "./model.js";
test("운전자 공유 주소와 탑승자 참여 주소는 구분한다", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const token = "A".repeat(43);
  assert.equal(parseInvitation(`#share/${id}/${token}`), null);
  assert.equal(parseHostInvitation(`#join/${id}/${token}`), null);
  assert.deepEqual(parseHostInvitation(`#share/${id}/${token}`), {pickupId: id, inviteToken: token});
  assert.equal(parseHostInvitation(`#share/${id}/short`), null);
});

import {
  vehicleTiming,
  vehicleView,
  etaText,
  ageText,
} from "./model.js";
test("차량 정보 경과 시간은 서버 값에 왕복 시간을 더함", () => {
  assert.deepEqual(vehicleTiming({ ageMillis: 1000 }, 100, 400), {
    ageMillis: 1300,
    at: 400,
  });
  assert.equal(vehicleTiming({ ageMillis: null }, 100, 400), null);
  assert.equal(vehicleTiming({}, 100, 400), null);
});
test("30초가 지나면 흐린 위치와 카운트다운, 2분이 지나면 위치 확인 중", () => {
  const timing = { ageMillis: 0, at: 0 };
  const fresh = vehicleView(vehicle, timing, 30000, 10000, true, "ACTIVE");
  assert.equal(fresh.kind, "fresh");
  assert.equal(fresh.remainingSeconds, 110);
  const stale = { ...vehicle, freshness: "STALE", validForMillis: 0 };
  const dimmed = vehicleView(stale, { ageMillis: 31000, at: 0 }, 0, 4000, true, "ACTIVE");
  assert.equal(dimmed.kind, "stale");
  assert.equal(dimmed.remainingSeconds, 85);
  assert.equal(ageText(dimmed.ageMillis), "35초 전");
  // A FRESH response whose local deadline passed is shown as stale, not hidden.
  assert.equal(vehicleView(vehicle, timing, 30000, 30000, true, "ACTIVE").kind, "stale");
  const late = vehicleView(stale, { ageMillis: 119000, at: 0 }, 0, 1000, true, "ACTIVE");
  assert.deepEqual(late, { kind: "lost", ageMillis: 120000 });
  assert.equal(ageText(late.ageMillis), "2분 전");
  const withheld = { ...stale, latitude: null, longitude: null, durationSeconds: null };
  assert.equal(vehicleView(withheld, { ageMillis: 125000, at: 0 }, 0, 0, true, "ACTIVE").kind, "lost");
});
test("카운트다운이 0이 되면 도착이 아니라 곧 도착", () => {
  const stale = { ...vehicle, freshness: "STALE", durationSeconds: 40 };
  const view = vehicleView(stale, { ageMillis: 45000, at: 0 }, 0, 0, true, "ACTIVE");
  assert.equal(view.remainingSeconds, 0);
  assert.equal(etaText(view), "곧 도착");
  assert.equal(etaText({ remainingSeconds: 61 }), "약 2분");
});
test("정보 없음·연결 끊김·종료 때는 끊김 표시도 하지 않음", () => {
  const timing = { ageMillis: 0, at: 0 };
  assert.equal(vehicleView({ freshness: "WAITING" }, timing, 0, 0, true, "ACTIVE"), null);
  assert.equal(vehicleView(vehicle, timing, 30000, 0, false, "ACTIVE"), null);
  assert.equal(vehicleView(vehicle, timing, 30000, 0, true, "COMPLETED"), null);
  assert.equal(vehicleView(vehicle, null, 30000, 0, true, "ACTIVE"), null);
});
