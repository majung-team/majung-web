import test from "node:test";
import assert from "node:assert/strict";
import { createAccountClient, AccountError } from "./account-api.js";

test("세션 쿠키와 페이지 메모리의 CSRF만 사용하고 로그아웃하면 CSRF를 지운다", async () => {
  const calls = [];
  const client = createAccountClient(async (path, options) => {
    calls.push({path, options});
    if (path.endsWith("/session")) return new Response(JSON.stringify({csrfToken:"fixture-csrf"}), {status:200});
    return new Response(null, {status:204});
  });
  await assert.rejects(client("/accounts/me", {method:"PATCH", body:{nickname:"새 이름"}}), e => e.code === "CSRF_REQUIRED");
  assert.equal(calls.length, 0);
  await client("/auth/session");
  await client("/accounts/me", {method:"PATCH", body:{nickname:"새 이름"}});
  const mutation = calls.at(-1).options;
  assert.equal(mutation.credentials, "same-origin");
  assert.equal(mutation.headers["X-CSRF-TOKEN"], "fixture-csrf");
  assert.equal(mutation.headers.Authorization, undefined);
  assert.equal(mutation.redirect, "error");
  await client("/auth/logout", {method:"POST"});
  await assert.rejects(client("/accounts/me", {method:"PATCH"}), e => e.code === "CSRF_REQUIRED");
});
test("다른 주소로 계정 요청을 보내지 않고 프록시 HTML을 오류 메시지로 노출하지 않는다", async () => {
  let calls = 0;
  const client = createAccountClient(async () => { calls++; return new Response("<html>proxy detail</html>", {status:502}); });
  await assert.rejects(client("https://other.example/accounts/me"));
  assert.equal(calls, 0);
  await assert.rejects(client("/auth/session"), e => e instanceof AccountError && !e.message.includes("proxy detail"));
});
test("쓰기 통신 실패를 자동 재전송하지 않고 403 뒤에는 새 CSRF를 요구한다", async () => {
  let mode = "session", writes = 0;
  const client = createAccountClient(async (path, options) => {
    if (options.method === "GET") return new Response(JSON.stringify({csrfToken:"fixture-csrf"}), {status:200});
    writes++;
    if (mode === "timeout") throw new Error("fixture network failure");
    return new Response(JSON.stringify({code:"ACCOUNT_REQUEST_REJECTED",message:"다시 확인해주세요."}), {status:403});
  });
  await client("/auth/session");
  mode="timeout";
  await assert.rejects(client("/connections", {method:"POST", body:{memberId:"fixture"}}), e => e.code === "NETWORK_ERROR");
  assert.equal(writes, 1);
  mode="forbidden";
  await assert.rejects(client("/connections", {method:"POST"}), e => e.status === 403);
  await assert.rejects(client("/connections", {method:"POST"}), e => e.code === "CSRF_REQUIRED");
  assert.equal(writes, 2);
});

test("마중 요청과 차량 연결은 계정 세션·CSRF로만 보내고 차량 권한 API는 허용하지 않는다", async () => {
  const calls=[];
  const client=createAccountClient(async(path,options)=>{
    calls.push({path,options});
    return new Response(JSON.stringify(path.endsWith("session")?{csrfToken:"fixture-csrf"}:{requests:[]}),{status:200});
  });
  await client("/auth/session");
  await client("/ride-requests",{method:"POST",body:{driverId:"driver",requestId:"request",place:{label:"시험 장소",latitude:37,longitude:127}}});
  assert.equal(calls.at(-1).options.headers["X-CSRF-TOKEN"],"fixture-csrf");
  assert.equal(calls.at(-1).options.headers.Authorization,undefined);
  await client("/vehicle-links/requests",{method:"POST",body:{challengeId:"fixture",code:"Q".repeat(43)}});
  await client("/ride-requests/abcd/tracking");
  await client("/ride-requests/abcd/accept-invitation",{method:"POST"});
  assert.equal(calls.at(-1).options.headers["X-CSRF-TOKEN"],"fixture-csrf");
  await client("/ride-requests/abcd/reject-invitation",{method:"POST"});
  const count=calls.length;
  await assert.rejects(client("/vehicles/ride-requests/abcd/accept",{method:"POST"}));
  await assert.rejects(client("/ride-requests/abcd/accept",{method:"POST"}));
  assert.equal(calls.length,count);
});
