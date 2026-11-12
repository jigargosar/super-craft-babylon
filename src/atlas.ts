import alea from "alea";
import { BLOCKS, type Pattern } from "./blocks";

export const TILE = 16; // pixels per tile side
export const GRID = 4; // tiles per atlas side
const SIZE = TILE * GRID; // pixels per atlas side
const INSET_TILES = 0.01; // fraction of a tile kept clear at each edge, stops neighbour bleed
const LAST = TILE - 1;

// shade multiplies the block colour. glow is 0..1 emission written to the glow atlas.
type Texel = { readonly shade: number; readonly glow: number };
type Noise = (x: number, y: number) => number;
type Paint = (x: number, y: number, noise: Noise) => Texel;

const flat = (shade: number): Texel => ({ shade, glow: 0 });

// x runs left to right, y bottom to top. Every pattern tiles with itself.
const PAINT: Record<Pattern, Paint> = {
  smooth: (x, y, n) => flat(0.96 + 0.08 * n(x, y)),
  speckle: (x, y, n) => flat(0.86 + 0.28 * n(x, y)),
  leaves: (x, y, n) => flat(n(x, y) < 0.2 ? 0.6 : 0.85 + 0.3 * n(x, y)),
  bark: (x, y, n) => flat(0.72 + 0.36 * n(x, 0) + 0.08 * n(x, y)),
  planks: (x, y, n) =>
    flat(y % 4 === 3 || (x + (y >> 2) * 5) % TILE === 0 ? 0.7 : 0.88 + 0.16 * n(0, y >> 2) + 0.06 * n(x, y)),
  bricks: (x, y, n) => {
    const shifted = x + ((y >> 2) % 2) * 4;
    return flat(y % 4 === 3 || shifted % 8 === 7 ? 1.45 : 0.86 + 0.22 * n(shifted >> 3, y >> 2));
  },
  lamp: (x, y) => {
    const edge = Math.min(x, y, LAST - x, LAST - y);
    return edge === 0 ? flat(0.55) : { shade: 1.1, glow: edge > 2 ? 1 : 0.5 };
  },
};

// Block id 0 is air and has no tile, so block id n sits in tile n - 1.
const tileOf = (block: number) => {
  const tile = block - 1;
  if (tile < 0 || tile >= GRID * GRID) throw new Error(`No atlas tile for block id ${block}`);
  return { column: tile % GRID, row: Math.floor(tile / GRID) };
};

// Two RGBA buffers of SIZE x SIZE pixels, row 0 at the bottom (v = 0 with invertY false).
export function atlasPixels() {
  const colour = new Uint8Array(SIZE * SIZE * 4);
  const glow = new Uint8Array(SIZE * SIZE * 4);

  BLOCKS.forEach((block, id) => {
    if (id === 0) return;
    const { column, row } = tileOf(id);
    const rgb = [16, 8, 0].map((shift) => (parseInt(block.color.slice(1), 16) >> shift) & 255);
    const random = alea(block.name);
    const field = Array.from({ length: TILE * TILE }, () => random());
    const noise: Noise = (x, y) => field[(y % TILE) * TILE + (x % TILE)];

    for (let y = 0; y < TILE; y++)
      for (let x = 0; x < TILE; x++) {
        const texel = PAINT[block.texture](x, y, noise);
        const at = ((row * TILE + y) * SIZE + column * TILE + x) * 4;
        colour.set([...rgb.map((c) => Math.min(255, c * texel.shade)), 255], at);
        glow.set([...rgb.map((c) => c * texel.glow), 255], at);
      }
  });

  return { colour, glow };
}

// cu and cv are the face corner's 0 or 1 across and up the tile.
export const tileUV = (block: number, cu: number, cv: number): [number, number] => {
  const { column, row } = tileOf(block);
  const inset = (c: number) => INSET_TILES + c * (1 - 2 * INSET_TILES);
  return [(column + inset(cu)) / GRID, (row + inset(cv)) / GRID];
};
