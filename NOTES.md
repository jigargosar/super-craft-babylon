# Working notes

Things learned while building the demo that live nowhere else. Written 2026-11-12.

## State

- Build-order steps 1 to 3 are built and committed.
- `SPEC.md` holds uncommitted edits made on request. Only the user commits the spec.
- Input fixes are proposed and not applied. See "Open input issues".

## Working agreements

- Spec first, quick review, then the user says go. No building ahead of go.
- Discuss before any heavy change.
- The user runs `pnpm dev` and watches it reload. Tests from this side use other ports.
- Project setup was done by hand, without skills, on request.
- Add files to git by name. Commit only when asked.

## Code map

- `src/blocks.ts`: block table, `B` name-to-id map, `HOTBAR`, `solid()`.
- `src/gen.ts`: seeded terrain. `column(x, z)` gives height, surface, biome and tree density. `generate(cx, cz)` fills one chunk.
- `src/world.ts`: chunk map, mesher, `get`, `set`, `stream`, `ready`. Owns view radius and fog distance.
- `src/main.ts`: engine, scene, camera, player body, input, HUD, autosave, frame loop.
- `src/voxel-libs.d.ts`: types for the two voxel libraries, which ship none.

## Versions installed

Babylon.js 9.35.0, Vite 8.3.8, TypeScript 7.0.2, Tailwind 4.3.5, simplex-noise 4.0.3, alea 1.0.1, idb-keyval 6.3.0, voxel-aabb-sweep 0.5.0, fast-voxel-raycast 0.1.1, pnpm 12.

## Verified facts

Babylon:

- Babylon cancels the mouse-compat events on the canvas. `mousedown` never fires there. Use `pointerdown` and `pointerup`.
- A second mouse button pressed while one is held arrives as `pointermove` with a new `buttons` value, not as `pointerdown`.
- Front faces: the outward normal equals minus the cross product of (v1-v0) and (v2-v0). The mesher's corner order follows this and renders correctly.
- Vertex colours work on `StandardMaterial` with no extra flag.
- A box with an alpha 0 material and `enableEdgesRendering()` gives a clean target outline.
- Camera feel: `inertia = 0` with `angularSensibility = 500`. The built-in keyboard input is removed. Movement is custom.
- Setting `camera.position` inside `onBeforeRenderObservable` applies in the same frame.
- Importing from the `@babylonjs/core` barrel gives a 5.2 MB bundle, 1.19 MB gzipped. Vite warns about chunk size. Left as is.

Voxel libraries:

- `voxel-aabb-sweep`: zero the blocked axis of the remaining vector in the callback to slide. A hit on axis 1 with direction -1 means grounded. A zero vector returns early.
- `fast-voxel-raycast`: fills hit point and face normal. The target cell is floor(point - normal / 2). The place cell is target + normal. The normal is zero when the ray starts inside a solid cell.
- Both are CommonJS. Default imports work in Vite dev and build.

Build setup:

- `tsconfig.json` needs `"types": ["vite/client"]` for the CSS import.
- `build.target` is `esnext` because `main.ts` uses top-level await.
- Tailwind 4 needs only the Vite plugin and `@import "tailwindcss"`.

World:

- View radius is 7 chunks. Fog ends at (radius - 1.5) x 16 blocks so missing chunks never show.
- One chunk is built per frame, nearest first. Chunks beyond radius + 3 are dropped. Edits survive in the `edits` map.
- About 190 to 240 chunks stay loaded. Headless Chrome held 60 fps.
- Trees up to two blocks outside a chunk are evaluated so their leaves cross chunk borders.
- Spawn checks for grass with 12 clear cells above. Without that the player spawned on a treetop.
- Leaves are solid. Flying up under a tree is blocked.
- The bottom layer cannot be broken. `set` ignores y below 1.

Saving:

- idb-keyval database `keyval-store`, store `keyval`, key `world`.
- Shape: `{ seed, edits: Map<chunkKey, Map<cellIndex, blockId>>, feet, look, fly, slot }`.
- Autosave runs every 2 s. Shift+N stops autosave, deletes the save and reloads.

## How the demo was tested

- `playwright-core` in a temp folder outside the project, launching installed Chrome with `channel: "chrome"`, headless.
- Dev server on its own port: `timeout 300 node node_modules/vite/bin/vite.js --port 5197 --strictPort`, in the background.
- Headless Chrome grants no pointer lock. An init script fakes it: override `Document.prototype.pointerLockElement`, replace `Element.prototype.requestPointerLock`, dispatch `pointerlockchange`.
- State is read from the `#debug` panel text and from IndexedDB. Screenshots confirm rendering.
- Stop servers by port with `netstat -ano` and `taskkill`. Those show up as failed background tasks.

Confirmed this way: rendering, walk, jump, fly, chunk streaming, break, place, hold-to-repeat, save surviving a reload.

Not confirmed in a real browser: real pointer lock, wheel on a real mouse, sprint, Shift+N.

## Open input issues

Reported by the user: left hold deletes continuously, right hold does not, and block switching interferes with right click and scroll.

Findings:

1. Left hold breaks one block every 180 ms. Intentional.
2. Right hold repeats too. Each new block becomes the next target, so the stack walks toward the player. It stops when the next cell would overlap the body. Right click at the same aim then does nothing.
3. A second button pressed during a hold is ignored. See the `pointermove` fact above.
4. Every wheel event moves one slot whatever its size. Five events of deltaY 4 moved five slots.

Proposed, awaiting the user's answer:

1. Right click places one block per click. Left hold keeps repeating.
2. Derive the held button from `e.buttons` on `pointerdown`, `pointermove` and `pointerup`.
3. Accumulate wheel delta and move one slot per notch. Assumes the user's mouse sends small steps.

Unknown: which of these the user meant by "interferes".

## In the spec but not in the demo

- Ore veins, swim, glass, workbench and ore blocks.
- Textures generated in code. The demo uses flat vertex colours with a per-block tint.
- Mode toggle key. The demo is creative only.
- `?` toggling the panels.
- Save download and load shortcuts.
- Steps 4 to 7.

## Ideas for later steps

All from recall. Check against current docs before use.

- Step 4: bake corner ambient occlusion in the mesher as vertex colour. Babylon candidates: `CascadedShadowGenerator`, `DefaultRenderingPipeline` for bloom and tone mapping, `GlowLayer` for lamps and ores, `ParticleSystem` for break particles.
- Step 7: `zzfx` for generated sound effects.

## Parallel work

Every step touches `src/main.ts`. Parallel branches would conflict there. Splitting `main.ts` by concern first would make worktrees practical.
