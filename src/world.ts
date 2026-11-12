import { Color3, Mesh, StandardMaterial, VertexData, type Scene } from "@babylonjs/core";
import { B, BLOCKS } from "./blocks";
import { createGenerator, H, index, S } from "./gen";

export type Edits = Map<string, Map<number, number>>;

type Chunk = { cx: number; cz: number; data: Uint8Array; meshes: Mesh[]; meshed: boolean };
type Buffers = { positions: number[]; indices: number[]; normals: number[]; colors: number[] };

const RADIUS = 7;

const RING: number[][] = [];
for (let dx = -RADIUS; dx <= RADIUS; dx++)
  for (let dz = -RADIUS; dz <= RADIUS; dz++) if (Math.hypot(dx, dz) <= RADIUS) RING.push([dx, dz]);
RING.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));

// Six faces. Corner order gives Babylon's front side: -(v1-v0)x(v2-v0) points along the normal.
const FACES = [0, 1, 2].flatMap((a) =>
  [1, -1].map((sign) => {
    const normal = [0, 0, 0];
    normal[a] = sign;
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => {
      const corner = [0, 0, 0];
      corner[a] = sign > 0 ? 1 : 0;
      corner[(a + 1) % 3] = u;
      corner[(a + 2) % 3] = v;
      return corner;
    });
    return { normal, corners: sign > 0 ? corners.reverse() : corners };
  }),
);

export function createWorld(scene: Scene, seed: string, edits: Edits) {
  const gen = createGenerator(seed);
  const chunks = new Map<string, Chunk>();
  const palette = BLOCKS.map((block) => Color3.FromHexString(block.color));
  const material = (name: string, alpha: number) =>
    Object.assign(new StandardMaterial(name, scene), { specularColor: Color3.Black(), alpha });
  const land = material("land", 1);
  const water = material("water", 0.7);

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
    return [mesh];
  };

  const build = (cx: number, cz: number) => {
    const c = chunk(cx, cz);
    const ox = cx * S;
    const oz = cz * S;
    const at = (x: number, y: number, z: number) =>
      y >= 0 && y < H && x >= 0 && x < S && z >= 0 && z < S ? c.data[index(x, y, z)] : get(ox + x, y, oz + z);
    const buffers = (): Buffers => ({ positions: [], indices: [], normals: [], colors: [] });
    const solidFaces = buffers();
    const waterFaces = buffers();

    for (let x = 0; x < S; x++)
      for (let z = 0; z < S; z++)
        for (let y = 0; y < H; y++) {
          const block = c.data[index(x, y, z)];
          if (block === B.air) continue;
          const wet = block === B.water;
          const out = wet ? waterFaces : solidFaces;
          const dip = wet && at(x, y + 1, z) !== B.water ? 0.12 : 0;
          const shade = 0.9 + 0.2 * gen.hash(ox + x + y * 131, oz + z - y * 71);
          const { r, g, b } = palette[block];
          for (const { normal, corners } of FACES) {
            const next = at(x + normal[0], y + normal[1], z + normal[2]);
            if (next !== B.air && (next !== B.water || wet)) continue;
            const first = out.positions.length / 3;
            for (const corner of corners) {
              out.positions.push(ox + x + corner[0], y + corner[1] * (1 - dip), oz + z + corner[2]);
              out.normals.push(...normal);
              out.colors.push(r * shade, g * shade, b * shade, 1);
            }
            out.indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
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

  return { get, set, stream, ready, column: gen.column, size: () => chunks.size };
}
