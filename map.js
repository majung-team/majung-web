// Kakao Maps is display-only: no route calculation, and Kakao place IDs are never sent to the vehicle.
let loading = null;

export function loadKakaoMaps(key) {
  if (!key) return Promise.resolve(null);
  if (window.kakao?.maps?.Map) return Promise.resolve(window.kakao.maps);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    // autoload=false: the default loader uses document.write, which fails for a script added later.
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`;
    script.onload = () => window.kakao.maps.load(() => resolve(window.kakao.maps));
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error("Kakao Maps could not be loaded"));
    };
    document.head.append(script);
  });
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
