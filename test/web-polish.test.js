import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { request, ApiError } from "../api.js";
import {
  externalMapLinks,
  placeActionBar,
  RECENT_PLACES_KEY,
  RECENT_PLACES_MAX,
  loadRecentPlaces,
  saveRecentPlace,
  removeRecentPlace,
  clearRecentPlaces,
} from "../model.js";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test("api.js는 204 응답과 비-JSON 프록시 오류를 안전하게 처리한다", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(null, { status: 204 });
    const empty = await request("/test-id/arrival-push", { method: "DELETE" });
    assert.equal(empty, null);

    globalThis.fetch = async () =>
      new Response("<html><body>502 Bad Gateway</body></html>", {
        status: 502,
        headers: { "Content-Type": "text/html" },
      });
    await assert.rejects(
      () => request("/test-id"),
      (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 502);
        assert.equal(error.code, "INVALID_RESPONSE");
        assert.ok(!error.message.includes("<html>"));
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("외부 지도 링크와 장소 바로가기 바는 유효 좌표만 허용하고 HTML을 이스케이프한다", () => {
  assert.equal(externalMapLinks(null), null);
  assert.equal(externalMapLinks({ label: "영점", latitude: 0, longitude: 0 }), null);
  assert.equal(externalMapLinks({ label: "범위초과", latitude: 95, longitude: 127 }), null);

  const place = { label: '강남역 <1번> "출구"', latitude: 37.497942, longitude: 127.027621 };
  const links = externalMapLinks(place);
  assert.ok(links.kakao.startsWith("https://map.kakao.com/link/to/"));
  assert.ok(links.kakao.includes("37.497942,127.027621"));
  assert.ok(links.naver.startsWith("https://map.naver.com/v5/search/"));
  assert.ok(links.naver.includes("127.027621,37.497942"));

  const html = placeActionBar(place, { prefix: "ride-" });
  assert.ok(html.includes('data-action="ride-copy-place"'));
  assert.ok(html.includes("&lt;1번&gt;"));
  assert.ok(!html.includes("<1번>"));
  assert.ok(html.includes('rel="noopener noreferrer"'));
});

test("최근 장소 저장소는 중복 제거·최대 5개 유지·삭제·초기화와 손상 복구를 지원한다", () => {
  const storage = memoryStorage();
  storage.setItem(RECENT_PLACES_KEY, "{broken json");
  assert.deepEqual(loadRecentPlaces(storage), []);

  for (let i = 1; i <= 6; i += 1) {
    saveRecentPlace(
      { label: `장소 ${i}`, address: `주소 ${i}`, latitude: 37.5 + i * 0.01, longitude: 127.0 + i * 0.01 },
      storage,
    );
  }
  const list = loadRecentPlaces(storage);
  assert.equal(list.length, RECENT_PLACES_MAX);
  assert.equal(list[0].label, "장소 6");
  assert.equal(list[4].label, "장소 2");

  // Deduplicate by near-identical coordinate and move to front
  saveRecentPlace(
    { label: "장소 3 새이름", address: "주소 3", latitude: 37.53001, longitude: 127.03001 },
    storage,
  );
  const deduped = loadRecentPlaces(storage);
  assert.equal(deduped.length, RECENT_PLACES_MAX);
  assert.equal(deduped[0].label, "장소 3 새이름");
  assert.ok(!deduped.some((item) => item.label === "장소 3"));

  const afterRemove = removeRecentPlace(0, storage);
  assert.equal(afterRemove.length, 4);
  assert.equal(afterRemove[0].label, "장소 6");

  assert.deepEqual(clearRecentPlaces(storage), []);
  assert.equal(storage.getItem(RECENT_PLACES_KEY), null);
});

test("HTML 페이지에 OG·테마 메타 태그가 포함되고 app.js 오타·중복 링크가 없다", async () => {
  for (const file of ["index.html", "account.html", "privacy.html"]) {
    const html = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.ok(html.includes('name="description"'), `${file} missing description`);
    assert.ok(html.includes('property="og:title"'), `${file} missing og:title`);
    assert.ok(html.includes('https://majung.cloud/og-image.png'), `${file} missing og-image.png`);
    assert.ok(html.includes('name="theme-color"'), `${file} missing theme-color`);
  }
  const ogBytes = await readFile(new URL("../og-image.png", import.meta.url));
  assert.ok(ogBytes.length > 1000, "og-image.png should be a valid non-empty PNG");
  const devServer = await readFile(new URL("../dev-server.mjs", import.meta.url), "utf8");
  assert.ok(devServer.includes("og-image.png"), "dev-server.mjs must serve og-image.png");
  const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.ok(!appSource.includes("차량이 차량이"), "duplicate word typo found in app.js");
  assert.ok(!appSource.includes("https://majung.cloud/privacy"), "hardcoded privacy origin in app.js");
});

test("Web CI 워크플로가 commit-style 검사와 dev-server.mjs 구문 검사·og-image 패키징을 포함한다", async () => {
  const workflow = await readFile(new URL("../.github/workflows/web.yml", import.meta.url), "utf8");
  assert.ok(workflow.includes("commit-style:"));
  assert.ok(workflow.includes("lint:commit"));
  assert.ok(workflow.includes("dev-server.mjs"));
  assert.ok(workflow.includes("og-image.png"));
});
