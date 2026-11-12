import { expect, test } from "vitest";
import { B } from "./blocks";
import { createGenerator, H, index, S } from "./gen";

const SEED = "6b0h3zeb";
const REACH = 4; // chunks scanned each way from the origin

const span = Array.from({ length: REACH * 2 + 1 }, (_, i) => i - REACH);
const gen = createGenerator(SEED);
const chunks = new Map(span.flatMap((cx) => span.map((cz) => [`${cx},${cz}`, gen.generate(cx, cz)] as const)));
const cell = (x: number, y: number, z: number) => chunks.get(`${x >> 4},${z >> 4}`)?.[index(x & 15, y, z & 15)];
const columns = span.flatMap((cx) => span.flatMap((cz) => [...Array(S * S).keys()].map((i) => [cx * S + (i >> 4), cz * S + (i & 15)])));

test("the same seed gives the same chunk", () => {
  expect(createGenerator(SEED).generate(2, -3)).toEqual(gen.generate(2, -3));
});

test("another seed gives another chunk", () => {
  expect(createGenerator("other").generate(2, -3)).not.toEqual(gen.generate(2, -3));
});

test("heights stay in range and the bottom layer is solid", () => {
  for (const [x, z] of columns) {
    const { h } = gen.column(x, z);
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThanOrEqual(H - 12);
    expect(cell(x, 0, z)).not.toBe(B.air);
  }
});

test("tree canopies continue across chunk borders", () => {
  let crossings = 0;
  for (const [x, z] of columns) {
    const { h, trees } = gen.column(x, z);
    // A root is skipped when a cave or an earlier canopy took the trunk cell.
    if (gen.hash(x, z) >= trees || cell(x, h + 1, z) !== B.log) continue;
    const tall = 4 + Math.floor(gen.hash(z, x) * 3);
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++)
        for (let dy = -1; dy <= 2; dy++) {
          if (dx * dx + dz * dz + dy * dy * 1.5 >= 6.5) continue;
          const leaf = cell(x + dx, h + tall + dy, z + dz);
          if (leaf === undefined) continue; // outside the scanned area
          expect(leaf, `canopy of tree at ${x},${z}`).not.toBe(B.air);
          if ((x + dx) >> 4 !== x >> 4 || (z + dz) >> 4 !== z >> 4) crossings++;
        }
  }
  expect(crossings).toBeGreaterThan(0);
});
