# Working notes

Things learned while building the demo that live nowhere else. Written 2026-11-12.

## State

- Build-order steps 1 to 3 are built and committed.
- `SPEC.md` holds uncommitted edits made on request. Only the user commits the spec.
- The fixed-step loop and Babylon-based input are applied in `src/main.ts`, tested, and uncommitted. See "Loop and input".
- Step 4 research is done by the `researcher` session and saved in `RESEARCH.md`, uncommitted. No snippet in it was run.

## Working agreements

- Spec first, quick review, then the user says go. No building ahead of go.
- Discuss before any heavy change.
- The user runs `pnpm dev` and watches it reload. Tests from this side use other ports.
- Project setup was done by hand, without skills, on request.
- Add files to git by name. Commit only when asked.
- No magic numbers. Name constants with units and derive step values from `STEP`.
- Test scratch files live in the Windows temp folder from `$TEMP`. Never delete or move them. Windows cleans up.
- Research and test work may go to other sessions, by judgement. A `researcher` session exists. It should use Context7 first, verify in installed source, and report each item in a short message as it finishes.

## Code map

- `src/blocks.ts`: block table, `B` name-to-id map, `HOTBAR`, `solid()`.
- `src/gen.ts`: seeded terrain. `column(x, z)` gives height, surface, biome and tree density. `generate(cx, cz)` fills one chunk.
- `src/world.ts`: chunk map, mesher, `get`, `set`, `stream`, `ready`. Owns view radius and fog distance.
- `src/main.ts`: engine, scene, camera, player body, input, HUD, autosave, frame loop.
- `src/voxel-libs.d.ts`: types for the two voxel libraries, which ship none.

## Versions installed

Babylon.js 9.35.0, Vite 8.3.8, TypeScript 7.0.2, Tailwind 4.3.5, simplex-noise 4.0.3, alea 1.0.1, idb-keyval 6.3.0, voxel-aabb-sweep 0.5.0, fast-voxel-raycast 0.1.1, normalize-wheel-es 1.2.0, pnpm 12.

## Verified facts

Babylon:

- Babylon cancels the mouse-compat events on the canvas. `mousedown` never fires there. Use `pointerdown` and `pointerup`.
- A second mouse button pressed while one is held arrives as `pointermove` with a new `buttons` value, not as `pointerdown`.
- Front faces: the outward normal equals minus the cross product of (v1-v0) and (v2-v0). The mesher's corner order follows this and renders correctly.
- Vertex colours work on `StandardMaterial` with no extra flag.
- A box with an alpha 0 material and `enableEdgesRendering()` gives a clean target outline.
- Camera feel: `inertia = 0` with `angularSensibility = 500`. The built-in keyboard input is removed. Movement is custom. Mouse look stays per frame.
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

## Loop and input

Applied in `src/main.ts` after the user reported bad scroll, uneven holds, and asked for world updates separate from drawing.

Loop:

- `tick()` is one world update at a fixed `STEP` of 1/60 s: move, aim, break or place.
- The frame callback adds real time to `lag`, runs `tick()` while `lag >= STEP`, then blends the camera between the last two body positions by `lag / STEP`.
- `MAX_STEPS` caps catch-up at a quarter second per frame.
- Chunk building runs once per drawn frame at most, and only when a tick is due. Inside `tick()` it made slow machines slower, because each catch-up tick built a chunk.
- Babylon's `deterministicLockstep` engine option exists and works as documented. Not used. Its leftover time is private, so the camera could not blend, and it would make Babylon's own animations step at 60 Hz.

Input, all through Babylon observables:

- `scene.onKeyboardObservable` gives `event.code`. Keys attach to the canvas, so `canvas.focus()` runs at start.
- `scene.onPointerObservable` fires `POINTERDOWN` and `POINTERUP` per button, including a second button during a hold. `event.buttons` on release says what is still held.
- `POINTERWHEEL` fires once per axis. `event.inputIndex` says which axis.
- Babylon's blur events carry `keyCode` but no `code`. Held keys and buttons are cleared in `engine.onCanvasBlurObservable`.
- `scene.preventDefaultOnPointerDown` is what cancels `mousedown`. It also focuses the canvas on click.
- `normalize-wheel-es`: its `spinY` falls back to a full notch for small steps. Use `pixelY` and count one slot per `NOTCH` of 100 pixels.
- `contextmenu` and `resize` are the only raw DOM listeners left.

Unchanged: right hold still repeats. Each new block becomes the next target, so the stack walks toward the player and stops when the next cell would overlap the body.

Test results in headless Chrome, seed `6b0h3zeb`:

- F toggles fly before any click.
- Wheel: +100 moves one slot, five steps of 4 move none, twenty more move one.
- Right hold 1 s places 4. Left hold 0.6 s breaks 4. Left pressed during a right hold breaks, and placing resumes on release.
- Flying covers 32 blocks in 2 s at 60, 40, 20 and 17 fps.
- Blurring the canvas with W held stops movement.

Test method additions:

- Fixed seed: open the page, write `{ seed, edits: new Map(), look: [0, 0], fly: false, slot: 0 }` to the save, reload.
- Slow machine: CDP `Emulation.setCPUThrottlingRate`.
- A `Map` does not survive `page.evaluate`. Reduce it to arrays inside the page.
- Not testable here: a 144 Hz display, a real smooth wheel, real pointer lock.

## In the spec but not in the demo

- Ore veins, swim, glass, workbench and ore blocks.
- Textures generated in code. The demo uses flat vertex colours with a per-block tint.
- Mode toggle key. The demo is creative only.
- `?` toggling the panels.
- Save download and load shortcuts.
- Steps 4 to 7.

## Ideas for later steps

All from recall. Check against current docs before use.

- Step 4: see `RESEARCH.md`. It replaces the recall list that stood here, with source-checked APIs for shadows, bloom, glow, particles, textures, corner shading, sky, water and clouds.
- Step 7: `zzfx` for generated sound effects.

## Parallel work

Every step touches `src/main.ts`. Parallel branches would conflict there. Splitting `main.ts` by concern first would make worktrees practical.
