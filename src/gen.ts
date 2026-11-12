import alea from "alea";
import { createNoise2D, createNoise3D, type NoiseFunction2D } from "simplex-noise";
import { B } from "./blocks";

export const S = 16;
export const H = 96;
export const SEA = 28;
const FOREST = 0.03;

export type Biome = "meadow" | "forest" | "desert" | "snow peaks";

export const index = (x: number, y: number, z: number) => (x * S + z) * H + y;

const fbm = (noise: NoiseFunction2D, x: number, z: number, octaves: number) => {
  let sum = 0;
  let norm = 0;
  for (let o = 0, amp = 1; o < octaves; o++, amp /= 2, x *= 2, z *= 2) {
    sum += amp * noise(x, z);
    norm += amp;
  }
  return sum / norm;
};

export function createGenerator(seed: string) {
  const [continent, hills, peaks, heat, damp] = ["c", "h", "p", "t", "d"].map((tag) => createNoise2D(alea(seed, tag)));
  const [caveA, caveB] = ["a", "b"].map((tag) => createNoise3D(alea(seed, tag)));
  const salt = alea(seed).uint32();

  const hash = (x: number, z: number) => {
    let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ salt;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32;
  };

  const column = (x: number, z: number) => {
    const m = Math.max(0, fbm(peaks, x / 320, z / 320, 2) + 0.15);
    const rise = 12 * fbm(continent, x / 500, z / 500, 2) + 6 * fbm(hills, x / 80, z / 80, 4) + 55 * m * m;
    const h = Math.min(H - 12, Math.floor(SEA + 3 + rise));
    const jitter = (hash(x, z) - 0.5) * 0.1;
    const biome: Biome =
      h > 50 + jitter * 30
        ? "snow peaks"
        : fbm(heat, x / 260, z / 260, 2) + jitter > 0.2
          ? "desert"
          : fbm(damp, x / 200, z / 200, 2) + jitter > 0.05
            ? "forest"
            : "meadow";
    const top =
      h <= SEA + 1 || biome === "desert"
        ? B.sand
        : biome !== "snow peaks"
          ? B.grass
          : h > 56 + jitter * 40
            ? B.snow
            : B.stone;
    const under = top === B.grass ? B.dirt : top === B.sand ? B.sand : B.stone;
    const trees = top !== B.grass ? 0 : biome === "forest" ? FOREST : FOREST / 10;
    return { h, top, under, trees, biome };
  };

  const cave = (x: number, y: number, z: number) =>
    y > 1 && caveA(x / 40, y / 28, z / 40) ** 2 + caveB(x / 40, y / 28, z / 40) ** 2 < 0.012;

  const generate = (cx: number, cz: number) => {
    const data = new Uint8Array(S * S * H);
    const ox = cx * S;
    const oz = cz * S;

    for (let x = 0; x < S; x++)
      for (let z = 0; z < S; z++) {
        const { h, top, under } = column(ox + x, oz + z);
        const dry = h > SEA + 1;
        for (let y = 0; y <= Math.max(h, SEA); y++) {
          if (y <= h && (dry || y < h - 4) && cave(ox + x, y, oz + z)) continue;
          data[index(x, y, z)] = y > h ? B.water : y === h ? top : y > h - 4 ? under : B.stone;
        }
      }

    // Trees rooted up to two blocks outside still drop leaves inside this chunk.
    for (let x = -2; x < S + 2; x++)
      for (let z = -2; z < S + 2; z++) {
        const roll = hash(ox + x, oz + z);
        if (roll >= FOREST) continue;
        const { h, trees } = column(ox + x, oz + z);
        if (roll >= trees || cave(ox + x, h, oz + z)) continue;
        const tall = 4 + Math.floor(hash(oz + z, ox + x) * 3);
        const put = (dx: number, dy: number, dz: number, block: number) => {
          const inside = x + dx >= 0 && x + dx < S && z + dz >= 0 && z + dz < S;
          if (inside && !data[index(x + dx, h + dy, z + dz)]) data[index(x + dx, h + dy, z + dz)] = block;
        };
        for (let dy = 1; dy <= tall; dy++) put(0, dy, 0, B.log);
        for (let dx = -2; dx <= 2; dx++)
          for (let dz = -2; dz <= 2; dz++)
            for (let dy = -1; dy <= 2; dy++)
              if (dx * dx + dz * dz + dy * dy * 1.5 < 6.5) put(dx, tall + dy, dz, B.leaves);
      }

    return data;
  };

  return { generate, column, hash };
}
