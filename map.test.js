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

test('장소명·주소 검색 결과를 합치고 공급자 ID와 잘못된 좌표를 제외', async () => {
  const {searchPickupPlaces}=await import('./map.js');
  const calls=[];
  const place={id:'provider-only',place_name:'시험 정문',road_address_name:'시험 도로 10',x:'127.3',y:'37.3'};
  const maps={services:{Status:{OK:'OK',ZERO_RESULT:'ZERO_RESULT'},
    Places:class {keywordSearch(query,callback,options){calls.push({query,...options});callback([null,place,place,{place_name:'좌표 없음',x:'',y:''},{place_name:'잘못된 점',x:'0',y:'0'}],'OK',{hasNextPage:true});}},
    Geocoder:class {addressSearch(query,callback,options){calls.push({query,...options});callback([{address_name:'시험 도로 20',road_address:{address_name:'시험 도로 20'},x:'127.4',y:'37.4'}],'OK',{hasNextPage:false});}}}};
  const result=await searchPickupPlaces(maps,'  시험  ');
  assert.equal(result.items.length,2);
  assert.deepEqual(result.items[0],{label:'시험 정문',address:'시험 도로 10',latitude:37.3,longitude:127.3});
  assert.equal(result.hasNext,true); assert.equal(result.partial,false);
  assert.equal(calls[0].query,'시험'); assert.equal(calls[0].size,5);
  assert.equal((await searchPickupPlaces(maps,'시험',3)).hasNext,false);
  await assert.rejects(searchPickupPlaces(maps,' '),/INPUT/);
  await assert.rejects(searchPickupPlaces(maps,'시험',4),/INPUT/);
});

test('검색 결과 없음과 서비스 실패를 구분하고 일부 성공은 안내와 함께 유지', async () => {
  const {searchPickupPlaces}=await import('./map.js');
  const Status={OK:'OK',ZERO_RESULT:'ZERO_RESULT'};
  const empty=class {keywordSearch(query,callback){callback([],'ZERO_RESULT');}addressSearch(query,callback){callback([],'ZERO_RESULT');}};
  assert.deepEqual(await searchPickupPlaces({services:{Status,Places:empty,Geocoder:empty}},'시험'),{items:[],hasNext:false,partial:false});
  const fail=class {keywordSearch(query,callback){callback([],'ERROR');}};
  const address=class {addressSearch(query,callback){callback([{address_name:'시험 주소',x:'127',y:'37'}],'OK');}};
  const partial=await searchPickupPlaces({services:{Status,Places:fail,Geocoder:address}},'시험');
  assert.equal(partial.items.length,1); assert.equal(partial.partial,true);
  await assert.rejects(searchPickupPlaces({services:{Status,Places:fail,Geocoder:empty}},'시험'),/FAILED/);
  await assert.rejects(searchPickupPlaces({},'시험'),/UNAVAILABLE/);
});

test('응답 없는 장소 검색은 제한 시간 후 실패하며 늦은 콜백을 반영하지 않음', async () => {
  const {searchPickupPlaces}=await import('./map.js');
  const previousSet=globalThis.setTimeout, previousClear=globalThis.clearTimeout;
  const callbacks=[];
  globalThis.setTimeout=callback=>{queueMicrotask(callback);return 1;};
  globalThis.clearTimeout=()=>{};
  const client=class {keywordSearch(query,callback){callbacks.push(callback);}addressSearch(query,callback){callbacks.push(callback);}};
  try {
    await assert.rejects(searchPickupPlaces({services:{Status:{OK:'OK'},Places:client,Geocoder:client}},'시험'),/FAILED/);
    for (const callback of callbacks) callback([{place_name:'늦은 결과',x:'127',y:'37'}],'OK');
  } finally {globalThis.setTimeout=previousSet;globalThis.clearTimeout=previousClear;}
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
