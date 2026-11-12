import "./style.css";
import {
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  FreeCamera,
  HemisphericLight,
  KeyboardEventTypes,
  MeshBuilder,
  PointerEventTypes,
  PointerInput,
  Scene,
  StandardMaterial,
  Vector3,
  type IWheelEvent,
} from "@babylonjs/core";
import raycast from "fast-voxel-raycast";
import { del, get, set } from "idb-keyval";
import normalizeWheel from "normalize-wheel-es";
import sweep from "voxel-aabb-sweep";
import { B, BLOCKS, HOTBAR, solid } from "./blocks";
import { createWorld, type Edits } from "./world";

type Save = { seed: string; edits: Edits; feet: number[]; look: number[]; fly: boolean; slot: number };

// Time. The world updates in fixed steps, whatever the display rate.
const STEP = 1 / 60; // seconds per world update
const MAX_STEPS = Math.round(0.25 / STEP); // world updates one drawn frame may catch up on
const REPEAT = Math.round(0.18 / STEP); // world updates between repeated break or place
const SAVE_EVERY = 2000; // milliseconds

// Body, in blocks.
const HALF = 0.3; // half width
const TALL = 1.8;
const EYE = 1.62; // eye height above the feet
const REACHES = [4, 6, 8, 10]; // how far the player can break and place

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
const NOTCH = 100; // wheel pixels per hotbar slot
const LEADER = "Backquote"; // press it, then a tuning key
const TUNE_SHOWN = 1500; // milliseconds the tuning panel stays after a change
const GHOST_ALPHA = 0.35;

const saved = await get<Save>("world");
const seed = saved?.seed ?? Math.random().toString(36).slice(2, 10);
const edits: Edits = saved?.edits ?? new Map();

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const debug = document.querySelector("#debug")!;
const hotbar = document.querySelector("#hotbar")!;
const tune = document.querySelector<HTMLElement>("#tune")!;

const engine = new Engine(canvas, true);
const scene = new Scene(engine);
const sky = Color3.FromHexString("#a9d4f5");
scene.clearColor = sky.toColor4();
scene.fogMode = Scene.FOGMODE_LINEAR;
scene.fogColor = sky;
scene.skipPointerMovePicking = scene.skipPointerDownPicking = scene.skipPointerUpPicking = true;

const ambient = new HemisphericLight("ambient", Vector3.Up(), scene);
ambient.intensity = 0.6;
ambient.groundColor = new Color3(0.5, 0.5, 0.55);
new DirectionalLight("sun", new Vector3(-0.5, -1, -0.3), scene).intensity = 0.45;

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

// Feel settings, switched in play with the leader key so choices are made by playing.
const tuning = { breakRepeats: true, placeRepeats: true, reach: REACHES[1] };
const tuningKeys: Record<string, () => void> = {
  KeyB: () => (tuning.breakRepeats = !tuning.breakRepeats),
  KeyP: () => (tuning.placeRepeats = !tuning.placeRepeats),
  KeyR: () => (tuning.reach = REACHES[(REACHES.indexOf(tuning.reach) + 1) % REACHES.length]),
};

const keys = new Set<string>();
let leading = false;
let tuneTimer = 0;
let canPlace = false;
let fly = saved?.fly ?? false;
let slot = saved?.slot ?? 0;
let held = -1;
let ticks = 0;
let nextAct = 0;
let spin = 0;
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

// Shows the tuning keys and their current values. Stays while the leader is pending, then fades out.
function showTuning(pending: boolean) {
  const mode = (repeats: boolean) => (repeats ? "repeat on hold" : "one per click");
  tune.textContent = [
    `B  break  ${mode(tuning.breakRepeats)}`,
    `P  place  ${mode(tuning.placeRepeats)}`,
    `R  reach  ${tuning.reach} blocks`,
  ].join("\n");
  tune.hidden = false;
  clearTimeout(tuneTimer);
  if (!pending) tuneTimer = setTimeout(() => (tune.hidden = true), TUNE_SHOWN);
}

const autosave = setInterval(() => {
  const save: Save = { seed, edits, feet: feet(), look: [camera.rotation.x, camera.rotation.y], fly, slot };
  void set("world", save);
}, SAVE_EVERY);

// All input comes through Babylon's observables.
scene.onKeyboardObservable.add(({ type, event }) => {
  if (type === KeyboardEventTypes.KEYUP) return void keys.delete(event.code);
  if (keys.has(event.code)) return;
  keys.add(event.code);
  if (leading || event.code === LEADER) {
    if (leading) tuningKeys[event.code]?.();
    leading = !leading;
    return showTuning(leading);
  }
  if (event.code === "KeyF") fly = !fly;
  if (/^Digit[1-9]$/.test(event.code)) select(Number(event.code[5]) - 1);
  if (event.code === "KeyN" && event.shiftKey) {
    clearInterval(autosave);
    void del("world").then(() => location.reload());
  }
});

scene.onPointerObservable.add(({ type, event }) => {
  if (type === PointerEventTypes.POINTERWHEEL) scroll(event as IWheelEvent);
  if (type === PointerEventTypes.POINTERUP) held = event.buttons & 1 ? 0 : event.buttons & 2 ? 2 : -1;
  if (type !== PointerEventTypes.POINTERDOWN) return;
  if (document.pointerLockElement !== canvas) return void canvas.requestPointerLock();
  held = event.button;
  nextAct = 0;
});

// Babylon's blur events carry no key code, so held input is dropped here.
engine.onCanvasBlurObservable.add(() => {
  keys.clear();
  held = -1;
});

// One hotbar slot per wheel notch. Small steps from smooth wheels and trackpads add up to a notch.
function scroll(event: IWheelEvent) {
  const { pixelX, pixelY } = normalizeWheel(event as unknown as WheelEvent);
  if (event.inputIndex === PointerInput.MouseWheelY) spin += pixelY;
  if (event.inputIndex === PointerInput.MouseWheelX) spin += pixelX;
  const notches = Math.trunc(spin / NOTCH);
  spin -= notches * NOTCH;
  if (notches) select((((slot + notches) % HOTBAR.length) + HOTBAR.length) % HOTBAR.length);
}

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
  const hit = raycast(blocked, [x, y + EYE, z], direction, tuning.reach, point, normal);
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

function act() {
  if (held < 0 || !target || ticks < nextAct) return;
  const repeats = held === 0 ? tuning.breakRepeats : tuning.placeRepeats;
  nextAct = repeats ? ticks + REPEAT : Infinity;
  if (held === 0) world.set(target, B.air);
  if (held === 2 && canPlace) world.set(place, HOTBAR[slot]);
}

// One world update. Runs at a fixed rate.
function tick() {
  before = feet();
  if (world.ready(before[0], before[2])) move();
  aim();
  act();
  ticks++;
}

// One drawn frame. Runs as many world updates as real time calls for, then blends the camera between the last two.
// Chunk building is heavy, so it runs once per frame at most, and only when a world update is due.
scene.onBeforeRenderObservable.add(() => {
  lag = Math.min(lag + engine.getDeltaTime() / 1000, MAX_STEPS * STEP);
  if (lag >= STEP) world.stream(body.base[0], body.base[2]);
  for (; lag >= STEP; lag -= STEP) tick();
  const now = feet();
  Vector3.LerpToRef(Vector3.FromArray(before), Vector3.FromArray(now), lag / STEP, camera.position);
  camera.position.y += EYE;
  const cell = now.map(Math.floor);
  debug.textContent = [
    `${engine.getFps().toFixed()} fps`,
    `xyz ${cell.join(" ")}`,
    world.column(cell[0], cell[2]).biome,
    `${world.size()} chunks`,
    fly ? "fly" : "walk",
    `seed ${seed}`,
  ].join("\n");
});

engine.runRenderLoop(() => scene.render());
