# Working notes

State and facts that live nowhere else. Rules are in `CLAUDE.md`.

## State

- Built: build steps 1 to 3, the fixed-step loop, Babylon-based input, click-only break and place, the ghost block, the settings and keys panels, the sky with day and night, the dev inspector key.
- Written and not yet wired into the game: `src/atlas.ts`, plus a `texture` field per row in `src/blocks.ts`.
- Tests: `pnpm test` runs 7 unit tests. `pnpm test:e2e` runs 14 Playwright tests in `e2e/`.
- Packages beyond the first demo: `@babylonjs/materials`, `@babylonjs/inspector`, `vitest`, `@playwright/test`.

## Next actions

1. Check that the dev server answers on `http://localhost:5173/`. If not, start it in the background: `timeout 28800 node node_modules/vite/bin/vite.js --port 5173 --strictPort --open`.
2. Wire `src/atlas.ts` into the mesher in `src/world.ts`: uvs buffer, face axis.
3. Corner shading in the mesher.
4. The rest of step 4 in this order: shadows, bloom and glow, then water, clouds, particles.
5. After each feature: commit, then tell the user what is new to test by hand.

Small spec items still open: `?` toggles the panels, a full shortcut panel, save download and load shortcuts.

## Controls and panels

- One press is one action. Left breaks, right places. Holding does nothing more.
- Each `POINTERDOWN` pushes its button onto the `presses` queue. Each world update takes one press.
- `F` switches Movement between walk and fly. Digits 1 to 9 pick a block. The wheel does nothing. `Shift+N` starts a new world.
- `T` jumps to the next time of day: night, dawn, day, dusk. Time also runs on its own. A full day is `DAY_SECONDS = 480`. The time is not saved, and a load starts mid morning.
- `I` toggles the Babylon inspector, on the dev server only.
- Feel values sit together as constants in `src/main.ts`: `REACH = 6` blocks and `GHOST_ALPHA = 0.35`.
- Ghost block: a translucent box at the place cell in the selected block's colour. Hidden when the cell would overlap the body.
- `#debug`, top left, read-only: fps, xyz, biome, chunks, seed.
- `#settings`, top right: every setting with all its options and the current one in brackets, such as `F  Movement  [WALK] FLY` and `T  Time      NIGHT DAWN [DAY] DUSK`.
- `#keys`, below it: only the keys that work now. `Space jump` and `Shift sprint` when walking, `Space rise` and `Shift sink` when flying. `Click capture mouse` without pointer lock. With lock: `LMB break`, `RMB place` and `Esc release mouse`.
- On the dev server `globalThis.scene` is the Babylon scene. The e2e tests read the `ghost` and `highlight` meshes through it.

Parked: a key menu on `Tab` with `@tanstack/hotkeys`. The checked facts are in `RESEARCH.md`, section "HUD: key menu, visible state, names".

## Agreements not in CLAUDE.md

- Old temp test scripts are in `C:/Users/jigar/AppData/Local/Temp/sc-loop/`. `$TEMP` in the tool shell is `C:/Windows/TEMP`. The user rejected making a second folder there.

## Code map

- `src/blocks.ts`: block table, `B` name-to-id map, `HOTBAR`, `solid()`.
- `src/gen.ts`: seeded terrain. `column(x, z)` gives height, surface, biome, tree density. `generate(cx, cz)` fills one chunk.
- `src/world.ts`: chunk map, mesher, `get`, `set`, `stream`, `ready`. Owns view radius and fog distance.
- `src/main.ts`: engine, scene, camera, player body, input, HUD, autosave, loop.
- `src/voxel-libs.d.ts`: types for the two voxel libraries.
- `e2e/game.ts`: Playwright fixture. It fakes pointer lock, writes a fixed-seed save and reads the panels, the save and the meshes.

## Modules ready to wire

`src/atlas.ts`:

- `TILE = 16`, `GRID = 4`, `atlasPixels(): { colour: Uint8Array; glow: Uint8Array }`, `tileUV(block, cu, cv): [number, number]`.
- Both buffers are 64 x 64 RGBA with row 0 at the bottom. Create with `RawTexture.CreateRGBATexture(pixels, 64, 64, scene, true, false, Texture.NEAREST_NEAREST_MIPLINEAR)`.
- Block id n sits in tile n - 1. `tileUV` throws for air and for ids above 16.
- The atlas holds full colour, so vertex colours become tint and corner shading only.
- Only the lamp tile glows. Glow needs `land.emissiveTexture` plus the colour selector in `RESEARCH.md` item 3.

## Verified facts

Sky, in `src/sky.ts`:

- `createSky(scene): { update(dayFraction: number): number; sun: DirectionalLight }`. `update` runs once per frame and returns daylight 0 to 1. `sun` goes to the shadow generator.
- dayFraction: 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset.
- It owns the dome, sun, moon, stars, both lights and `scene.fogColor`.
- The dome is 380 blocks wide. Keep `camera.maxZ` at 200 or more. Fog distance stays in `world.ts`.

Rendering:

- Front faces: the outward normal equals minus the cross product of (v1-v0) and (v2-v0). The mesher follows this.
- Vertex colours work on `StandardMaterial` with no extra flag.
- A box with an alpha 0 material and `enableEdgesRendering()` gives a clean target outline.
- Setting `camera.position` inside `onBeforeRenderObservable` applies in the same frame.
- The `@babylonjs/core` barrel import gives a 5.2 MB bundle. Left as is.

Input, all through Babylon observables:

- `scene.onKeyboardObservable` gives `event.code`. Keys attach to the canvas, so `canvas.focus()` runs at start.
- It forwards auto-repeat key-downs. `event.repeat` is false on the first and true after. The `keys.has(code)` guard gives one action per press.
- Babylon's blur events carry no `code`. Held keys and queued presses are cleared in `engine.onCanvasBlurObservable`.
- `scene.preventDefaultOnPointerDown` cancels `mousedown` on the canvas, so raw `mousedown` listeners never fire.
- Camera: `inertia = 0`, `angularSensibility = 500`, built-in keyboard input removed. Mouse look stays per frame.

Clicks, run in headless Chrome without pointer lock unless marked:

- One `POINTERDOWN` per physical press, for left and right. A second button during a hold also gives exactly one, arriving from a DOM `pointermove`. Zero-gap clicks give one each.
- `POINTERTAP` is a worse fit. It fires on release, every second fast click becomes `POINTERDOUBLETAP`, and a blur with a button down produces one.
- `skipPointerDownPicking` only empties the pick. `POINTERDOWN` still fires. Read from source.
- A canvas blur gives no `POINTERDOWN`. Babylon sends `POINTERUP` for held buttons and ignores the real release.
- Phantom press: hold left, press right, blur the canvas, release right. That release arrives as `POINTERDOWN` for button 2, without the right flag in `event.buttons`. Every real press has its flag set. `main.ts` queues a press only with the flag.
- Babylon has no `pointerlockchange` listener, so losing the lock creates no pointer event. Read from source.
- Not checked: Safari, real pointer lock, and Chrome's refusal of `requestPointerLock()` shortly after `Esc`.

Loop:

- `tick()` is one world update at a fixed `STEP` of 1/60 s: move, aim, break or place.
- Each frame adds real time to `lag`, runs `tick()` while `lag >= STEP`, then blends the camera between the last two body positions.
- `MAX_STEPS` caps catch-up at a quarter second.
- Chunk building runs once per drawn frame at most. Inside `tick()` it made slow machines slower.
- Babylon's `deterministicLockstep` works but was not used. Its leftover time is private, and it would step Babylon's own animations at 60 Hz.
- Measured: flying covers 32 blocks in 2 s at 60, 40, 20 and 17 fps.

Voxel libraries:

- `voxel-aabb-sweep`: zero the blocked axis in the callback to slide. A hit on axis 1 with direction -1 means grounded.
- `fast-voxel-raycast`: target cell is floor(point - normal / 2). Place cell is target + normal. The normal is zero when the ray starts inside a solid cell.

Build:

- `tsconfig.json` needs `"types": ["vite/client"]` for the CSS import.
- `build.target` is `esnext` because `main.ts` uses top-level await.

World:

- View radius is 7 chunks. Fog ends at (radius - 1.5) x 16 blocks, so missing chunks never show.
- Chunks beyond radius + 3 are dropped. Edits survive in the `edits` map.
- Trees up to two blocks outside a chunk are evaluated, so leaves cross chunk borders.
- Spawn needs grass with 12 clear cells above. Otherwise the player lands on a treetop.
- Leaves are solid. The bottom layer cannot be broken.

Saving:

- idb-keyval database `keyval-store`, store `keyval`, key `world`.
- Shape: `{ seed, edits: Map<chunkKey, Map<cellIndex, blockId>>, feet, look, fly, slot }`.
- Autosave every 2 s. Shift+N deletes the save and reloads.

Headless Chrome:

- It grants no pointer lock, and the bundled Chromium is not installed. The tests use the installed Chrome through `channel: "chrome"`.
- Not testable there: a 144 Hz display, a real smooth wheel, real pointer lock.

## In the spec but not in the demo

- Ore veins, swim, glass, workbench and ore blocks.
- Textures. The demo uses flat vertex colours with a per-block tint.
- Mode toggle key. The demo is creative only.
- `?` toggling the panels, save download and load shortcuts.
- Steps 4 to 7.
