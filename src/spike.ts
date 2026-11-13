// Spike: the least scene that has the game's mouse look. One flat 16 x 16 chunk, a few boxes, one light.
// No shadows, post-processing, glow, sky, textures, streaming or physics. Open /spike.html.
import { Color3, Engine, FreeCamera, HemisphericLight, MeshBuilder, PointerEventTypes, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";

const CHUNK_BLOCKS = 16;
const EYE = 1.62; // blocks above the ground
const LOOK = 500; // mouse pixels per radian, as in the game
const PILLAR_EVERY = 4; // blocks between reference pillars
const PILLAR_TALL = 3; // blocks

const canvas = document.querySelector<HTMLCanvasElement>("#spike")!;
const info = document.querySelector("#info")!;
const engine = new Engine(canvas, true);
const scene = new Scene(engine);

const camera = new FreeCamera("eye", new Vector3(CHUNK_BLOCKS / 2, EYE, CHUNK_BLOCKS / 2), scene);
camera.inertia = 0;
camera.angularSensibility = LOOK;
camera.inputs.removeByType("FreeCameraKeyboardMoveInput");
camera.attachControl(true);

new HemisphericLight("sky", Vector3.Up(), scene);

const ground = MeshBuilder.CreateBox("ground", { width: CHUNK_BLOCKS, height: 1, depth: CHUNK_BLOCKS }, scene);
ground.position.set(CHUNK_BLOCKS / 2, -0.5, CHUNK_BLOCKS / 2);
ground.material = Object.assign(new StandardMaterial("grass", scene), { diffuseColor: Color3.FromHexString("#6fb04a") });

// Pillars around the edge, so turning the view is easy to see.
const stone = Object.assign(new StandardMaterial("stone", scene), { diffuseColor: Color3.FromHexString("#8d9199") });
for (let i = 0; i <= CHUNK_BLOCKS; i += PILLAR_EVERY)
  for (const [x, z] of [[i, 0], [i, CHUNK_BLOCKS], [0, i], [CHUNK_BLOCKS, i]]) {
    const pillar = MeshBuilder.CreateBox("pillar", { width: 1, height: PILLAR_TALL, depth: 1 }, scene);
    pillar.position.set(x, PILLAR_TALL / 2, z);
    pillar.material = stone;
  }

scene.onPointerObservable.add(({ type }) => {
  if (type === PointerEventTypes.POINTERDOWN && document.pointerLockElement !== canvas) void canvas.requestPointerLock();
});
addEventListener("resize", () => engine.resize());

scene.onBeforeRenderObservable.add(() => {
  info.textContent = `${engine.getFps().toFixed()} fps\nclick to capture the mouse, Esc to release`;
});
engine.runRenderLoop(() => scene.render());
