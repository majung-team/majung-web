import test from "node:test";
import assert from "node:assert/strict";
import { readinessControl, quickMessageControl } from "../model.js";

test("준비 상태는 서버 저장과 차량 수신을 구분하고 전송 중 조작을 잠근다", () => {
  const participant = {readiness:"READY",readinessSequence:3,readinessReceivedSequence:2};
  assert.match(readinessControl({participant}), /차량 앱으로 전달을 기다리고/);
  assert.match(readinessControl({participant:{...participant,readinessReceivedSequence:3}}), /차량 앱에 전달됐어요/);
  const pending=readinessControl({participant,sending:true});
  assert.match(pending,/보내는 중/);
  assert.equal((pending.match(/ disabled/g)||[]).length,2);
  assert.doesNotMatch(pending,/내비에.*표시/);
});

test("두 픽업 진입 경로에 같은 메시지와 준비 선택을 제공하고 사용자 내용을 이스케이프한다", () => {
  const guest=readinessControl({participant:{readiness:"PREPARING"}});
  const account=readinessControl({participant:{readiness:"PREPARING"},prefix:"ride-",attributes:'data-id="request"'});
  for(const label of ["준비 중","탑승 준비 완료"]) {
    assert.ok(guest.includes(label)); assert.ok(account.includes(label));
  }
  const message=quickMessageControl({message:'<script>"hello"</script>',value:'" autofocus'});
  assert.doesNotMatch(message,/<script>/);
  assert.match(message,/&lt;script&gt;/);
  assert.match(message,/aria-label="운전자에게 보낼 메시지"/);
});
