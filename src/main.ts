import "./style.css";
import {
  Color3,
  Color4,
  Engine,
  FreeCamera,
  KeyboardEventTypes,
  MeshBuilder,
  PointerEventTypes,
  Scene,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import raycast from "fast-voxel-raycast";
import { del, get, set } from "idb-keyval";
import sweep from "voxel-aabb-sweep";
import { B, BLOCKS, HOTBAR, solid } from "./blocks";
import { toggleInspector } from "./debug";
import { createSky } from "./sky";
import { createWorld, type Edits } from "./world";

type Save = { seed: string; edits: Edits; feet: number[]; look: number[]; fly: boolean; slot: number };

// Time. The world updates in fixed steps, whatever the display rate.
const STEP = 1 / 60; // seconds per world update
const MAX_STEPS = Math.round(0.25 / STEP); // world updates one drawn frame may catch up on
const SAVE_EVERY = 2000; // milliseconds

// Day and night. A day fraction of 0 is midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset.
const DAY_SECONDS = 480; // one full day and night
const START_DAY_FRACTION = 0.4; // mid morning
const TIMES = ["NIGHT", "DAWN", "DAY", "DUSK"]; // quarter days, centred on midnight, sunrise, noon and sunset

// Body, in blocks.
const HALF = 0.3; // half width
const TALL = 1.8;
const EYE = 1.62; // eye height above the feet

// Feel. Fixed here in code. No key or panel changes these, so edit them here if play calls for it.
const REACH = 6; // blocks, how far the player can break and place
const GHOST_ALPHA = 0.35; // opacity of the place preview, 0 to 1

// Motion, in blocks per second.
const WALK = 4.5;
const SPRINT = 7.5;
const FLY = 16;
const FLY_CLIMB = 12;
const JUMP = 9; // take-off speed
const MAX_FALL = 50;
const GRAVITY = 30; // blocks per second squared

// Input.
const LOOK = 500; // mouse pixels per radian
// The number in `event.button` for a mouse button, to its flag in `event.buttons`.
const BUTTON_BIT = new Map([
  [0, 1], // left
  [2, 2], // right
]);

const saved = await get<Save>("world");
const seed = saved?.seed ?? Math.random().toString(36).slice(2, 10);
const edits: Edits = saved?.edits ?? new Map();

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const debug = document.querySelector("#debug")!;
const hotbar = document.querySelector("#hotbar")!;
const settingsPanel = document.querySelector("#settings")!;
const keysPanel = document.querySelector("#keys")!;

const engine = new Engine(canvas, true);
const scene = new Scene(engine);
// Dev only. The Playwright tests read meshes through this handle.
if (import.meta.env.DEV) Object.assign(globalThis, { scene });
scene.fogMode = Scene.FOGMODE_LINEAR;
scene.skipPointerMovePicking = scene.skipPointerDownPicking = scene.skipPointerUpPicking = true;

// The sky owns the dome, sun, moon, stars, both lights and the fog colour.
const sky = createSky(scene);

const world = createWorld(scene, seed, edits);
const blocked = (x: number, y: number, z: number) => solid(world.get(x, y, z));

const spawn = () => {
  for (let x = 0; x < 100_000; x += 8) {
    const { h, top } = world.column(x, 0);
    const openSky = [...Array(12).keys()].every((dy) => !blocked(x, h + 1 + dy, 0));
    if (top === B.grass && blocked(x, h, 0) && openSky) return [x + 0.5, h + 1, 0.5];
  }
  throw new Error(`No grass to spawn on for seed ${seed}`);
};

const [startX, startY, startZ] = saved?.feet ?? spawn();
const body = {
  base: [startX - HALF, startY, startZ - HALF],
  max: [startX + HALF, startY + TALL, startZ + HALF],
  translate(by: number[]) {
    for (let i = 0; i < 3; i++) {
      this.base[i] += by[i];
      this.max[i] += by[i];
    }
  },
};
const feet = () => [body.base[0] + HALF, body.base[1], body.base[2] + HALF];

const camera = new FreeCamera("eye", Vector3.Zero(), scene);
camera.minZ = 0.05;
camera.maxZ = 200;
camera.fov = 1.2;
camera.inertia = 0;
camera.angularSensibility = LOOK;
camera.rotation.set(saved?.look[0] ?? 0, saved?.look[1] ?? 0, 0);
camera.inputs.removeByType("FreeCameraKeyboardMoveInput");
camera.attachControl(true);

const highlight = MeshBuilder.CreateBox("highlight", { size: 1.004 }, scene);
highlight.material = Object.assign(new StandardMaterial("clear", scene), { alpha: 0 });
highlight.isPickable = false;
highlight.enableEdgesRendering();
highlight.edgesWidth = 3;
highlight.edgesColor = new Color4(0, 0, 0, 0.8);

// Preview of the block a right click would place.
const ghostMaterial = Object.assign(new StandardMaterial("ghost", scene), { alpha: GHOST_ALPHA, specularColor: Color3.Black() });
const ghost = MeshBuilder.CreateBox("ghost", { size: 1 }, scene);
ghost.material = ghostMaterial;
ghost.isPickable = false;

const keys = new Set<string>();
const presses: number[] = []; // mouse buttons pressed and not yet acted on, oldest first
let canPlace = false;
let fly = saved?.fly ?? false;
let slot = saved?.slot ?? 0;
let dayFraction = START_DAY_FRACTION;
let shownTime = -1; // index into TIMES that the settings panel shows
let lag = 0;
let velocityY = 0;
let grounded = false;
let target: number[] | null = null;
let place: number[] = [];
let before = feet();

for (const [i, block] of HOTBAR.entries()) {
  const el = document.createElement("div");
  el.className =
    "grid size-12 place-items-center rounded-lg border-2 border-black/50 text-sm font-bold text-white text-shadow-lg transition data-on:scale-125 data-on:border-white";
  el.style.background = BLOCKS[block].color;
  el.textContent = String(i + 1);
  hotbar.append(el);
}

function select(next: number) {
  slot = next;
  [...hotbar.children].forEach((el, i) => el.toggleAttribute("data-on", i === slot));
  ghostMaterial.diffuseColor = Color3.FromHexString(BLOCKS[HOTBAR[slot]].color);
}
select(slot);

// Which quarter of the day it is, as an index into TIMES.
const timeIndex = () => Math.floor(((dayFraction + 0.5 / TIMES.length) % 1) * TIMES.length);

// Text helpers for the monospace panels.
const table = (rows: string[][]) =>
  rows
    .map((row) => row.map((cell, i) => cell.padEnd(Math.max(...rows.map((r) => r[i].length)))).join("  ").trimEnd())
    .join("\n");
const marked = (all: readonly string[], current: string) =>
  all.map((option) => (option === current ? `[${option}]` : option)).join(" ");

// The right side always shows what can be changed and which keys work right now.
// A setting lists all its options with the current one in brackets. Its key steps to the next option.
function showPanels() {
  const locked = document.pointerLockElement === canvas;
  shownTime = timeIndex();
  const settingRows = [
    ["F", "Movement", marked(["WALK", "FLY"], fly ? "FLY" : "WALK")],
    ["T", "Time", marked(TIMES, TIMES[shownTime])],
  ];
  const moveRows = fly ? [["Space", "rise"], ["Shift", "sink"]] : [["Space", "jump"], ["Shift", "sprint"]];
  const mouseRows = locked ? [["LMB", "break"], ["RMB", "place"], ["Esc", "release mouse"]] : [["Click", "capture mouse"]];
  const devRows = import.meta.env.DEV ? [["I", "inspector"]] : [];
  const keyRows = [["W A S D", "move"], ...moveRows, ...mouseRows, ["1-9", "pick block"], ["Shift+N", "new world"], ...devRows];
  settingsPanel.textContent = `SETTINGS\n${table(settingRows)}`;
  keysPanel.textContent = `KEYS\n${table(keyRows)}`;
}
showPanels();
document.addEventListener("pointerlockchange", showPanels);

const autosave = setInterval(() => {
  const save: Save = { seed, edits, feet: feet(), look: [camera.rotation.x, camera.rotation.y], fly, slot };
  void set("world", save);
}, SAVE_EVERY);

// All input comes through Babylon's observables.
scene.onKeyboardObservable.add(({ type, event }) => {
  if (type === KeyboardEventTypes.KEYUP) return void keys.delete(event.code);
  if (keys.has(event.code)) return;
  keys.add(event.code);
  if (event.code === "KeyF") fly = !fly;
  if (event.code === "KeyT") dayFraction = ((timeIndex() + 1) % TIMES.length) / TIMES.length;
  if (event.code === "KeyI") void toggleInspector(scene);
  if (/^Digit[1-9]$/.test(event.code)) select(Number(event.code[5]) - 1);
  if (event.code === "KeyN" && event.shiftKey) {
    clearInterval(autosave);
    void del("world").then(() => location.reload());
  }
  showPanels();
});

scene.onPointerObservable.add(({ type, event }) => {
  if (type !== PointerEventTypes.POINTERDOWN) return;
  if (document.pointerLockElement !== canvas) return void canvas.requestPointerLock();
  // After a blur during a two-button hold, Babylon reports the release as a press. A real press has its flag set.
  if (event.buttons & (BUTTON_BIT.get(event.button) ?? 0)) presses.push(event.button);
});

// Babylon's blur events carry no key code, so held input is dropped here.
engine.onCanvasBlurObservable.add(() => {
  keys.clear();
  presses.length = 0;
});

addEventListener("resize", () => engine.resize());
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.focus();

const axis = (plus: string, minus: string) => Number(keys.has(plus)) - Number(keys.has(minus));

function move() {
  const yaw = camera.rotation.y;
  const forward = axis("KeyW", "KeyS");
  const strafe = axis("KeyD", "KeyA");
  const speed = ((fly ? FLY : keys.has("ShiftLeft") ? SPRINT : WALK) * STEP) / (Math.hypot(forward, strafe) || 1);
  if (fly) velocityY = axis("Space", "ShiftLeft") * FLY_CLIMB;
  else velocityY = grounded && keys.has("Space") ? JUMP : Math.max(velocityY - GRAVITY * STEP, -MAX_FALL);
  grounded = false;
  const step = [
    (Math.sin(yaw) * forward + Math.cos(yaw) * strafe) * speed,
    velocityY * STEP,
    (Math.cos(yaw) * forward - Math.sin(yaw) * strafe) * speed,
  ];
  sweep(blocked, body, step, (_dist, side, dir, left) => {
    left[side] = 0;
    if (side !== 1) return;
    velocityY = 0;
    grounded = dir < 0;
  });
}

function aim() {
  const point: number[] = [];
  const normal: number[] = [];
  const [x, y, z] = feet();
  const direction = camera.getDirection(Vector3.Forward()).asArray();
  const hit = raycast(blocked, [x, y + EYE, z], direction, REACH, point, normal);
  target = hit ? point.map((p, i) => Math.floor(p - normal[i] / 2)) : null;
  canPlace = false;
  if (target) {
    place = target.map((t, i) => t + normal[i]);
    canPlace = !place.every((p, i) => p < body.max[i] && p + 1 > body.base[i]);
    highlight.position.set(target[0] + 0.5, target[1] + 0.5, target[2] + 0.5);
    ghost.position.set(place[0] + 0.5, place[1] + 0.5, place[2] + 0.5);
  }
  highlight.setEnabled(!!target);
  ghost.setEnabled(canPlace);
}

// One press, one action. Holding a button does nothing more.
// A press waits in the queue until the next world update, even when the release came first.
// One press is taken per update, so the aim is fresh for each.
function act() {
  const button = presses.shift();
  if (button === undefined || !target) return;
  if (button === 0) world.set(target, B.air);
  if (button === 2 && canPlace) world.set(place, HOTBAR[slot]);
}

// One world update. Runs at a fixed rate.
function tick() {
  before = feet();
  if (world.ready(before[0], before[2])) move();
  aim();
  act();
  dayFraction = (dayFraction + STEP / DAY_SECONDS) % 1;
}

// One drawn frame. Runs as many world updates as real time calls for, then blends the camera between the last two.
// Chunk building is heavy, so it runs once per frame at most, and only when a world update is due.
scene.onBeforeRenderObservable.add(() => {
  lag = Math.min(lag + engine.getDeltaTime() / 1000, MAX_STEPS * STEP);
  if (lag >= STEP) world.stream(body.base[0], body.base[2]);
  for (; lag >= STEP; lag -= STEP) tick();
  sky.update(dayFraction);
  if (timeIndex() !== shownTime) showPanels();
  const now = feet();
  Vector3.LerpToRef(Vector3.FromArray(before), Vector3.FromArray(now), lag / STEP, camera.position);
  camera.position.y += EYE;
  const cell = now.map(Math.floor);
  debug.textContent = [
    `${engine.getFps().toFixed()} fps`,
    `xyz ${cell.join(" ")}`,
    world.column(cell[0], cell[2]).biome,
    `${world.size()} chunks`,
    `seed ${seed}`,
  ].join("\n");
});

engine.runRenderLoop(() => scene.render());
