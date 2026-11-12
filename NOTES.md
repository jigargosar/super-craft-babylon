# Working notes

State and facts that live nowhere else. Rules and session roles are in `CLAUDE.md`.

## State

- Committed: build steps 1 to 3, the fixed-step loop, Babylon-based input, step 4 research.
- Uncommitted: leader-key tuning and ghost block in `src/main.ts` and `index.html`. No scripted test has run. The user is testing by hand.
- Written by the researcher and not yet wired into the game: `src/atlas.ts`, `src/sky.ts`, `src/debug.ts`, plus a `texture` field per row in `src/blocks.ts`.
- Tests exist: `pnpm test` for unit tests, `pnpm test:e2e` for Playwright. The tester owns them and is adding tests for the leader key and ghost block.
- New packages: `@babylonjs/materials`, `@babylonjs/inspector`, `vitest`, `@playwright/test`.
- Step 4 on the executor's side has no go yet.

## Next actions for the executor

1. Check that the dev server answers on `http://localhost:5173/`. If not, start it in the background: `timeout 28800 node node_modules/vite/bin/vite.js --port 5173 --strictPort --open`.
2. Get the user's verdict on the tuning keys and ghost block. Fix or commit as they say.
3. Collect reports from the researcher and the tester.
4. Wire the researcher's modules in `src/main.ts`.
5. Mesher groundwork in `src/world.ts`: uvs buffer, face axis, corner shading.
6. With the user's go, step 4 in this order: atlas, sky and day-night with fog, shadows, bloom and glow, then water, clouds, particles.

Small spec items still open: `?` toggles the panels, a full shortcut panel, save download and load shortcuts.

## Agreements not in CLAUDE.md

- Spec first, quick review, then the user says go.
- `tinykeys` stays a candidate for the shortcut table. Keep ruled-out options in mind.
- Old temp test scripts are in `C:/Users/jigar/AppData/Local/Temp/sc-loop/`. `$TEMP` in the tool shell is `C:/Windows/TEMP`. The user rejected making a second folder there.

## Code map

- `src/blocks.ts`: block table, `B` name-to-id map, `HOTBAR`, `solid()`.
- `src/gen.ts`: seeded terrain. `column(x, z)` gives height, surface, biome, tree density. `generate(cx, cz)` fills one chunk.
- `src/world.ts`: chunk map, mesher, `get`, `set`, `stream`, `ready`. Owns view radius and fog distance.
- `src/main.ts`: engine, scene, camera, player body, input, HUD, autosave, loop.
- `src/voxel-libs.d.ts`: types for the two voxel libraries.

## Researcher's modules, ready to wire

`src/atlas.ts`:

- `TILE = 16`, `GRID = 4`, `atlasPixels(): { colour: Uint8Array; glow: Uint8Array }`, `tileUV(block, cu, cv): [number, number]`.
- Both buffers are 64 x 64 RGBA with row 0 at the bottom. Create with `RawTexture.CreateRGBATexture(pixels, 64, 64, scene, true, false, Texture.NEAREST_NEAREST_MIPLINEAR)`.
- Block id n sits in tile n - 1. `tileUV` throws for air and for ids above 16.
- The atlas holds full colour, so vertex colours become tint and corner shading only.
- Only the lamp tile glows. Glow needs `land.emissiveTexture` plus the colour selector in `RESEARCH.md` item 3.

`src/sky.ts`:

- `createSky(scene): { update(dayFraction: number): number; sun: DirectionalLight }`. `update` returns daylight 0 to 1. `sun` goes to the shadow generator.
- dayFraction: 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset.
- It creates both lights and sets `scene.fogColor`. Wiring means deleting the two lights, the `sky` colour and the `scene.fogColor` line from `main.ts`, then calling `update` once per frame.
- The dome is 380 blocks wide. Keep `camera.maxZ` at 200 or more. Fog distance stays in `world.ts`.

`src/debug.ts`:

- `toggleInspector(scene): Promise<void>`. Does nothing outside dev mode. The executor binds a key.

## Verified facts

Rendering:

- Front faces: the outward normal equals minus the cross product of (v1-v0) and (v2-v0). The mesher follows this.
- Vertex colours work on `StandardMaterial` with no extra flag.
- A box with an alpha 0 material and `enableEdgesRendering()` gives a clean target outline.
- Setting `camera.position` inside `onBeforeRenderObservable` applies in the same frame.
- The `@babylonjs/core` barrel import gives a 5.2 MB bundle. Left as is.

Input, all through Babylon observables:

- `scene.onKeyboardObservable` gives `event.code`. Keys attach to the canvas, so `canvas.focus()` runs at start.
- `scene.onPointerObservable` fires `POINTERDOWN` and `POINTERUP` per button, also for a second button during a hold. `event.buttons` on release says what is still held.
- `POINTERWHEEL` fires once per axis. `event.inputIndex` says which axis.
- Babylon's blur events carry no `code`. Held keys and buttons are cleared in `engine.onCanvasBlurObservable`.
- `scene.preventDefaultOnPointerDown` cancels `mousedown` on the canvas, so raw `mousedown` listeners never fire.
- `normalize-wheel-es`: `spinY` jumps a full notch on small steps. Use `pixelY`, one slot per `NOTCH` of 100 pixels.
- Camera: `inertia = 0`, `angularSensibility = 500`, built-in keyboard input removed. Mouse look stays per frame.

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

## Tuning and ghost block

- Leader key is backquote. The next key picks a setting: `B` break mode, `P` place mode, `R` reach. Any other key closes the panel and is consumed.
- Break and place each switch between one per click and repeat on hold.
- Reach cycles through 4, 6, 8 and 10 blocks.
- The `#tune` panel shows the values while the leader is pending and briefly after a change.
- Ghost block: a translucent box at the place cell in the selected block's colour. Hidden when the cell would overlap the body.
- Settings are not saved.
- Unconfirmed reading of the user's words: "one tick" is one per click, "smooth tick" is repeat on hold, "subtle visual" is the panel.
- With repeat on, right hold stacks blocks toward the player and stops at the body.

## Test method

- Headless Chrome grants no pointer lock. An init script fakes it: override `Document.prototype.pointerLockElement`, replace `Element.prototype.requestPointerLock`, dispatch `pointerlockchange`.
- Fixed seed: open the page, write `{ seed: "6b0h3zeb", edits: new Map(), look: [0, 0], fly: false, slot: 0 }` to the save, reload.
- Read state from the `#debug` panel text and from IndexedDB. A `Map` does not survive `page.evaluate`, so reduce it to arrays inside the page.
- Slow machine: CPU throttling.
- Not testable in headless: a 144 Hz display, a real smooth wheel, real pointer lock.

## In the spec but not in the demo

- Ore veins, swim, glass, workbench and ore blocks.
- Textures. The demo uses flat vertex colours with a per-block tint.
- Mode toggle key. The demo is creative only.
- `?` toggling the panels, save download and load shortcuts.
- Steps 4 to 7.
