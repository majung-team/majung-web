import test from 'node:test';
import assert from 'node:assert/strict';
import { createPickupMap, loadKakaoMaps } from './map.js';

test('지도 키가 없으면 외부 SDK를 부르지 않음', async () => {
  assert.equal(await loadKakaoMaps(''), null);
});

test('지도 인스턴스를 재사용하고 오래된 차는 흐리게, 위치가 없으면 제거', () => {
  const previous=globalThis.document;
  const elements=[]; const mapsCreated=[]; const overlays=[];
  globalThis.document={createElement:()=>{const element={isConnected:true,setAttribute(){},classList:{toggle(name,enabled){element[name]=enabled;}}};elements.push(element);return element;}};
  class LatLng { constructor(latitude,longitude){this.latitude=latitude;this.longitude=longitude;} }
  class Map { constructor(){this.fits=0;this.layouts=0;mapsCreated.push(this);} relayout(){this.layouts++;} setBounds(){this.fits++;} setCenter(value){this.center=value;} }
  class Marker { setPosition(value){this.position=value;} setMap(map){this.map=map;} }
  class CustomOverlay extends Marker { constructor(){super();overlays.push(this);} getPosition(){return this.position;} }
  class LatLngBounds { extend(){} }
  try {
    const pickup=createPickupMap({LatLng,Map,Marker,CustomOverlay,LatLngBounds,event:{addListener(){}}});
    const slot={replaceWith(element){this.element=element;}};
    pickup.attach(slot);
    const place={latitude:37.3,longitude:127.3};
    pickup.update(place,{latitude:37.2,longitude:127.2,kind:'fresh'});
    assert.equal(mapsCreated.length,1); assert.equal(mapsCreated[0].fits,1);
    pickup.attach(slot);
    pickup.update(place,{latitude:37.21,longitude:127.21,kind:'stale'});
    assert.equal(mapsCreated.length,1); assert.equal(mapsCreated[0].fits,1);
    assert.equal(elements[1].stale,true);
    pickup.update(place,{kind:'lost'});
    assert.equal(overlays[0].map,null);
    assert.equal(mapsCreated[0].center.latitude,place.latitude);
  } finally { globalThis.document=previous; }
});

test('SDK 응답이 잘못되면 실패 처리하고 다음 로딩을 다시 허용', async () => {
  const previousDocument=globalThis.document, previousWindow=globalThis.window;
  const scripts=[];
  globalThis.window={};
  globalThis.document={createElement:()=>({remove(){this.removed=true;}}),head:{append(script){scripts.push(script);queueMicrotask(()=>script.onload());}}};
  try {
    await assert.rejects(loadKakaoMaps('test-key'),/SDK unavailable/);
    assert.equal(scripts[0].removed,true);
    window.kakao={maps:{load:callback=>{window.kakao.maps.Map=class {};callback();}}};
    assert.equal(await loadKakaoMaps('test-key'),window.kakao.maps);
    assert.equal(scripts.length,2);
  } finally { globalThis.document=previousDocument;globalThis.window=previousWindow; }
});

test('지도를 눌러 핀을 놓고 제안 위치는 확정 장소와 따로 표시', () => {
  const previous=globalThis.document;
  const classes=new Set(); const listeners=[]; const overlays=[];
  globalThis.document={createElement:()=>{const element={isConnected:true,setAttribute(){},classList:{toggle(){},add(name){classes.add(name);},remove(name){classes.delete(name);}}};return element;}};
  class LatLng { constructor(latitude,longitude){this.latitude=latitude;this.longitude=longitude;} getLat(){return this.latitude;} getLng(){return this.longitude;} }
  class Map { relayout(){} setBounds(){} setCenter(){} }
  class Marker { setPosition(value){this.position=value;} setMap(map){this.map=map;} }
  class CustomOverlay extends Marker { constructor(){super();overlays.push(this);} getPosition(){return this.position;} }
  class LatLngBounds { extend(){} }
  const event={addListener:(map,name,handler)=>listeners.push([name,handler])};
  try {
    const pickup=createPickupMap({LatLng,Map,Marker,CustomOverlay,LatLngBounds,event});
    pickup.attach({replaceWith(){}});
    const place={latitude:37.3,longitude:127.3};
    pickup.update(place,null);
    const [car,proposal,pin]=overlays;
    assert.equal(proposal.map,null);
    pickup.update(place,null,{latitude:37.31,longitude:127.31});
    assert.equal(proposal.position.latitude,37.31);
    assert.ok(proposal.map);
    pickup.update(place,null,null);
    assert.equal(proposal.map,null);
    const picked=[];
    const click=listeners.find(([name])=>name==='click')[1];
    click({latLng:new LatLng(1,2)});
    assert.ok(!pin.map);
    pickup.startPicking(point=>picked.push(point));
    assert.ok(classes.has('picking'));
    click({latLng:new LatLng(37.4,127.4)});
    assert.deepEqual(picked,[{latitude:37.4,longitude:127.4}]);
    assert.ok(pin.map);
    pickup.stopPicking();
    assert.equal(pin.map,null);
    assert.ok(!classes.has('picking'));
    click({latLng:new LatLng(5,6)});
    assert.equal(picked.length,1);
    assert.ok(!car.map);
  } finally { globalThis.document=previous; }
});
