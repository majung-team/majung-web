// Kakao Maps is display-only: no route calculation, and Kakao place IDs are never sent to the vehicle.
let loading = null;

export function loadKakaoMaps(key) {
  if (!key) return Promise.resolve(null);
  if (window.kakao?.maps?.Map) return Promise.resolve(window.kakao.maps);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    let settled = false;
    const timeout = setTimeout(() => finish(new Error("Kakao Maps timed out")), 8000);
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) { script.remove(); reject(error); }
      else resolve(window.kakao.maps);
    }
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`;
    script.onload = () => {
      if (settled) return;
      try {
        if (typeof window.kakao?.maps?.load !== "function") throw new Error("Kakao Maps SDK unavailable");
        window.kakao.maps.load(() => finish());
      } catch (error) { finish(error); }
    };
    script.onerror = () => finish(new Error("Kakao Maps could not be loaded"));
    document.head.append(script);
  }).catch(error => { loading = null; throw error; });
  return loading;
}

// The element survives innerHTML re-renders: each render leaves an empty slot and attach() moves the map into it.
export function createPickupMap(maps) {
  const element = document.createElement("div");
  element.className = "pickup-map";
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", "차량 위치와 약속 장소 지도");
  const carElement = document.createElement("div");
  carElement.className = "car-marker";
  carElement.textContent = "차";
  let map = null;
  let placeMarker = null;
  let carOverlay = null;
  let fittedFor = null;

  function ensureMap(center) {
    if (map) return;
    map = new maps.Map(element, { center, level: 4 });
    placeMarker = new maps.Marker({ position: center });
    carOverlay = new maps.CustomOverlay({ content: carElement, yAnchor: 0.5 });
  }

  return {
    attach(slot) {
      if (!slot) return;
      if (slot !== element) slot.replaceWith(element);
      map?.relayout();
    },
    update(place, view) {
      if (!element.isConnected || !place) return;
      const placePosition = new maps.LatLng(place.latitude, place.longitude);
      ensureMap(placePosition);
      placeMarker.setPosition(placePosition);
      placeMarker.setMap(map);
      const hasCar = Number.isFinite(view?.latitude) && Number.isFinite(view?.longitude);
      if (hasCar) {
        carOverlay.setPosition(new maps.LatLng(view.latitude, view.longitude));
        carOverlay.setMap(map);
        carElement.classList.toggle("stale", view.kind === "stale");
      } else carOverlay.setMap(null);
      // Fit once when the car appears or disappears; later updates leave the viewer's panning alone.
      const fitKey = `${place.latitude},${place.longitude},${hasCar}`;
      if (fittedFor === fitKey) return;
      fittedFor = fitKey;
      if (!hasCar) {
        map.setCenter(placePosition);
        return;
      }
      const bounds = new maps.LatLngBounds();
      bounds.extend(placePosition);
      bounds.extend(carOverlay.getPosition());
      map.setBounds(bounds, 48, 48, 48, 48);
    },
  };
}

// Selection is explicit. Opening a map never turns its default center into a pickup place.
export function createPlacePicker(maps, onSelect) {
  const element = document.createElement("div");
  element.className = "pickup-map";
  element.setAttribute("role", "group");
  element.setAttribute("aria-label", "만날 장소 선택 지도");
  let map = null, marker = null, enabled = true, selectionKey = null;
  const valid = point => Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude) &&
    Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180 &&
    (point.latitude !== 0 || point.longitude !== 0);
  function choose(position) {
    const point = {latitude:position.getLat(), longitude:position.getLng()};
    if (!enabled || !valid(point)) return;
    marker.setPosition(position);
    marker.setMap(map);
    selectionKey = `${point.latitude},${point.longitude}`;
    onSelect(point);
  }
  const click = event => choose(event.latLng);
  return {
    attach(slot, place, interactive = true) {
      if (!slot) return;
      enabled = interactive;
      if (slot !== element) slot.replaceWith(element);
      if (!map) {
        map = new maps.Map(element, {center:new maps.LatLng(37.5665,126.9780),level:4});
        marker = new maps.Marker();
        maps.event.addListener(map,"click",click);
      }
      map.relayout();
      const key = valid(place) ? `${place.latitude},${place.longitude}` : null;
      if (key !== selectionKey) {
        selectionKey = key;
        if (key) {
          const position = new maps.LatLng(place.latitude,place.longitude);
          marker.setPosition(position); marker.setMap(map); map.setCenter(position);
        } else marker.setMap(null);
      }
    },
    chooseCenter() { if (map) choose(map.getCenter()); },
    destroy() {
      enabled = false;
      if (map) maps.event.removeListener(map,"click",click);
      marker?.setMap(null);
      element.remove();
      map = null; marker = null;
    },
  };
}
