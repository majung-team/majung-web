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
  // Suggested place and the pin being placed use their own markers; the confirmed place is never moved.
  const proposalElement = markerElement("proposal-marker", "제안");
  const pinElement = markerElement("pin-marker", "여기");
  let proposalOverlay = null;
  let pinOverlay = null;
  let onPick = null;

  function ensureMap(center) {
    if (map) return;
    map = new maps.Map(element, { center, level: 4 });
    placeMarker = new maps.Marker({ position: center });
    carOverlay = new maps.CustomOverlay({ content: carElement, yAnchor: 0.5 });
    proposalOverlay = new maps.CustomOverlay({ content: proposalElement, yAnchor: 0.5 });
    pinOverlay = new maps.CustomOverlay({ content: pinElement, yAnchor: 0.5 });
    maps.event.addListener(map, "click", (event) => {
      if (!onPick) return;
      const position = event.latLng;
      pinOverlay.setPosition(position);
      pinOverlay.setMap(map);
      onPick({ latitude: position.getLat(), longitude: position.getLng() });
    });
  }

  return {
    attach(slot) {
      if (!slot) return;
      if (slot !== element) slot.replaceWith(element);
      map?.relayout();
    },
    update(place, view, proposal = null) {
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
      if (proposal) {
        proposalOverlay.setPosition(new maps.LatLng(proposal.latitude, proposal.longitude));
        proposalOverlay.setMap(map);
      } else proposalOverlay.setMap(null);
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
    // Tapping the map places one pin and reports its coordinates; stopPicking removes the pin.
    startPicking(callback) {
      onPick = callback;
      element.classList.add("picking");
    },
    stopPicking() {
      onPick = null;
      element.classList.remove("picking");
      pinOverlay?.setMap(null);
    },
  };
}

function markerElement(className, text) {
  const element = document.createElement("div");
  element.className = className;
  element.textContent = text;
  return element;
}
