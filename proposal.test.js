import test from "node:test";
import assert from "node:assert/strict";
import { buildProposal, proposalBlock } from "./proposal.js";
import { createAccountClient } from "./account-api.js";

test("핀과 설명이 모두 있어야 제안을 만들고 설명은 공백을 정리", () => {
  const point = { latitude: 37.5, longitude: 127.1 };
  assert.deepEqual(buildProposal("  정문 앞 ", point), { place: { label: "정문 앞", latitude: 37.5, longitude: 127.1 } });
  assert.match(buildProposal("정문 앞", null).error, /핀/);
  assert.match(buildProposal("정문 앞", { latitude: NaN, longitude: 1 }).error, /핀/);
  assert.match(buildProposal("   ", point).error, /적어주세요/);
  assert.match(buildProposal("가".repeat(121), point).error, /120자/);
  assert.ok(buildProposal("가".repeat(120), point).place);
});

test("지도가 없거나 진행 중이 아니면 제안 영역을 숨김", () => {
  assert.equal(proposalBlock({ proposal: null, picking: false, mapReady: false, status: "ACTIVE" }), "");
  assert.equal(proposalBlock({ proposal: null, picking: false, mapReady: true, status: "ARRIVED" }), "");
});

test("제안이 없으면 시작 버튼만, 고르는 중이면 입력 자리를 보여줌", () => {
  const idle = proposalBlock({ proposal: null, picking: false, mapReady: true, status: "ACTIVE" });
  assert.match(idle, /data-action="propose-start"/);
  assert.doesNotMatch(idle, /data-proposal-slot/);
  const picking = proposalBlock({ proposal: null, picking: true, mapReady: true, status: "ACTIVE" });
  assert.match(picking, /data-proposal-slot/);
  assert.doesNotMatch(picking, /propose-start/);
});

test("내 제안은 취소할 수 있고 운전자의 제안은 취소 버튼이 없으며 이름은 이스케이프", () => {
  const mine = { place: { label: "<b>정문</b>" }, proposedBy: "PASSENGER" };
  const html = proposalBlock({ proposal: mine, picking: false, mapReady: true, status: "ACTIVE" });
  assert.match(html, /내가 제안한 장소/);
  assert.match(html, /propose-withdraw/);
  assert.match(html, /약속 장소는 그대로/);
  assert.doesNotMatch(html, /<b>정문/);
  const theirs = proposalBlock({ proposal: { place: { label: "후문" }, proposedBy: "DRIVER" }, picking: false, mapReady: true, status: "ACTIVE" });
  assert.match(theirs, /운전자가 제안한 장소/);
  assert.doesNotMatch(theirs, /propose-withdraw/);
  assert.match(theirs, /propose-start/);
});

test("계정 클라이언트는 마중 요청의 장소 제안 경로만 새로 허용", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push([url, options.method]);
    return new Response(JSON.stringify({ csrfToken: "t", authenticated: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const client = createAccountClient(fetcher);
  await client("/auth/session");
  const id = "0123abcd-0123-4abc-8abc-0123456789ab";
  await client(`/ride-requests/${id}/place-proposal`, { method: "PUT", body: {} });
  await client(`/ride-requests/${id}/place-proposal`, { method: "DELETE" });
  assert.equal(calls.length, 3);
  await assert.rejects(client(`/ride-requests/${id}/place-proposals`), /Unknown account endpoint/);
});
