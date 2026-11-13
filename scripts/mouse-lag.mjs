// Mouse-to-frame latency on the real GPU, in headless Chrome, against the dev server.
// For each injected mouse move it records three times from the moment the event was created:
// handled by the page, camera turned in a render, GPU finished that frame.
// Usage: pnpm lag [label] [off]   off is the ?off= list from src/off.ts, such as shadows,glow
import puppeteer from "puppeteer-core";

const URL_BASE = "http://localhost:5173";
const SEED = "6b0h3zeb";
const VIEWPORT = { width: 1280, height: 720 };
const LOAD_TIMEOUT_MS = 60_000;
const SETTLE_MS = 2000; // the chunk count must hold this long
const CHUNK_POLL_MS = 250;
const WARM_MS = 1000;
const MOVES = 120;
const MOVE_GAP_MS = 33;
const MOVE_PX = 4;
const AFTER_MOVES_MS = 500;
const GPU_POLL_MS = 1;
const P95 = 0.95;

const [label = "", off = ""] = process.argv.slice(2);
const log = (...a) => console.log(`[${label || "now"}${off ? ` off=${off}` : ""}]`, ...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
});
try {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  page.on("console", (m) => ["error", "warn"].includes(m.type()) && log(`console.${m.type()}: ${m.text()} ${m.location()?.url ?? ""}`));
  page.on("pageerror", (e) => log(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => log(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  page.on("response", (r) => r.status() >= 400 && log(`http ${r.status()}: ${r.url()}`));

  // A blank page on the game's origin, where the save is written before the game runs.
  await page.setRequestInterception(true);
  page.on("request", (r) => (r.url().endsWith("/seed-page") ? r.respond({ contentType: "text/html", body: "" }) : r.continue()));

  // Headless Chrome grants no pointer lock, so the page fakes it. Mouse moves are time-stamped as they arrive.
  await page.evaluateOnNewDocument(() => {
    let locked = null;
    Object.defineProperty(Document.prototype, "pointerLockElement", { get: () => locked });
    Element.prototype.requestPointerLock = function () {
      locked = this;
      document.dispatchEvent(new Event("pointerlockchange"));
      return Promise.resolve();
    };
    globalThis.moves = [];
    addEventListener("mousemove", (e) => globalThis.moves.push({ created: e.timeStamp, handled: performance.now() }), true);
  });

  await page.goto(`${URL_BASE}/seed-page`);
  await page.evaluate(
    (seed) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("keyval-store");
        open.onupgradeneeded = () => open.result.createObjectStore("keyval");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction("keyval", "readwrite");
          tx.objectStore("keyval").put({ seed, edits: new Map(), look: [0.15, 0.8], fly: false, slot: 0 }, "world");
          tx.oncomplete = () => (open.result.close(), resolve());
          tx.onerror = () => reject(tx.error);
        };
      }),
    SEED,
  );
  await page.goto(`${URL_BASE}/?off=${off}`);
  await page.waitForFunction(() => globalThis.scene, { timeout: LOAD_TIMEOUT_MS });
  log("renderer", await page.evaluate(() => globalThis.scene.getEngine().getGlInfo().renderer));

  const start = Date.now();
  let last = -1;
  let since = Date.now();
  for (;;) {
    const n = Number(/(\d+) chunks/.exec(await page.$eval("#debug", (el) => el.textContent))?.[1]);
    if (n !== last) (last = n), (since = Date.now());
    if (n > 0 && Date.now() - since > SETTLE_MS) break;
    if (Date.now() - start > LOAD_TIMEOUT_MS) throw new Error(`Chunks never settled. Last count ${last}`);
    await wait(CHUNK_POLL_MS);
  }
  log(`settled at ${last} chunks`);

  // Each render that turned the camera records its end time and a GPU fence. Polling the fence gives GPU-done time.
  await page.evaluate((pollMs) => {
    const s = globalThis.scene;
    const gl = s.getEngine()._gl;
    const camera = s.activeCamera;
    let yaw = camera.rotation.y;
    globalThis.turns = [];
    globalThis.frames = [];
    let prev = performance.now();
    s.onAfterRenderObservable.add(() => {
      const now = performance.now();
      globalThis.frames.push(now - prev);
      prev = now;
      if (camera.rotation.y === yaw) return;
      yaw = camera.rotation.y;
      const turn = { rendered: now, gpuDone: NaN };
      globalThis.turns.push(turn);
      const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED) return void setTimeout(poll, pollMs);
        turn.gpuDone = performance.now();
        gl.deleteSync(fence);
      };
      setTimeout(poll, pollMs);
    });
  }, GPU_POLL_MS);

  const cx = VIEWPORT.width / 2;
  const cy = VIEWPORT.height / 2;
  await page.mouse.click(cx, cy); // takes the fake lock. No block action without the lock.
  await wait(WARM_MS);
  await page.evaluate(() => {
    globalThis.moves.length = 0;
    globalThis.turns.length = 0;
    globalThis.frames.length = 0;
  });

  for (let i = 0; i < MOVES; i++) {
    await page.mouse.move(cx + (i % 2 ? MOVE_PX : -MOVE_PX), cy);
    await wait(MOVE_GAP_MS);
  }
  await wait(AFTER_MOVES_MS);

  const r = await page.evaluate(() => {
    const { moves, turns, frames } = globalThis;
    const rows = moves.map((m) => {
      const turn = turns.find((t) => t.rendered >= m.handled);
      return turn ? { queue: m.handled - m.created, toRender: turn.rendered - m.created, toGpu: turn.gpuDone - m.created } : null;
    });
    return { rows: rows.filter(Boolean), missed: rows.filter((x) => !x).length, frames, turns: turns.length };
  });
  const sorted = (values) => values.filter(Number.isFinite).sort((a, b) => a - b);
  const summary = (s) => {
    const mean = s.reduce((a, b) => a + b, 0) / s.length;
    return `mean ${mean.toFixed(1)} p95 ${s[Math.floor(s.length * P95)].toFixed(1)} max ${s.at(-1).toFixed(1)}`;
  };
  const stat = (k) => `${k} ${summary(sorted(r.rows.map((x) => x[k])))}`;
  const f = sorted(r.frames);
  log(`moves ${r.rows.length} missed ${r.missed} turns ${r.turns}`);
  log(`ms from mouse event: ${stat("queue")} | ${stat("toRender")} | ${stat("toGpu")}`);
  log(`frame interval ms: ${summary(f)} (${(1000 / (f.reduce((a, b) => a + b, 0) / f.length)).toFixed(0)} fps)`);
} finally {
  await browser.close();
}
