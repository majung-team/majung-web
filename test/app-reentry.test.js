import * as pickupControls from "../model.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as model from '../model.js';
import * as push from '../push.js';
import * as maps from '../map.js';
import * as proposal from '../proposal.js';
import {ApiError} from '../api.js';

const pickupId='10000000-0000-4000-8000-000000000001';
const otherId='10000000-0000-4000-8000-000000000002';
const guest={role:'guest',pickupId,participantId:otherId,token:'g'.repeat(43)};
const link=id=>`#join/${id}/${'i'.repeat(43)}`;
async function open({hash=link(pickupId),saved=guest,status='ACTIVE',rejected=false,onReadiness=null,onJoin=null,onPreview=null}={}) {
  const reads=[],writes=[],events={},rootEvents={};
  const store=new Map(saved ? [['majung.pickup.session.v1',JSON.stringify(saved)]]:[]);
  const root={innerHTML:'',addEventListener(name,callback){rootEvents[name]=callback;},contains:()=>false,querySelector:()=>null};
  const context=vm.createContext({
    ...pickupControls,...model,...push,...maps,...proposal,e:model.escapeHtml,ApiError,
    openPickupStream:()=>({close(){}}),
    request:async(path,options={})=>{
      (options.method && options.method!=='GET'?writes:reads).push({path,...options});
      if(path.endsWith('/invitation-preview')) return onPreview ? onPreview() : {placeLabel:'시험 장소'};
      if(path.endsWith('/participants') && onJoin) return onJoin();
      if(path.endsWith('/readiness') && onReadiness) return onReadiness(options);
      if(rejected)throw new ApiError(403,{code:'PARTICIPANT_REVOKED'});
      if(path.endsWith('/vehicle-state'))return {freshness:'WAITING'};
      return {status,place:{label:'시험 장소',latitude:37,longitude:127},participant:{readiness:'READY'}};
    },
    document:{querySelector:()=>root,activeElement:null,hidden:false,addEventListener(){}},
    window:{addEventListener:(name,callback)=>{events[name]=callback;}},
    location:{hash,pathname:'/',origin:'https://test.invalid',reload(){}},
    history:{replaceState(){}},sessionStorage:{getItem:key=>store.get(key),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
    performance:{now:()=>1000},setInterval(){},fetch:async()=>({ok:false}),navigator:{},CSS:{escape:x=>x},URL,AbortSignal,
  });
  const source=(await readFile(new URL('../app.js',import.meta.url),'utf8')).replace(/^import[\s\S]*?from ["'][^"']+["'];\n/gm,'');
  vm.runInContext(source,context);
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  await settle();await settle();
  return {root,reads,writes,store,events,rootEvents,settle,context};
}
test('같은 링크 재접속은 저장한 참여 권한으로 조회하고 다시 참여하지 않는다',async()=>{
  const ui=await open();
  assert.match(ui.root.innerHTML,/차량 위치와 도착 시간을 기다리고 있어요/);
  assert.equal(ui.reads[0].token,guest.token);
  assert.equal(ui.writes.length,0);
  assert.doesNotMatch(ui.root.innerHTML,/id="join-form"/);
  const previous=ui.reads.length;
  ui.events.pageshow({persisted:true});await ui.settle();
  assert.ok(ui.reads.length>previous);
});
test('다른 픽업의 링크는 기존 참여 권한을 사용하지 않는다',async()=>{
  const ui=await open({hash:link(otherId)});
  assert.match(ui.root.innerHTML,/id="join-form"/);assert.equal(ui.reads.length,0);
});
test('운전자 공유 링크에는 탑승자 세션을 적용하지 않는다',async()=>{
  const ui=await open({hash:link(pickupId).replace('#join/','#share/')});
  assert.match(ui.root.innerHTML,/운전자 · 초대 전달/);assert.equal(ui.reads.length,0);
});
test('완료된 픽업 재접속은 위치 대신 종료 안내를 보여준다',async()=>{
  const ui=await open({status:'COMPLETED'});
  assert.match(ui.root.innerHTML,/위치 공유 종료/);assert.equal(ui.reads.length,1);
  assert.equal(ui.store.size,0);assert.equal(ui.writes.length,0);
});
test('철회된 참여 권한은 지우고 위치 조회를 이어가지 않는다',async()=>{
  const ui=await open({hash:'',rejected:true});
  assert.match(ui.root.innerHTML,/이 약속에 접근할 수 없어요/);assert.equal(ui.store.size,0);
  assert.equal(ui.reads.length,1);assert.equal(ui.writes.length,0);
});

test('준비 상태 전송이 끝나기 전에는 빠른 연속 클릭을 다시 전송하지 않는다',async()=>{
  let finish;
  const ui=await open({onReadiness:()=>new Promise(resolve=>{finish=resolve;})});
  const first=vm.runInContext('sendReadiness("PREPARING")',ui.context);
  await ui.settle();
  await vm.runInContext('sendReadiness("READY")',ui.context);
  assert.equal(ui.writes.filter(write=>write.path.endsWith('/readiness')).length,1);
  finish({status:'ACTIVE',participant:{readiness:'PREPARING',readinessSequence:2,readinessReceivedSequence:1}});
  await first;
  assert.doesNotMatch(ui.root.innerHTML,/운전자 내비에/);
});

test('준비 상태 저장 실패는 이전 상태와 명시적인 재시도 버튼을 남긴다',async()=>{
  const ui=await open({onReadiness:()=>{throw new Error('test network outage');}});
  await vm.runInContext('sendReadiness("PREPARING")',ui.context);
  assert.match(ui.root.innerHTML,/준비 상태 다시 보내기/);
  assert.match(ui.root.innerHTML,/이전 준비 상태/);
  assert.match(ui.root.innerHTML,/aria-pressed="true"/);
});

test('메시지 입력 중에도 실제 도착 안내를 갱신하고 취소 때 위치 화면을 제거한다',async()=>{
  const ui=await open();
  const critical={innerHTML:''};
  ui.root.contains=()=>true;
  ui.root.querySelector=selector=>selector==='[data-critical-status]' ? critical : null;
  ui.context.document.activeElement={tagName:'INPUT',name:'quickMsg',value:'아직 쓰는 중'};
  vm.runInContext('guestQuickMsgText="아직 쓰는 중"; snapshot.status="ARRIVED"; render()',ui.context);
  assert.match(critical.innerHTML,/차량이 도착/);
  assert.equal(vm.runInContext('guestQuickMsgText',ui.context),'아직 쓰는 중');
  ui.root.contains=()=>false;
  vm.runInContext('finished={status:"CANCELLED"}; render()',ui.context);
  assert.match(ui.root.innerHTML,/취소/);
  assert.doesNotMatch(ui.root.innerHTML,/quick-msg-form|map-slot/);
});
test('메시지 저장 실패 때 초안을 지우지 않고 51자는 전송하지 않는다',async()=>{
  const ui=await open();
  vm.runInContext('guestQuickMsgText="실패해도 남을 초안"; request=async()=>{throw new ApiError(500,{message:"시험 실패"});}',ui.context);
  const form={reportValidity:()=>true,classList:{contains:()=>true}};
  ui.context.FormData=class {get(){return vm.runInContext('guestQuickMsgText',ui.context);}};
  await ui.rootEvents.submit({preventDefault(){},target:form});
  assert.equal(vm.runInContext('guestQuickMsgText',ui.context),'실패해도 남을 초안');
  vm.runInContext('guestQuickMsgText="가".repeat(51)',ui.context);
  await ui.rootEvents.submit({preventDefault(){},target:form});
  assert.match(vm.runInContext('message',ui.context),/50자/);
});

test('도착 시간 안내는 지도 컨테이너 밖에 있어 지도 오류에도 남는다', async()=>{
  const ui=await open();
  const html=ui.root.innerHTML;
  assert.ok(html.indexOf('class="pickup-eta-summary"') < html.indexOf('class="map-wrapper'));
  assert.match(html,/차량 정보 수신 대기/);
  assert.ok(html.indexOf("readiness-card") < html.indexOf("map-wrapper"));
});

test('종료된 픽업의 초대에는 다시 참여할 수 있다는 버튼을 표시하지 않는다',async()=>{
  const ui=await open({saved:null,onJoin:()=>{throw new ApiError(410,{code:'PICKUP_ENDED'});}});
  ui.context.FormData=class {};
  await ui.rootEvents.submit({preventDefault(){},target:{id:'join-form',reportValidity:()=>true}});
  assert.match(ui.root.innerHTML,/이미 끝난 픽업이에요/);
  assert.match(ui.root.innerHTML,/운전자에게 새 초대 링크/);
  assert.doesNotMatch(ui.root.innerHTML,/id="join-form"/);
});
test('사용할 수 없는 초대는 참여 버튼을 누르기 전에 안내한다',async()=>{
  const ui=await open({saved:null,onPreview:()=>{throw new ApiError(410,{code:'INVITE_UNAVAILABLE'});}});
  assert.match(ui.root.innerHTML,/운전자에게 새 초대 링크/);
  assert.doesNotMatch(ui.root.innerHTML,/id="join-form"/);
  assert.equal(ui.writes.length,1);
});
test('유효한 초대는 만날 장소만 먼저 보여주고 참여를 기다린다',async()=>{
  const ui=await open({saved:null});
  assert.match(ui.root.innerHTML,/시험 장소/);
  assert.match(ui.root.innerHTML,/id="join-form"/);
  assert.deepEqual(ui.writes.map(write=>write.path),[`/${pickupId}/invitation-preview`]);
});
test('재발급 링크를 열면 철회된 기존 세션 대신 새 초대로 참여할 수 있다',async()=>{
  const ui=await open({rejected:true});
  assert.match(ui.root.innerHTML,/id="join-form"/);
  assert.equal(ui.store.size,0);
  assert.deepEqual(ui.writes.map(write=>write.path),[`/${pickupId}/invitation-preview`]);
});
