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

## Tools and libraries

- [run] Inspector: `ShowInspector(scene)` from `@babylonjs/inspector` works under Vite 8. Wrapped in `src/debug.ts`.
- [run] `devalue` 6.0.3 round-trips the save shape with nested Maps. `JSON.stringify` drops them.
- [src] In core: `Tools.Download(blob, fileName)`, `mesh.freezeWorldMatrix()`, `material.freeze()`, `NullEngine`, `CreateSoundAsync(name, AudioBuffer)`, `Lerp`, `Clamp`, `SmoothStep`.
- [web] Candidates for later, API not checked: `tinykeys`, `browser-fs-access`, `lit-html`, `valibot`, `comlink`, `zzfx`, `@babylonjs/procedural-textures`.
- Ruled out: `noa-engine` (needs core 6), `game-inputs` (never reads `buttons`), `yuka` (no types, stale).
