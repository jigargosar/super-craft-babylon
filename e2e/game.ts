import type { Scene, StandardMaterial } from "@babylonjs/core";
import { expect, test as base, type Locator, type Page } from "@playwright/test";
import { B } from "../src/blocks";

// Mirrors of values in src/main.ts. A drift shows up as a failing test.
export const SEED = "6b0h3zeb";
export const REACH = 6; // blocks
export const EYE = 1.62; // blocks above the feet
const SAVE_EVERY_MS = 2000;

const MIN_CHUNKS = 20; // loaded chunks that count as a streamed world
const LOAD_TIMEOUT_MS = 30_000;
const STILL_POLL_MS = 250;
const SAVE_MARGIN_MS = 600;
const SEED_PAGE = "/seed-page"; // blank page on the game's origin, where the save is written before the game runs
const COLUMN_GAP = /\s{2,}/; // the text panels pad their columns with two or more spaces

export type Start = {
  look?: [pitch: number, yaw: number];
  fly?: boolean;
  slot?: number;
  feet?: [x: number, y: number, z: number]; // the spawn point when left out
};
type Save = Start & { seed: string };
type Button = "left" | "right";

// Looks, in radians. A positive pitch looks down.
export const AHEAD_AND_DOWN: Start = { look: [0.48, 0] }; // the ground about three blocks ahead
export const STRAIGHT_DOWN: Start = { look: [Math.PI / 2, 0] };
export const STRAIGHT_UP: Start = { look: [-Math.PI / 2, 0] };

// Headless Chrome grants no pointer lock, so the page fakes the grant and the release.
const fakePointerLock = () => {
  let locked: Element | null = null;
  const change = (element: Element | null) => {
    locked = element;
    document.dispatchEvent(new Event("pointerlockchange"));
  };
  Object.defineProperty(Document.prototype, "pointerLockElement", { get: () => locked });
  Element.prototype.requestPointerLock = function () {
    change(this);
    return Promise.resolve();
  };
  Document.prototype.exitPointerLock = () => change(null);
};

// The game keeps its save in the idb-keyval default store.
const writeSave = (save: Save) =>
  new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("keyval-store");
    open.onupgradeneeded = () => open.result.createObjectStore("keyval");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction("keyval", "readwrite");
      tx.objectStore("keyval").put({ ...save, edits: new Map() }, "world");
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => {
        open.result.close();
        resolve();
      };
    };
  });

// A Map does not survive page.evaluate, so the edits are flattened to block ids inside the page.
const readEditedBlocks = () =>
  new Promise<number[]>((resolve, reject) => {
    const open = indexedDB.open("keyval-store");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const get = open.result.transaction("keyval").objectStore("keyval").get("world");
      get.onerror = () => reject(get.error);
      get.onsuccess = () => {
        open.result.close();
        const edits: Map<string, Map<number, number>> = get.result.edits;
        resolve([...edits.values()].flatMap((cells) => [...cells.values()]));
      };
    };
  });

// Reads a mesh through the `scene` global that src/main.ts sets on the dev server.
const readMesh = (name: string) => {
  const { scene } = globalThis as unknown as { scene?: Scene };
  if (!scene) throw new Error("No scene global. It exists only on the dev server.");
  const mesh = scene.getMeshByName(name);
  if (!mesh) throw new Error(`No mesh named ${name}`);
  const material = mesh.material as StandardMaterial;
  const HALF_CELL = 0.5; // a block mesh is centred on its cell
  return {
    shown: mesh.isEnabled(),
    cell: mesh.position.asArray().map((p) => p - HALF_CELL),
    colour: material.diffuseColor.toHexString().toLowerCase(),
    alpha: material.alpha,
  };
};

export class Game {
  readonly debug: Locator;
  readonly settings: Locator;
  readonly keys: Locator;

  constructor(readonly page: Page) {
    this.debug = page.locator("#debug");
    this.settings = page.locator("#settings");
    this.keys = page.locator("#keys");
  }

  // Loads the fixed world and waits for chunks and a resting player. The mouse is not captured yet.
  async load({ look = [0, 0], fly = false, slot = 0, feet }: Start = {}) {
    const { page } = this;
    await page.goto(SEED_PAGE);
    await page.evaluate(writeSave, { seed: SEED, look, fly, slot, feet });
    await page.goto("/");
    await expect(this.debug).toContainText(`seed ${SEED}`);
    await expect.poll(() => this.chunks(), { timeout: LOAD_TIMEOUT_MS }).toBeGreaterThan(MIN_CHUNKS);
    await this.still();
  }

  // Loads the fixed world, then captures the mouse, so the next click is an action.
  async start(start: Start = {}) {
    await this.load(start);
    await this.click("left");
    await expect.poll(() => this.locked()).toBe(true);
  }

  locked() {
    return this.page.evaluate(() => document.pointerLockElement?.id === "game");
  }

  async releasePointer() {
    await this.page.evaluate(() => document.exitPointerLock());
  }

  private async debugValue(pattern: RegExp) {
    return pattern.exec((await this.debug.textContent()) ?? "")?.[1];
  }

  async chunks() {
    return Number(await this.debugValue(/^(\d+) chunks$/m));
  }

  // The block cell the feet are in.
  async cell() {
    const text = await this.debugValue(/^xyz (.+)$/m);
    if (!text) throw new Error("The debug panel has no xyz line");
    return text.split(" ").map(Number);
  }

  // Resolves once the feet cell is the same on two reads in a row.
  async still() {
    let last = "";
    await expect
      .poll(
        async () => {
          const now = String(await this.cell());
          const same = now === last;
          last = now;
          return same;
        },
        { intervals: [STILL_POLL_MS] },
      )
      .toBe(true);
  }

  // A text panel as its heading and its rows of cells.
  async panel(panel: Locator) {
    const [heading, ...lines] = ((await panel.textContent()) ?? "").split("\n");
    return { heading, rows: lines.map((line) => line.split(COLUMN_GAP)) };
  }

  // The option in brackets on the Movement row of the settings panel.
  async movement() {
    const { rows } = await this.panel(this.settings);
    const options = rows.find(([, name]) => name === "Movement")?.[2] ?? "";
    return /\[(\w+)\]/.exec(options)?.[1];
  }

  // State of a named Babylon mesh, such as "ghost" or "highlight".
  async mesh(name: string) {
    return this.page.evaluate(readMesh, name);
  }

  // A press and release at the crosshair with no time in between.
  async click(button: Button) {
    const { width, height } = this.page.viewportSize()!;
    await this.page.mouse.click(width / 2, height / 2, { button });
  }

  async hold(button: Button, ms: number) {
    await this.page.mouse.down({ button });
    await this.page.waitForTimeout(ms);
    await this.page.mouse.up({ button });
  }

  // Counts of edited cells in the next autosave. Call after the input has ended.
  async savedEdits() {
    await this.page.waitForTimeout(SAVE_EVERY_MS + SAVE_MARGIN_MS);
    const blocks = await this.page.evaluate(readEditedBlocks);
    const broken = blocks.filter((block) => block === B.air).length;
    return { broken, placed: blocks.length - broken };
  }
}

export const test = base.extend<{ game: Game }>({
  game: async ({ page }, use) => {
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(`console: ${message.text()}`);
    });
    await page.addInitScript(fakePointerLock);
    await page.route(`**${SEED_PAGE}`, (route) => route.fulfill({ contentType: "text/html", body: "" }));
    await use(new Game(page));
    expect(problems).toEqual([]);
  },
});

export { expect };
