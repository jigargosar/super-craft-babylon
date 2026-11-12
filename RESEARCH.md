# Research

## Step 4: visuals

Researched 2026-11-12 against Babylon.js 9.35.0.

Key:

- [src] read in the installed source at `node_modules/@babylonjs/core`.
- [web] read in the `@babylonjs/materials` 9.35.0 files on unpkg. That package is not installed.
- [docs] confirmed in the Babylon.js documentation through Context7.
- [recall] not verified.

No snippet was run or type-checked. Imports are from `@babylonjs/core` unless stated.

### 1. Sun shadows: CascadedShadowGenerator

```ts
const csm = new CascadedShadowGenerator(2048, sun);   // create after the camera exists
csm.shadowMaxZ = scene.fogEnd;                         // nothing past the fog needs shadows
csm.numCascades = 3;                                   // default 4, range 2 to 4
// in toMesh:
mesh.receiveShadows = true;
if (mat === land) csm.addShadowCaster(mesh, false);
```

- [src] `mesh.dispose()` already removes the mesh from every shadow map renderList (`Meshes/abstractMesh.pure.js:1912`). No remove call on unload or rebuild.
- [src] `addShadowCaster` is an `indexOf` over the list plus a push.
- [src] Constructor throws on WebGL1 and switches PCF on. Defaults: 4 cascades, lambda 0.5, cascadeBlendPercentage 0.1, depthClamp true, stabilizeCascades false.
- [src] `shadowMaxZ` defaults to the active camera's maxZ at construction, or 10000 with no camera. The setter ignores values outside camera minZ..maxZ. `main.ts` creates the camera after the world, so order matters.
- [src] The shadow pass skips alpha-blended meshes unless `transparencyShadow` is true. Water casts nothing even if added.
- [src] Cost: each frame the generator loops over all casters to build a joint bounding box (`Lights/Shadows/cascadedShadowGenerator.pure.js:83`), plus one extra draw of casters per cascade. Per-cascade culling was not verified.
- [recall] Expect acne on block faces. Tune `csm.bias` (default 0.00005) and `csm.normalBias` (default 0). Good values not verified.
- [src] `light.shadowEnabled` exists for the night half.
- Plain `ShadowGenerator` fits one frustum to all casters and needs hand code to follow the player. CSM follows the camera by itself.

### 2. Bloom and tone mapping: DefaultRenderingPipeline

```ts
const fx = new DefaultRenderingPipeline("fx", true, scene, [camera]);
fx.bloomEnabled = true;      // defaults: threshold 0.9, weight 0.15, kernel 64, scale 0.5
fx.fxaaEnabled = true;
scene.imageProcessingConfiguration.toneMappingEnabled = true;
scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
scene.clearColor = sky.toLinearSpace().toColor4();
```

- [src] Fog conflict: StandardMaterial mixes fog in gamma space, then converts to linear for the post-process (`Shaders/default.fragment.js:297-299`). Fog on meshes keeps its colour. The clear colour is written raw (`scene.pure.js:4438`) and the post-process treats it as linear. Result: sky lighter than fog, chunk edge visible. Fix: the `toLinearSpace()` line, or a sky mesh covering the background (item 7).
- [src] Vertex colours multiply into base colour (`Shaders/default.fragment.js:141`). No conflict.
- [src] StandardMaterial clamps lighting to 1 before multiplying base colour (`Shaders/default.fragment.js:261-266`). Bloom is a luminance threshold, so snow and sand bloom as much as lamps. GlowLayer is what singles out lamps and ores.
- [src] Pass the camera array. Without cameras the image processing post-process is not applied.
- [src] `fx.glowLayerEnabled = true` creates a GlowLayer, exposed as `fx.glowLayer`.
- [recall] Canvas MSAA from `new Engine(canvas, true)` does not cover the pipeline's render target. Use `fx.fxaaEnabled` or `fx.samples = 4`.
- Tone mapping shifts fog and sky together. Tune `imageProcessingConfiguration.exposure`.

### 3. Glow on lamps and ores: GlowLayer with an emissive texture

Vertex colours cannot drive the glow.

```ts
land.emissiveTexture = glowAtlas;   // same layout as the block atlas, black except lamp and ore texels
const glow = new GlowLayer("glow", scene);   // or fx.glowLayerEnabled = true
glow.intensity = 0.6;
glow.customEmissiveColorSelector = (_mesh, _sub, material, result) => {
  const v = material === land ? 1 : 0;
  result.set(v, v, v, 1);
};
```

- [src] The glow shader outputs `glowColor * emissiveTexture`. It reads vertex alpha only, never vertex RGB (`Shaders/glowMapGeneration.fragment.js`).
- [src] Default glow colour is `material.emissiveColor * texture.level` (`Layers/thinGlowLayer.js:168-195`). emissiveColor is black by default, so an emissive texture alone glows zero. Hence the selector. It runs for every mesh, so it must return black for other materials.
- [src] StandardMaterial adds the emissive texture to the lit colour, so those texels are also self-lit.
- [src] The glow pass redraws every opaque mesh at half resolution (mainTextureRatio 0.5) for occlusion. That doubles chunk draw calls.
- [src] Alpha-blended meshes are skipped. Lamps glow through water.
- [src] `addIncludedOnlyMesh` limits the pass, but left-out meshes then stop occluding the glow (`Layers/thinEffectLayer.js:687`).
- Needs UVs on chunk meshes (item 5).
- Alternative without an atlas: a third mesh per chunk holding lamp and ore faces with its own emissive material. More code.

### 4. Break particles: ParticleSystem

```ts
const chips = new ParticleSystem("chips", 200, scene);
chips.particleTexture = RawTexture.CreateRGBATexture(new Uint8Array([255, 255, 255, 255]), 1, 1, scene);
Object.assign(chips, { blendMode: ParticleSystem.BLENDMODE_STANDARD, gravity: new Vector3(0, -20, 0), manualEmitCount: 0 });
Object.assign(chips, { minSize: 0.08, maxSize: 0.16, minLifeTime: 0.3, maxLifeTime: 0.7 });
chips.createBoxEmitter(new Vector3(-2, 1, -2), new Vector3(2, 4, 2), new Vector3(-0.4, -0.4, -0.4), new Vector3(0.4, 0.4, 0.4));
chips.start();
// per break, block at x y z with colour r g b:
chips.emitter = new Vector3(x + 0.5, y + 0.5, z + 0.5);
chips.color1.set(r, g, b, 1); chips.color2.set(r * 0.7, g * 0.7, b * 0.7, 1); chips.colorDead.set(r, g, b, 0);
chips.manualEmitCount = 12;
```

- [src] Without a texture `isReady()` is false and nothing draws (`Particles/thinParticleSystem.pure.js:1809`). The 1x1 white texture gives square chips.
- [src] `manualEmitCount > -1` emits that many, then resets to 0 (`Particles/thinParticleSystem.pure.js:1659`). One long-lived system serves every burst.
- [src] Defaults that need changing: blendMode is additive, colorDead is opaque black, gravity is zero, sizes and lifetimes are 1.
- [src] `chips.applyFog` exists, default false.
- [recall] Live particles stay in world space and keep their colour when emitter and colours change.
- Particles are unlit billboards with no collision. They look bright at night unless colours are scaled by daylight.
- SolidParticleSystem gives lit 3D cubes. It needs a shape, a build, hand physics in `updateParticle` and `setParticles()` each frame. More code.

### 5. Textures generated in code: one RawTexture atlas

One atlas of 4 x 4 tiles at 16 px, nearest sampling with mips, UVs from the mesher.

```ts
const T = 16, N = 4;                                    // 4 x 4 tiles of 16 px, 64 x 64 total
const pixels = new Uint8Array(T * N * T * N * 4);
// fill tile (id % N, id >> 2) per block row with a per-pixel function
const atlas = RawTexture.CreateRGBATexture(pixels, T * N, T * N, scene, true, false, Texture.NEAREST_NEAREST_MIPLINEAR);
land.diffuseTexture = atlas;
// mesher, per corner. cu, cv = the corner's 0 or 1 on the two tangent axes
const e = 0.01;
out.uvs.push(((block % N) + e + cu * (1 - 2 * e)) / N, ((block >> 2) + e + cv * (1 - 2 * e)) / N);
```

- [src] `CreateRGBATexture(data, width, height, scene, generateMipMaps, invertY, samplingMode)`. `VertexData.uvs` is picked up by the existing `Object.assign(new VertexData(), buffers)`.
- [docs] Atlas UVs run u left to right and v bottom to top. Tile (c, r) spans c/N..(c+1)/N and r/N..(r+1)/N. With `invertY` false, pixel row 0 is v = 0.
- [src] Vertex colours multiply the texture (`Shaders/default.fragment.js:141`). Tint and AO stay in vertex colours. If the atlas holds full colour, drop the palette colour from the vertex colour or it applies twice.
- Mip bleeding: tiles sit on a power-of-two grid, so mip levels 0 to 4 keep each tile's texels apart. Nearest sampling never reads a neighbour inside a level. The inset `e` covers the exact tile edge. Levels 5 and 6 merge tiles. Estimate: a block is about 9 px wide at fog end (88 blocks, 1080p, fov 1.2), so only grazing faces deep in fog reach them.
- [src] Mips come from `gl.generateMipmap` (`Engines/Extensions/engine.rawTexture.pure.js`). [recall] Box filter on power-of-two sizes in practice. The spec does not fix the filter.
- [src] No public max-LOD cap for 2D textures. The `RawTexture` constructor has a `mipLevelCount` parameter, but the WebGL raw texture code does not read it (0 matches in `Engines/Extensions/engine.rawTexture.pure.js`). It cannot cap mips here.
- [src] Nearest modes force anisotropy to 1 (`Engines/thinEngine.pure.js:3357`). Nothing to set.
- Any linear mag or min filter bleeds at tile edges unless tiles are padded. Avoid.
- `Texture.NEAREST_SAMPLINGMODE` without mips has zero bleed but distant blocks shimmer.
- Texture array: [src] `RawTexture2DArray` exists. [docs] It is the no-bleed route but needs a custom shader with `sampler2DArray`. [src] StandardMaterial's shader has none (0 matches in `Shaders/default.fragment.js`). It needs a material plugin plus a layer attribute. More code. Its gain is greedy meshing with wrap, which this mesher does not do.
- `DynamicTexture`: [src] `(name, { width, height }, scene, generateMipMaps, samplingMode)`, `getContext()`, `update(invertY)`. Shorter for drawn shapes such as brick lines. [src] `update` defaults `invertY` to true, so its rows are flipped against the RawTexture call above.
- FACES maps tangent axes as (a+1)%3 and (a+2)%3. On x-normal faces that puts y on u. Logs, brick and workbench need v = y on all side faces.
- The same pixel loop can fill the black-except-emissive `glowAtlas` for item 3.
- [recall] Glass and leaf cutouts: `atlas.hasAlpha = true` turns on alpha test. The mesher's face culling then needs a rule for see-through neighbours.

### 6. Corner ambient occlusion: mesher only

- [src] No baked vertex AO helper in core. `SSAO2RenderingPipeline` is screen-space, not baked.

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

- [recall] Standard voxel technique, not run.
- Flip the quad diagonal when `ao[0] + ao[2] < ao[1] + ao[3]`. Indices become `first+1, first+2, first+3, first+1, first+3, first`. Without it the shading differs by corner orientation.
- FACES does not store the axis. Add it to the record.
- `set` rebuilds the four edge neighbours only. With AO, an edit at a chunk corner cell also changes a vertex in the diagonal chunk.
- AO reads diagonal neighbours, so `at` generates corner chunks' data earlier than today.

### 7. Day and night: sky dome with GradientMaterial

Fog colour is copied from the dome's bottom colour. Needs a new dependency: `@babylonjs/materials@9.35.0` [web: exists].

```ts
import { GradientMaterial } from "@babylonjs/materials";
const dome = MeshBuilder.CreateSphere("sky", { diameter: 380, segments: 12, sideOrientation: Mesh.BACKSIDE }, scene);
const skyMat = Object.assign(new GradientMaterial("sky", scene), { scale: 2 / 380, offset: 0, smoothness: 0.6, disableLighting: true, fogEnabled: false });
Object.assign(dome, { material: skyMat, infiniteDistance: true, isPickable: false });
const orbit = Object.assign(new TransformNode("orbit", scene), { infiniteDistance: true });
// sun and moon: MeshBuilder.CreateDisc at z = 170 and z = -170, parent orbit, unlit emissive material, fogEnabled false
// per frame. t = day fraction, day = 0..1 daylight
orbit.rotation.x = t * 2 * Math.PI;
Color3.LerpToRef(NIGHT_LOW, DAY_LOW, day, skyMat.bottomColor); Color3.LerpToRef(NIGHT_TOP, DAY_TOP, day, skyMat.topColor);
scene.fogColor.copyFrom(skyMat.bottomColor);
```

- [web] GradientMaterial shader: `h = vPosition.y * scale + offset`, colour = `mix(bottomColor, topColor, pow(max(h, 0), smoothness))`. Horizon and below equal `bottomColor` exactly, so fog matches the sky and hides the chunk edge.
- [docs] GradientMaterial props: `topColor`, `bottomColor`, `offset`, `scale`, `smoothness` (0 to 10, default 1). [web] `disableLighting` exists.
- [web] The shader includes `imageProcessingCompatibility` and fog. [recall] So it matches StandardMaterial output under the pipeline.
- The dome covers the background, so the clear colour fix from item 2 becomes unnecessary.
- [src] `Color3.LerpToRef(left, right, amount, result)` and `Mesh.BACKSIDE` exist. `CreateSphere` accepts `sideOrientation`.
- [src] `infiniteDistance` adds the camera position only when the node has no parent (`Meshes/transformNode.pure.js:953`). Set it on the pivot, not on the parented discs.
- [src] `camera.maxZ` is 200. Keep the dome radius and the discs below it.
- Stars: [src] `new PointsCloudSystem("stars", 2, scene)`, `addPoints(600, fn)`, `await buildMeshAsync()`. Its default material is unlit with `pointsCloud = true` (`Particles/pointsCloudSystem.js:147`). Parent the mesh to `orbit`. [src] Point size has no effect on WebGPU. [recall] Fade with `mesh.visibility`.
- Point the directional light along the sun disc's direction. Below the horizon the light shines up through the ground. Swap it to the moon's direction at low intensity, or set `sun.shadowEnabled = false`.
- Bloom from item 2 makes the sun disc glow with no extra code.
- SkyMaterial: [docs] props turbidity, luminance, inclination, azimuth, rayleigh, mie values, `useSunPosition`, `sunPosition`. It draws scattering and a sun disc. No moon, no stars. Its horizon colour is computed in the shader, so fog cannot be set to match it. Night look not verified.
- Clear colour plus fog alone is zero code but gives a flat sky with no gradient.

### 8. Translucent animated water: StandardMaterial with NoiseProceduralTexture

```ts
const ripple = new NoiseProceduralTexture("ripple", 128, scene);
Object.assign(ripple, { octaves: 4, persistence: 0.7, brightness: 0.6, animationSpeedFactor: 3 });
ripple.wrapU = ripple.wrapV = Texture.MIRROR_ADDRESSMODE;
water.diffuseTexture = ripple;
water.backFaceCulling = false;          // surface visible from below
// mesher, water faces only: world-space UVs
out.uvs.push((ox + x + corner[0]) / 16, (oz + z + corner[2]) / 16);
```

- [src] `NoiseProceduralTexture(name, size, scene)` animates itself. Defaults: brightness 0.2, octaves 3, persistence 0.8, animationSpeedFactor 1. Output is greyscale (`Shaders/noise.fragment.js`).
- [src] The noise does not tile. Mirror wrap removes the hard seam. The look was not run.
- Greyscale multiplies the blue vertex colour, so it only darkens. `brightness` sets the floor.
- Side faces get stretched UVs from the x, z mapping. Use y for v there if it shows.
- Land and water buffers both gain `uvs`, with different meaning.
- [src] Water is alpha-blended: skipped by shadow and glow passes, sorted per mesh and not per face.
- WaterMaterial: [web] reflection and refraction render targets, `addToRenderList(node)`, `bumpTexture`, wind and wave props. It needs a normal map, an add call for every streamed chunk, and two extra scene renders per frame. [recall] It is built for one flat plane at the mesh's own position. Chunk meshes sit at the origin with baked world coordinates. Not a fit.
- Vertex waves need a shader hook. [recall] `CustomMaterial` from `@babylonjs/materials` with `Vertex_Before_PositionUpdated` is the short route. Not verified.
- [src] `texture.uOffset` scrolling works too, but needs a tileable generated pattern. More code than the noise texture.

### 9. Clouds: one large plane with a generated alpha texture

```ts
const n = 64, cells = new Uint8Array(n * n * 4);
for (let i = 0; i < n * n; i++) cells.set([255, 255, 255, noise((i % n) / 8, ((i / n) | 0) / 8) > 0.2 ? 220 : 0], i * 4);
const cloudTex = RawTexture.CreateRGBATexture(cells, n, n, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
Object.assign(cloudTex, { hasAlpha: true, uScale: 4, vScale: 4 });
const clouds = MeshBuilder.CreateGround("clouds", { width: 2048, height: 2048 }, scene);
clouds.material = Object.assign(new StandardMaterial("clouds", scene), { diffuseTexture: cloudTex, useAlphaFromDiffuseTexture: true, emissiveColor: Color3.White(), disableLighting: true, backFaceCulling: false });
clouds.isPickable = false;
// per frame: plane follows the camera, offset keeps the pattern world-fixed plus drift
clouds.position.set(camera.position.x, 110, camera.position.z);
cloudTex.uOffset = camera.position.x / 512 + time * 0.002; cloudTex.vOffset = camera.position.z / 512;
```

- Nearest sampling gives blocky cells of 8 blocks each, in the voxel style. `noise` is `createNoise2D` from the installed simplex-noise [recall].
- Offset signs depend on the ground mesh's UV direction. Not verified.
- simplex-noise does not tile, so a seam repeats every 512 blocks. [recall] Sampling 4D noise on a torus fixes it.
- [src] `camera.maxZ` is 200 and clips the plane. Fog ends at 88 blocks and fogs clouds to the horizon colour well before that, so most clouds read as pale haze. Option: `fogEnabled = false` on the cloud material plus a larger `camera.maxZ`. Then set `csm.shadowMaxZ` explicitly and resize the sky dome. Needs a look in the running game.
- [src] Alpha-blended, so no cloud shadows and no glow occlusion.
- [recall] `useAlphaFromDiffuseTexture` name.
- [web] SkyMaterial's `cloudiness` only softens the sun disc. It draws no clouds.
- [recall] `CloudProceduralTexture` lives in `@babylonjs/procedural-textures` and targets skyboxes. Thin-instanced cloud boxes are more code.

### Across items

- Mesher changes: a `uvs` buffer (items 3, 5, 8), the face axis in FACES (5, 6), AO lookups (6).
- One new dependency: `@babylonjs/materials@9.35.0`, for GradientMaterial only.
- Creation order: camera first, then CascadedShadowGenerator and DefaultRenderingPipeline.
- Not verified anywhere: runtime look and frame cost of every item, shadow bias values, per-cascade culling, SkyMaterial at night, CustomMaterial hooks.
