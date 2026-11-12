import { expect, test } from "@playwright/test";

const SEED = "6b0h3zeb";
const MIN_CHUNKS = 20; // loaded chunks that count as a streamed world

test("the world loads, streams chunks and toggles fly", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });

  // Headless Chrome grants no pointer lock, so the test fakes the grant.
  await page.addInitScript(() => {
    let locked: Element | null = null;
    Object.defineProperty(Document.prototype, "pointerLockElement", { get: () => locked });
    Element.prototype.requestPointerLock = function () {
      locked = this;
      document.dispatchEvent(new Event("pointerlockchange"));
      return Promise.resolve();
    };
  });

  // Fixed seed: write a save into the idb-keyval store, then reload into it.
  await page.goto("/");
  await page.evaluate(
    (seed) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("keyval-store");
        open.onupgradeneeded = () => open.result.createObjectStore("keyval");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction("keyval", "readwrite");
          tx.objectStore("keyval").put({ seed, edits: new Map(), look: [0, 0], fly: false, slot: 0 }, "world");
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
    SEED,
  );
  await page.reload();

  const debug = page.locator("#debug");
  await expect(debug).toContainText(`seed ${SEED}`);
  await expect
    .poll(async () => Number(/(\d+) chunks/.exec(await debug.innerText())?.[1]), { timeout: 30_000 })
    .toBeGreaterThan(MIN_CHUNKS);
  await expect(page.locator("#hotbar > *").first()).toBeVisible();

  await expect(debug).toContainText("walk");
  await page.keyboard.press("KeyF");
  await expect(debug).toContainText("fly");

  expect(problems).toEqual([]);
});
