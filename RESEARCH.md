# Research

Checked 2026-11-12 against Babylon.js 9.35.0. Imports are from `@babylonjs/core` unless stated.

Marks:

- [run] seen working in a real browser.
- [src] read in the installed source at `node_modules/@babylonjs/core`.
- [web] read in package files on unpkg.
- [recall] not verified.

## Step 4: visuals

### 1. Sun shadows: CascadedShadowGenerator

```ts
const csm = new CascadedShadowGenerator(2048, sky.sun);   // after the camera exists
csm.shadowMaxZ = scene.fogEnd;
csm.numCascades = 3;                                       // default 4
// in toMesh:
mesh.receiveShadows = true;
if (mat === land) csm.addShadowCaster(mesh, false);
```

- [src] `mesh.dispose()` removes the mesh from the caster list. No bookkeeping on unload.
- [src] `shadowMaxZ` is taken from the camera at construction. Without a camera it is 10000.
- [src] Water never casts. The shadow pass skips alpha-blended meshes.
- [src] Cost: one extra draw of all casters per cascade, plus a loop over casters each frame.
- [recall] Expect acne on block faces. Tune `csm.bias` and `csm.normalBias`.
- Ruled out: plain `ShadowGenerator`, which needs hand code to follow the player.

### 2. Bloom and tone mapping: DefaultRenderingPipeline

```ts
const fx = new DefaultRenderingPipeline("fx", true, scene, [camera]);
fx.bloomEnabled = true;      // defaults: threshold 0.9, weight 0.15
fx.fxaaEnabled = true;
scene.imageProcessingConfiguration.toneMappingEnabled = true;
scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
```

- [src] Without the camera array the image processing step is not applied.
- [src] A raw clear colour comes out lighter than the fog under the pipeline. The sky dome from item 7 covers the background, so this does not show.
- [src] StandardMaterial clamps lighting to 1, so snow and sand bloom as much as lamps. Glow is what singles out lamps.
- [recall] Canvas antialiasing does not cover the pipeline. Use `fx.fxaaEnabled` or `fx.samples = 4`.

### 3. Glow on lamps and ores: GlowLayer with an emissive texture

```ts
land.emissiveTexture = glowTexture;          // from atlasPixels().glow
const glow = new GlowLayer("glow", scene);   // or fx.glowLayerEnabled = true
glow.customEmissiveColorSelector = (_mesh, _sub, material, result) => {
  const v = material === land ? 1 : 0;
  result.set(v, v, v, 1);
};
```

- [src] The glow shader never reads vertex colours. It needs the emissive texture.
- [src] Without the selector the glow is zero, because the default multiplies by the black `emissiveColor`. The selector runs for every mesh, so it must return black for other materials.
- [src] The glow pass redraws every opaque mesh at half resolution. That doubles chunk draw calls.
- [src] Lamps glow through water, since alpha-blended meshes are skipped.

### 4. Break particles: ParticleSystem

```ts
const chips = new ParticleSystem("chips", 200, scene);
chips.particleTexture = RawTexture.CreateRGBATexture(new Uint8Array([255, 255, 255, 255]), 1, 1, scene);
Object.assign(chips, { blendMode: ParticleSystem.BLENDMODE_STANDARD, gravity: new Vector3(0, -20, 0), manualEmitCount: 0 });
Object.assign(chips, { minSize: 0.08, maxSize: 0.16, minLifeTime: 0.3, maxLifeTime: 0.7 });
chips.start();
// per break:
chips.emitter = new Vector3(x + 0.5, y + 0.5, z + 0.5);
chips.color1.set(r, g, b, 1); chips.color2.set(r * 0.7, g * 0.7, b * 0.7, 1); chips.colorDead.set(r, g, b, 0);
chips.manualEmitCount = 12;
```

- [src] Nothing draws without a particle texture.
- [src] `manualEmitCount` emits that many and resets to 0. One system serves every burst.
- [src] Defaults to change: additive blending, black `colorDead`, zero gravity.
- Particles are unlit, so they look bright at night unless scaled by daylight.
- Ruled out: `SolidParticleSystem`, which needs hand physics.

### 5. Block textures: built in `src/atlas.ts`

```ts
const { colour, glow } = atlasPixels();
const texture = (pixels: Uint8Array) =>
  RawTexture.CreateRGBATexture(pixels, TILE * GRID, TILE * GRID, scene, true, false, Texture.NEAREST_NEAREST_MIPLINEAR);
land.diffuseTexture = texture(colour);
out.uvs.push(...tileUV(block, cu, cv));   // mesher, per corner
```

- [run] The atlas renders with this call. Row 0 is the bottom, so `invertY` stays false.
- [src] Vertex colours multiply the texture. The atlas holds full colour, so vertex colours carry tint and shading only.
- Bleed: nearest sampling on a power-of-two tile grid keeps mip levels 0 to 4 clean. Any linear filter bleeds.
- [src] There is no way to cap mip levels on WebGL. Levels 5 and 6 merge tiles, which only grazing faces deep in fog reach.
- The mesher's tangent axes put y on u for x-normal faces. Bark and bricks need v = y on side faces.
- Ruled out: `RawTexture2DArray`, which StandardMaterial cannot sample [src].

### 6. Corner ambient occlusion: mesher only

```ts
// inside the face loop. a = axis of normal, b = (a + 1) % 3, c = (a + 2) % 3
const occ = (d: number[]) => Number(solid(at(x + normal[0] + d[0], y + normal[1] + d[1], z + normal[2] + d[2])));
const ao = corners.map((corner) => {
  const s1 = [0, 0, 0], s2 = [0, 0, 0];
  s1[b] = corner[b] * 2 - 1;
  s2[c] = corner[c] * 2 - 1;
  const [o1, o2] = [occ(s1), occ(s2)];
  return o1 && o2 ? 0 : 3 - o1 - o2 - occ(s1.map((v, i) => v + s2[i]));
});
// colour *= [0.5, 0.7, 0.85, 1][ao[i]]
```

- [src] Core has no helper for baked vertex shading. [recall] The snippet is the standard technique, not run.
- Flip the quad diagonal when `ao[0] + ao[2] < ao[1] + ao[3]`, or the shading differs by corner.
- An edit at a chunk corner cell also changes the diagonal chunk. `set` rebuilds edge neighbours only.

### 7. Day and night: built in `src/sky.ts`

```ts
const sky = createSky(scene);                 // owns dome, sun, moon, stars, both lights, fog colour
const daylight = sky.update(dayFraction);     // once per frame. 0 midnight, 0.5 noon
```

- [run] `GradientMaterial` from `@babylonjs/materials` works beside the core barrel import.
- [run] With lighting off, GradientMaterial outputs its colour squared. `sky.ts` feeds it square roots.
- [web] The horizon and below equal the bottom colour exactly, so the fog matches the sky.
- [src] `infiniteDistance` only works on a node without a parent.
- The dome radius is 190 blocks. `camera.maxZ` must stay at 200 or more.
- Ruled out: `SkyMaterial`, whose horizon colour cannot be read for the fog and which has no moon or stars.

### 8. Water: StandardMaterial with NoiseProceduralTexture

```ts
const ripple = new NoiseProceduralTexture("ripple", 128, scene);
Object.assign(ripple, { octaves: 4, persistence: 0.7, brightness: 0.6, animationSpeedFactor: 3 });
ripple.wrapU = ripple.wrapV = Texture.MIRROR_ADDRESSMODE;
water.diffuseTexture = ripple;
water.backFaceCulling = false;
out.uvs.push((ox + x + corner[0]) / 16, (oz + z + corner[2]) / 16);   // mesher, water faces
```

- [src] The texture animates itself. It does not tile, so mirror wrap hides the seam. The look was not run.
- The grey noise only darkens the blue. `brightness` sets the floor.
- Ruled out: `WaterMaterial`, which needs a normal map, a call per streamed chunk and two extra scene renders [web].

### 9. Clouds: one plane with a generated alpha texture

```ts
const n = 64, cells = new Uint8Array(n * n * 4);
for (let i = 0; i < n * n; i++) cells.set([255, 255, 255, noise((i % n) / 8, ((i / n) | 0) / 8) > 0.2 ? 220 : 0], i * 4);
const cloudTex = RawTexture.CreateRGBATexture(cells, n, n, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
Object.assign(cloudTex, { hasAlpha: true, uScale: 4, vScale: 4 });
const clouds = MeshBuilder.CreateGround("clouds", { width: 2048, height: 2048 }, scene);
// per frame: move the plane with the camera, shift uOffset and vOffset to keep the pattern world-fixed
```

- [src] `camera.maxZ` of 200 clips the plane, and fog ends at 88 blocks. Check the look in the running game.
- [recall] The material needs `useAlphaFromDiffuseTexture`. Offset signs were not verified.
- simplex-noise does not tile, so a seam repeats every 512 blocks.

### Across items

- Mesher changes: a `uvs` buffer (items 3, 5, 8), the face axis in FACES (5, 6), corner lookups (6).
- Creation order: camera first, then the shadow generator and the pipeline.
- Not verified: frame cost of every item, shadow bias values, the look of water and clouds.

## HUD: key menu, visible state, names

Checked 2026-11-12. Trials ran in the scratch project in headless Chrome, without real pointer lock.

### Recommendation

One right-hand panel shows every setting all the time, with all options and the current one in brackets.
`Tab` opens the key menu inside that same panel. Key caps appear beside the rows. Nothing pops up elsewhere.
A one-time row runs and closes the menu. A sticky row keeps it open for repeated taps. `Tab` closes it.
Movement, look and mouse buttons keep working while the menu is open.
Read-only status sits on the left. Under the settings, the key list shows only keys valid right now.

Menu closed, flying:

```
60 fps                                  Tab  SETTINGS
xyz 12 41 -7                            F    Movement        WALK [FLY]
meadow                                       Hold to repeat  [ON] OFF
214 chunks                                   Reach           4 [6] 8 10
seed 6b0h3zeb
                                        KEYS
                                        W A S D    move
                    .                   Space      rise
                                        Shift      sink
                                        Hold LMB   break
                                        Hold RMB   place
                                        1-9 Wheel  pick block
          [1][2][3][4][5][6][7][8][9]
```

Menu open, after `Tab`. Only the top block changes:

```
                                        Tab  close
                                        F    Movement        WALK [FLY]
                                        H    Hold to repeat  [ON] OFF
                                        R    Reach           4 [6] 8 10    stays open
                                        N    New world
                                        ?    Hide panels
```

- A key cap shows only while its key is live. `F` is direct, so its cap always shows.
- Sticky rows get a second cap colour, as hydra does with red and blue heads. The text "stays open" above stands for that colour.
- Walking with hold to repeat off, the key list reads `Space jump`, `Shift sprint`, `LMB break one`, `RMB place one`.

### Key map

| Key | Where | Does | After the press |
| --- | --- | --- | --- |
| `Tab` | always | opens or closes the menu | |
| `F` | always | Movement, next option | |
| `H` | menu | Hold to repeat, next option | menu closes |
| `R` | menu | Reach, next option | menu stays |
| `N` | menu | New world | menu closes |
| `?` | menu | Hide panels | menu closes |

- Every setting key means "next option", wrapping. A two-option setting is a toggle.
- If `Tab` should flip a mode instead, give Movement `hotkey: "Tab"` and pick another open key. Both are one-line changes in the table.
- Hold to repeat covers both mouse buttons. It replaces the separate break and place settings.

### Names

- Left panel: Status. Right panel: Settings on top, Keys below. The words "mode" and "tuning" do not appear on screen.
- Movement: WALK, FLY. In code `movement: "walk" | "fly"`.
- Hold to repeat: ON, OFF. In code `holdToRepeat: boolean`. Games use "hold" against "toggle" for this kind of option. Second choice: Fire with SINGLE and AUTO.
- Reach: 4, 6, 8, 10, in blocks.
- In code a row that keeps the menu open has `stays: true`.
- Renaming `#debug` to `#status` touches the tester's selectors.

### Libraries

The user decided that key dispatch comes from a library and the panel is ours.
No browser library was found that renders a hydra-style sticky menu or a which-key popup. Two web searches and the reads below.

Pick: `@tanstack/hotkeys`, pinned at 0.27.1.

Read in detail:

- `@tanstack/hotkeys` 0.27.1: best fit. Scopes with an exclusive mode, physical keys as `[KeyR]`, name metadata, a store of registrations, key labels for display [web]. Version 0 with frequent releases, so pin it.
- `tinykeys` 4.0.1: second choice. Matches `event.code`, has sequences with a 1000 ms step timeout [web]. No scopes and no metadata, so the menu state would be all ours, and each handler must call `preventDefault` itself.
- `hotkeys-js` 4.1.2: one active scope beside `all`, no descriptions [web]. Physical key matching not checked.
- `when-key-events` 1.8.4: has modes and a shortcut table, but the last release is from 2023 [web].
- `keyux` 0.11.6: hints for focusable buttons and menus, which a pointer-locked game does not have [web].

Looked at by release date only, all stale: `mousetrap` (2020), `keyboardjs` (2022), `@rwh/keystrokes` (2024), `keymage` (2016), `keycuts` (2018), `keybinding` (2020).

Trial of `@tanstack/hotkeys` beside Babylon [run]:

- It binds to the canvas with `target: canvas`, and to the document by default. Both worked.
- A registered `Tab` keeps focus on the canvas. The library prevents the default itself.
- A menu key does nothing while the menu scope is inactive, and fires while it is active.
- `activateScope("menu", { exclusive: { allow: ["global"] } })` opens the menu. Calling the returned function closes it. Direct keys in the `global` scope keep working while it is open.
- `requireReset: true` makes a held key fire once, so auto-repeat does not cycle a setting.
- A key with no registration, such as a held `W`, is left alone and reaches the game.
- `manager.scopes.subscribe` fires on open and on close, which is the redraw signal.
- Not verified: digit keys as `[Digit1]`.

Hold form, where the menu is open only while `Tab` is held [run]:

- Open on the `Tab` key-down binding. Close when `getKeyStateTracker()` no longer lists `Tab` as held, through `tracker.store.subscribe`.
- Taps on `R`, `R`, `H` worked while `Tab` and `W` were both held. After release, `R` did nothing.
- A binding with `eventType: "keyup"` cannot close it. It does not fire once another key was pressed in between.
- `matchesHeldModifiers` is the library's own "hold a key to reveal hints". It answers for Alt, Ctrl, Shift and Meta only, and returns true or false. It ignores `Tab`. Drawing the hints is ours.
- In the hold form every row is sticky by nature and release closes the menu. `stays` only matters in the tap form.
- Tap or hold is a feel choice. One more setting row, `Menu  [TAP] HOLD`, would make it switchable in play.
- Not tested: whether a real keyboard reports `Tab`, `W` and a third key at the same time.

The split that avoids acting on a key twice:

- The library dispatches every one-press key: `Tab`, `F`, digits, menu keys.
- `scene.onKeyboardObservable` keeps only the held-key set for movement. It acts on no press.
- Babylon still receives every key, since both listen. That is harmless once it only records held keys.

My own view, for the record: with about ten single-key bindings, matching `event.code` by hand inside the observer would also work. The scopes are what the library adds.

### Our module: proposed `src/keymenu.ts`

It registers its tables with the library. No `press(code)` is needed, because the library's scopes decide which keys are live.

```ts
type Setting = { name: string; hotkey: string; options: readonly string[];      // hotkey like "[KeyR]"
                 get(): string; set(value: string): void; direct?: boolean; stays?: boolean };
type Command = { name: string; hotkey: string; run(): void; direct?: boolean };  // one-time
type Hint = { keys: string; does: string; when?(): boolean };                    // display only: held keys, mouse
type View = { open: boolean;
              settings: { key: string | null; name: string; options: readonly string[]; current: string; stays: boolean }[];
              commands: { key: string; name: string }[];                         // empty while closed
              hints: { keys: string; does: string }[] };                         // only those whose `when` holds

createKeyMenu(config: { open: string; target: HTMLElement; settings: Setting[]; commands: Command[]; hints: Hint[] },
              onChange: (view: View) => void): { view(): View; close(): void };
panelText(view: View): string;   // "R    Reach           4 [6] 8 10"
```

Where the three parts land:

| Part | Lands on | How |
| --- | --- | --- |
| Panel | ours | `panelText(view)`, drawn by the executor into the page |
| Menu open or closed, sticky or one-time | library scope, plus two lines of ours | Open means the `menu` scope is active. After a row's key our wrapper releases the scope unless the row has `stays` |
| Current value per row | ours | `get()` on each setting. Key labels come from the library's `formatForDisplay` |

- Every setting key means "next option", wrapping. `direct` rows register in the `global` scope, the others in `menu`.
- A key outside the tables reaches the game and the menu stays open. This is hydra's "pink" behaviour [web].
- No timeout. An idle close would be one constant if play shows the need.
- `close()` is for lost pointer lock. `onChange` fires after every handled key and on open and close.
- The library needs a DOM. Unit tests need a DOM environment in vitest, or run through Playwright.

### Checked facts for building it

- [run] `Tab` on the focused canvas moves focus to the next element. Babylon then receives no more keys.
- [run] `event.preventDefault()` inside `scene.onKeyboardObservable` keeps focus on the canvas, and later keys arrive.
- [src] Babylon's key listeners sit on the canvas and notify observers synchronously (`DeviceInput/webDeviceInputSystem.js:330`).
- Not tested: `Tab` under real pointer lock. Headless Chrome grants no lock. It needs one hand test.
- [recall] `Escape` leaves pointer lock and cannot be prevented. Close the menu on `pointerlockchange`.
- [recall] A held key repeats `keydown`. The existing `keys.has` guard already drops repeats.

### References

- hydra [web]: red heads keep it open, blue heads close it, `%` shows live values in the hint, `:timeout` closes it when idle.
- which-key [web]: a popup of the keys that can follow a pending prefix, after 1.0 s by default.
- transient: its readme lists "Display current state of arguments" [web]. Which commands keep the menu open was not verified. The manual did not load.
- Blender [recall]: `Tab` switches mode, and a status bar lists the keys of the current mode.

## Tools and libraries

- [run] Inspector: `ShowInspector(scene)` from `@babylonjs/inspector` works under Vite 8. Wrapped in `src/debug.ts`.
- [run] `devalue` 6.0.3 round-trips the save shape with nested Maps. `JSON.stringify` drops them.
- [src] In core: `Tools.Download(blob, fileName)`, `mesh.freezeWorldMatrix()`, `material.freeze()`, `NullEngine`, `CreateSoundAsync(name, AudioBuffer)`, `Lerp`, `Clamp`, `SmoothStep`.
- [web] Candidates for later, API not checked: `tinykeys`, `browser-fs-access`, `lit-html`, `valibot`, `comlink`, `zzfx`, `@babylonjs/procedural-textures`.
- Ruled out: `noa-engine` (needs core 6), `game-inputs` (never reads `buttons`), `yuka` (no types, stale).
