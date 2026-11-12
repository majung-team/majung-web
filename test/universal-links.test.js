import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

test("AASA 파일이 올바른 applinks 구성을 포함한다", () => {
  const aasa = JSON.parse(
    fs.readFileSync(
      path.join(root, ".well-known", "apple-app-site-association"),
      "utf8",
    ),
  );
  const details = aasa?.applinks?.details;
  assert.ok(Array.isArray(details) && details.length === 1);
  assert.deepEqual(details[0].appIDs, ["K2G6G3ZNZQ.app.majung.ios"]);
  assert.deepEqual(details[0].components, [
    { "/": "/", "#": "join/*" },
    { "/": "/", "#": "vehicle/*" },
    { "/": "/", "#": "enroll/*" },
    { "/": "/account", "#": "vehicle/*" },
    { "/": "/account", "#": "enroll/*" },
  ]);
});

test("Caddyfile과 워크플로가 AASA 서빙과 패키징을 포함한다", () => {
  const caddyfile = fs.readFileSync(
    path.join(root, "deploy", "Caddyfile"),
    "utf8",
  );
  assert.match(
    caddyfile,
    /handle \/\.well-known\/apple-app-site-association[\s\S]*?header Content-Type application\/json/,
  );

  const workflow = fs.readFileSync(
    path.join(root, ".github", "workflows", "web.yml"),
    "utf8",
  );
  assert.match(workflow, /\.well-known\/apple-app-site-association/);
});
