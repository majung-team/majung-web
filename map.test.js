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
    const pickup=createPickupMap({LatLng,Map,Marker,CustomOverlay,LatLngBounds});
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

test('장소 선택 지도는 열기만으로 선택하지 않고 명시적 클릭·중심 선택만 반영', async () => {
  const {createPlacePicker}=await import('./map.js');
  const previous=globalThis.document;
  const listeners=new Set(), created=[], selected=[];
  globalThis.document={createElement:()=>({setAttribute(){},remove(){this.removed=true;}})};
  class LatLng {constructor(lat,lng){this.lat=lat;this.lng=lng;}getLat(){return this.lat;}getLng(){return this.lng;}}
  class Map {constructor(element,options){this.center=options.center;created.push(this);}relayout(){}setCenter(point){this.center=point;}getCenter(){return this.center;}}
  class Marker {setPosition(point){this.position=point;}setMap(map){this.map=map;}}
  const maps={Map,Marker,LatLng,event:{addListener(map,name,listener){listeners.add(listener);},removeListener(map,name,listener){listeners.delete(listener);}}};
  try {
    const picker=createPlacePicker(maps,point=>selected.push(point));
    const slot={replaceWith(){}};
    picker.attach(slot,null);
    assert.equal(selected.length,0);
    picker.chooseCenter();
    assert.deepEqual(selected[0],{latitude:37.5665,longitude:126.978});
    const selectedPoint={latitude:37.3,longitude:127.3};
    picker.attach(slot,selectedPoint);
    assert.equal(created.length,1);
    assert.equal(selected.length,1); // Programmatic marker moves are not user selection.
    const click=[...listeners][0];
    click({latLng:new LatLng(37.31,127.31)});
    assert.deepEqual(selected[1],{latitude:37.31,longitude:127.31});
    picker.attach(slot,selectedPoint,false);
    click({latLng:new LatLng(37.4,127.4)});
    picker.chooseCenter();
    assert.equal(selected.length,2);
    picker.attach(slot,selectedPoint,true);
    click({latLng:new LatLng(0,0)});
    assert.equal(selected.length,2);
    picker.destroy();
    assert.equal(listeners.size,0);
  } finally {globalThis.document=previous;}
});
