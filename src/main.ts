import "./style.css";
import {
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  FreeCamera,
  HemisphericLight,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import raycast from "fast-voxel-raycast";
import { del, get, set } from "idb-keyval";
import sweep from "voxel-aabb-sweep";
import { B, BLOCKS, HOTBAR, solid } from "./blocks";
import { createWorld, type Edits } from "./world";

type Save = { seed: string; edits: Edits; feet: number[]; look: number[]; fly: boolean; slot: number };

const REACH = 6;
const HALF = 0.3;
const TALL = 1.8;
const EYE = 1.62;

const saved = await get<Save>("world");
const seed = saved?.seed ?? Math.random().toString(36).slice(2, 10);
const edits: Edits = saved?.edits ?? new Map();

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const debug = document.querySelector("#debug")!;
const hotbar = document.querySelector("#hotbar")!;

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
camera.angularSensibility = 500;
camera.rotation.set(saved?.look[0] ?? 0, saved?.look[1] ?? 0, 0);
camera.inputs.removeByType("FreeCameraKeyboardMoveInput");
camera.attachControl(true);

const highlight = MeshBuilder.CreateBox("highlight", { size: 1.004 }, scene);
highlight.material = Object.assign(new StandardMaterial("clear", scene), { alpha: 0 });
highlight.isPickable = false;
highlight.enableEdgesRendering();
highlight.edgesWidth = 3;
highlight.edgesColor = new Color4(0, 0, 0, 0.8);

const keys = new Set<string>();
let fly = saved?.fly ?? false;
let slot = saved?.slot ?? 0;
let held = -1;
let cooldown = 0;
let velocityY = 0;
let grounded = false;
let target: number[] | null = null;
let place: number[] = [];

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
}
select(slot);

const autosave = setInterval(() => {
  const save: Save = { seed, edits, feet: feet(), look: [camera.rotation.x, camera.rotation.y], fly, slot };
  void set("world", save);
}, 2000);

addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (e.repeat) return;
  if (e.code === "KeyF") fly = !fly;
  if (/^Digit[1-9]$/.test(e.code)) select(Number(e.code[5]) - 1);
  if (e.code === "KeyN" && e.shiftKey) {
    clearInterval(autosave);
    void del("world").then(() => location.reload());
  }
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("pointerup", () => (held = -1));
addEventListener("blur", () => {
  keys.clear();
  held = -1;
});
addEventListener("resize", () => engine.resize());
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("wheel", (e) => select((slot + Math.sign(e.deltaY) + HOTBAR.length) % HOTBAR.length));
canvas.addEventListener("pointerdown", (e) => {
  if (document.pointerLockElement !== canvas) return void canvas.requestPointerLock();
  held = e.button;
  cooldown = 0;
});

const axis = (plus: string, minus: string) => Number(keys.has(plus)) - Number(keys.has(minus));

function move(dt: number) {
  const yaw = camera.rotation.y;
  const forward = axis("KeyW", "KeyS");
  const strafe = axis("KeyD", "KeyA");
  const speed = ((fly ? 16 : keys.has("ShiftLeft") ? 7.5 : 4.5) * dt) / (Math.hypot(forward, strafe) || 1);
  if (fly) velocityY = axis("Space", "ShiftLeft") * 12;
  else velocityY = grounded && keys.has("Space") ? 9 : Math.max(velocityY - 30 * dt, -50);
  grounded = false;
  const step = [
    (Math.sin(yaw) * forward + Math.cos(yaw) * strafe) * speed,
    velocityY * dt,
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
  const direction = camera.getDirection(Vector3.Forward()).asArray();
  const hit = raycast(blocked, camera.position.asArray(), direction, REACH, point, normal);
  target = hit ? point.map((p, i) => Math.floor(p - normal[i] / 2)) : null;
  highlight.setEnabled(!!target);
  if (!target) return;
  place = target.map((t, i) => t + normal[i]);
  highlight.position.set(target[0] + 0.5, target[1] + 0.5, target[2] + 0.5);
}

function act(now: number) {
  if (held < 0 || !target || now < cooldown) return;
  cooldown = now + 180;
  const insideBody = place.every((p, i) => p < body.max[i] && p + 1 > body.base[i]);
  if (held === 0) world.set(target, B.air);
  if (held === 2 && !insideBody) world.set(place, HOTBAR[slot]);
}

scene.onBeforeRenderObservable.add(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
  world.stream(body.base[0], body.base[2]);
  if (world.ready(body.base[0], body.base[2])) move(dt);
  const [x, y, z] = feet();
  camera.position.set(x, y + EYE, z);
  aim();
  act(performance.now());
  const cell = [x, y, z].map(Math.floor);
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
