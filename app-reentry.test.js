import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as model from './model.js';
import * as push from './push.js';
import * as maps from './map.js';
import * as proposal from './proposal.js';
import {ApiError} from './api.js';

const pickupId='10000000-0000-4000-8000-000000000001';
const otherId='10000000-0000-4000-8000-000000000002';
const guest={role:'guest',pickupId,participantId:otherId,token:'g'.repeat(43)};
const link=id=>`#join/${id}/${'i'.repeat(43)}`;
async function open({hash=link(pickupId),saved=guest,status='ACTIVE',rejected=false}={}) {
  const reads=[],writes=[],events={};
  const store=new Map(saved ? [['majung.pickup.session.v1',JSON.stringify(saved)]]:[]);
  const root={innerHTML:'',addEventListener(){},contains:()=>false,querySelector:()=>null};
  const context=vm.createContext({
    ...model,...push,...maps,...proposal,e:model.escapeHtml,ApiError,
    openPickupStream:()=>({close(){}}),
    request:async(path,options={})=>{
      (options.method && options.method!=='GET'?writes:reads).push({path,...options});
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
  const source=(await readFile(new URL('./app.js',import.meta.url),'utf8')).replace(/^import[\s\S]*?from ["'][^"']+["'];\n/gm,'');
  vm.runInContext(source,context);
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  await settle();await settle();
  return {root,reads,writes,store,events,settle};
}
test('같은 링크 재접속은 저장한 참여 권한으로 조회하고 다시 참여하지 않는다',async()=>{
  const ui=await open();
  assert.match(ui.root.innerHTML,/마중 차량이 오고 있어요/);
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
  const ui=await open({rejected:true});
  assert.match(ui.root.innerHTML,/이 약속에 접근할 수 없어요/);assert.equal(ui.store.size,0);
  assert.equal(ui.reads.length,1);assert.equal(ui.writes.length,0);
});
