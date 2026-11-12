import {
  Color3,
  Mesh,
  NoiseProceduralTexture,
  RawTexture,
  StandardMaterial,
  Texture,
  VertexData,
  type Scene,
} from "@babylonjs/core";
import { atlasPixels, GRID, TILE, tileUV } from "./atlas";
import { B, BLOCKS, solid } from "./blocks";
import { createGenerator, H, index, S } from "./gen";

export type Edits = Map<string, Map<number, number>>;

type Chunk = { cx: number; cz: number; data: Uint8Array; meshes: Mesh[]; meshed: boolean };
type Buffers = { positions: number[]; indices: number[]; normals: number[]; colors: number[]; uvs: number[] };

const RADIUS = 7;
const WATER_ALPHA = 0.7;
const WATER_DIP = 0.12; // blocks the water surface sits below the block top
const RIPPLE_PIXELS = 128;
const RIPPLE_BLOCKS = S; // blocks one ripple tile spans
// Brightness of a face corner with 0, 1, 2 or 3 open neighbours.
const CORNER_SHADE = [0.5, 0.7, 0.85, 1];
const OPEN = CORNER_SHADE.length - 1;
// Quad corner order for the two possible diagonals. Both keep the same winding.
const DIAGONAL_02 = [0, 1, 2, 0, 2, 3];
const DIAGONAL_13 = [1, 2, 3, 1, 3, 0];

const RING: number[][] = [];
for (let dx = -RADIUS; dx <= RADIUS; dx++)
  for (let dz = -RADIUS; dz <= RADIUS; dz++) if (Math.hypot(dx, dz) <= RADIUS) RING.push([dx, dz]);
RING.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));

// Six faces. Corner order gives Babylon's front side: -(v1-v0)x(v2-v0) points along the normal.
// side1 and side2 are the two axes that span the face. uvs put world y up the tile on side faces.
const FACES = [0, 1, 2].flatMap((a) =>
  [1, -1].map((sign) => {
    const normal = [0, 0, 0];
    normal[a] = sign;
    const square = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => {
      const corner = [0, 0, 0];
      corner[a] = sign > 0 ? 1 : 0;
      corner[(a + 1) % 3] = u;
      corner[(a + 2) % 3] = v;
      return corner;
    });
    const corners = sign > 0 ? square.reverse() : square;
    const uvs = corners.map((corner) => (a === 1 ? [corner[0], corner[2]] : [corner[a === 0 ? 2 : 0], corner[1]]));
    return { normal, corners, uvs, side1: (a + 1) % 3, side2: (a + 2) % 3 };
  }),
);

export function createWorld(scene: Scene, seed: string, edits: Edits) {
  const gen = createGenerator(seed);
  const chunks = new Map<string, Chunk>();
  const palette = BLOCKS.map((block) => Color3.FromHexString(block.color));
  const material = (name: string, alpha: number) =>
    Object.assign(new StandardMaterial(name, scene), { specularColor: Color3.Black(), alpha });
  const land = material("land", 1);
  const water = material("water", WATER_ALPHA);
  // Set by the caller once the shadow generator exists. Runs for every new land mesh.
  const hooks = { landMesh: (_mesh: Mesh) => {} };

  // The atlas holds the block colours. Vertex colours carry only tint and corner shading.
  const { colour, glow } = atlasPixels();
  const atlas = (pixels: Uint8Array) =>
    RawTexture.CreateRGBATexture(pixels, TILE * GRID, TILE * GRID, scene, true, false, Texture.NEAREST_NEAREST_MIPLINEAR);
  land.diffuseTexture = atlas(colour);
  land.emissiveTexture = atlas(glow);

  // Moving grey noise that darkens the water colour. Mirror wrap hides the seam of the noise.
  const ripple = new NoiseProceduralTexture("ripple", RIPPLE_PIXELS, scene);
  Object.assign(ripple, { octaves: 4, persistence: 0.7, brightness: 0.6, animationSpeedFactor: 3 });
  ripple.wrapU = ripple.wrapV = Texture.MIRROR_ADDRESSMODE;
  water.diffuseTexture = ripple;
  water.backFaceCulling = false;

  // Fog ends before the nearest missing chunk can show.
  scene.fogEnd = (RADIUS - 1.5) * S;
  scene.fogStart = scene.fogEnd / 2;

  const key = (cx: number, cz: number) => `${cx},${cz}`;

  const chunk = (cx: number, cz: number) => {
    let c = chunks.get(key(cx, cz));
    if (!c) {
      c = { cx, cz, data: gen.generate(cx, cz), meshes: [], meshed: false };
      for (const [i, block] of edits.get(key(cx, cz)) ?? []) c.data[i] = block;
      chunks.set(key(cx, cz), c);
    }
    return c;
  };

  const get = (x: number, y: number, z: number) =>
    y < 0 ? B.stone : y >= H ? B.air : chunk(x >> 4, z >> 4).data[index(x & 15, y, z & 15)];

  const toMesh = (buffers: Buffers, mat: StandardMaterial) => {
    if (!buffers.indices.length) return [];
    const mesh = new Mesh("chunk", scene);
    Object.assign(new VertexData(), buffers).applyToMesh(mesh);
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    if (mat === land) hooks.landMesh(mesh);
    return [mesh];
  };

  const build = (cx: number, cz: number) => {
    const c = chunk(cx, cz);
    const ox = cx * S;
    const oz = cz * S;
    const at = (x: number, y: number, z: number) =>
      y >= 0 && y < H && x >= 0 && x < S && z >= 0 && z < S ? c.data[index(x, y, z)] : get(ox + x, y, oz + z);
    const buffers = (): Buffers => ({ positions: [], indices: [], normals: [], colors: [], uvs: [] });
    const solidFaces = buffers();
    const waterFaces = buffers();

    for (let x = 0; x < S; x++)
      for (let z = 0; z < S; z++)
        for (let y = 0; y < H; y++) {
          const block = c.data[index(x, y, z)];
          if (block === B.air) continue;
          const wet = block === B.water;
          const out = wet ? waterFaces : solidFaces;
          const dip = wet && at(x, y + 1, z) !== B.water ? WATER_DIP : 0;
          const shade = 0.9 + 0.2 * gen.hash(ox + x + y * 131, oz + z - y * 71);
          const { r, g, b } = palette[block];
          for (const { normal, corners, uvs, side1, side2 } of FACES) {
            const next = at(x + normal[0], y + normal[1], z + normal[2]);
            if (next !== B.air && (next !== B.water || wet)) continue;
            const first = out.positions.length / 3;
            // Is the cell in front of the face, moved sideways by d, solid?
            const shut = (d: number[]) => Number(solid(at(x + normal[0] + d[0], y + normal[1] + d[1], z + normal[2] + d[2])));
            // Open neighbours at each corner. Two shut edges hide the corner fully.
            const open = corners.map((corner) => {
              if (wet) return OPEN;
              const along1 = [0, 0, 0];
              const along2 = [0, 0, 0];
              along1[side1] = corner[side1] * 2 - 1;
              along2[side2] = corner[side2] * 2 - 1;
              const edge1 = shut(along1);
              const edge2 = shut(along2);
              return edge1 && edge2 ? 0 : OPEN - edge1 - edge2 - shut(along1.map((v, i) => v + along2[i]));
            });
            corners.forEach((corner, i) => {
              out.positions.push(ox + x + corner[0], y + corner[1] * (1 - dip), oz + z + corner[2]);
              out.normals.push(...normal);
              const lit = shade * CORNER_SHADE[open[i]];
              if (wet) {
                out.colors.push(r * lit, g * lit, b * lit, 1);
                out.uvs.push((ox + x + corner[0]) / RIPPLE_BLOCKS, (oz + z + corner[2]) / RIPPLE_BLOCKS);
              } else {
                out.colors.push(lit, lit, lit, 1);
                out.uvs.push(...tileUV(block, uvs[i][0], uvs[i][1]));
              }
            });
            // The diagonal joins the two brighter corners, so the shading looks the same on every face.
            const diagonal = open[0] + open[2] < open[1] + open[3] ? DIAGONAL_13 : DIAGONAL_02;
            out.indices.push(...diagonal.map((i) => first + i));
          }
        }

    c.meshes.forEach((mesh) => mesh.dispose());
    c.meshes = [...toMesh(solidFaces, land), ...toMesh(waterFaces, water)];
    c.meshed = true;
  };

  const set = ([x, y, z]: number[], block: number) => {
    if (y < 1 || y >= H) return;
    const cx = x >> 4;
    const cz = z >> 4;
    const lx = x & 15;
    const lz = z & 15;
    chunk(cx, cz).data[index(lx, y, lz)] = block;
    edits.set(key(cx, cz), (edits.get(key(cx, cz)) ?? new Map<number, number>()).set(index(lx, y, lz), block));
    build(cx, cz);
    if (lx === 0) build(cx - 1, cz);
    if (lx === S - 1) build(cx + 1, cz);
    if (lz === 0) build(cx, cz - 1);
    if (lz === S - 1) build(cx, cz + 1);
  };

  // Builds the nearest missing chunk each frame and drops the far ones.
  const stream = (x: number, z: number) => {
    const pcx = Math.floor(x / S);
    const pcz = Math.floor(z / S);
    const missing = RING.find(([dx, dz]) => !chunks.get(key(pcx + dx, pcz + dz))?.meshed);
    if (missing) build(pcx + missing[0], pcz + missing[1]);
    for (const [k, c] of chunks)
      if (Math.hypot(c.cx - pcx, c.cz - pcz) > RADIUS + 3) {
        c.meshes.forEach((mesh) => mesh.dispose());
        chunks.delete(k);
      }
  };

  const ready = (x: number, z: number) => !!chunks.get(key(Math.floor(x / S), Math.floor(z / S)))?.meshed;

  return { get, set, stream, ready, column: gen.column, size: () => chunks.size, land, hooks };
}
