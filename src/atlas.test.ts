import { expect, test } from "vitest";
import { atlasPixels, GRID, TILE, tileUV } from "./atlas";
import { B, BLOCKS } from "./blocks";

const SIZE = TILE * GRID;

test("both buffers cover the whole atlas", () => {
  const { colour, glow } = atlasPixels();
  expect(colour.length).toBe(SIZE * SIZE * 4);
  expect(glow.length).toBe(SIZE * SIZE * 4);
});

test("every block except air has a tile, and its corners stay inside it", () => {
  BLOCKS.forEach((_, id) => {
    if (id === B.air) return expect(() => tileUV(id, 0, 0)).toThrow();
    const [u0, v0] = tileUV(id, 0, 0);
    const [u1, v1] = tileUV(id, 1, 1);
    const column = (id - 1) % GRID;
    const row = Math.floor((id - 1) / GRID);
    for (const [low, high, tile] of [[u0, u1, column], [v0, v1, row]]) {
      expect(low).toBeGreaterThan(tile / GRID);
      expect(high).toBeLessThan((tile + 1) / GRID);
      expect(high).toBeGreaterThan(low);
    }
  });
});

test("only the lamp tile glows", () => {
  const { glow } = atlasPixels();
  const lit = new Set<number>();
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++)
      if (glow[(y * SIZE + x) * 4] > 0) lit.add(Math.floor(y / TILE) * GRID + Math.floor(x / TILE) + 1);
  expect([...lit]).toEqual([B.lamp]);
});
