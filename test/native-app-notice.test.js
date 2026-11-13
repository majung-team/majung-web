import test from 'node:test';
import assert from 'node:assert/strict';
import {showNativeAppNotice} from '../model.js';

const url = `majung://join/10000000-0000-4000-8000-000000000001/${'i'.repeat(43)}`;
function fixture(href = url) {
  const calls = [];
  const listeners = {};
  const confirm = {setAttribute:(key,value)=>calls.push([key,value]),addEventListener:(key,callback)=>{listeners['confirm-'+key]=callback;}};
  const cancel = {addEventListener:(key,callback)=>{listeners['cancel-'+key]=callback;}};
  const dialog = {
    setAttribute(){},
    querySelector:selector=>selector==='[data-native-confirm]' ? confirm : cancel,
    addEventListener:(key,callback)=>{listeners[key]=callback;},
    showModal:()=>calls.push('shown'),
    close:()=>{calls.push('closed');listeners.close();},
    remove:()=>calls.push('removed'),
  };
  const doc = {querySelector:()=>null,createElement:()=>dialog,body:{appendChild:()=>calls.push('appended')}};
  const trigger = {getAttribute:()=>href,isConnected:true,focus:()=>calls.push('focus-restored')};
  return {doc,trigger,dialog,calls,listeners};
}

test('앱 열기는 안내 안의 명시적 선택으로만 제공하고 웹 계속은 링크를 실행하지 않는다', () => {
  const view = fixture();
  assert.equal(showNativeAppNotice(view.trigger,view.doc),true);
  assert.match(view.dialog.innerHTML,/정식 출시 전 테스트 중/);
  assert.match(view.dialog.innerHTML,/웹에서 계속/);
  assert.deepEqual(view.calls,[['href',url],'appended','shown']);
  view.listeners['cancel-click']();
  assert.deepEqual(view.calls.slice(-3),['closed','removed','focus-restored']);
});

test('확인 링크는 원래 초대 정보를 유지하고 선택하면 안내를 닫는다', () => {
  const view=fixture();
  showNativeAppNotice(view.trigger,view.doc);
  view.listeners['confirm-click']();
  assert.deepEqual(view.calls[0],['href',url]);
  assert.ok(view.calls.includes('closed'));
});

test('외부 주소와 잘못된 앱 링크로는 안내나 이동을 만들지 않는다', () => {
  for(const href of ['https://example.test','javascript:alert(1)',url+'?token=bad',url.replace('/join/','/auth/')]) {
    const view=fixture(href);
    assert.equal(showNativeAppNotice(view.trigger,view.doc),false);
    assert.deepEqual(view.calls,[]);
  }
});
