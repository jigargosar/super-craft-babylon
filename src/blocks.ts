// Texture patterns are painted by src/atlas.ts. Only "lamp" emits glow.
export type Pattern = "smooth" | "speckle" | "leaves" | "bark" | "planks" | "bricks" | "lamp";

export type Block = { readonly name: string; readonly color: string; readonly texture: Pattern };

export const BLOCKS = [
  { name: "air", color: "#000000", texture: "smooth" },
  { name: "grass", color: "#6fb04a", texture: "speckle" },
  { name: "dirt", color: "#8a5a3c", texture: "speckle" },
  { name: "stone", color: "#8d9199", texture: "speckle" },
  { name: "sand", color: "#e4d391", texture: "smooth" },
  { name: "snow", color: "#f2f6fa", texture: "smooth" },
  { name: "log", color: "#6e4a2e", texture: "bark" },
  { name: "leaves", color: "#3f8f3a", texture: "leaves" },
  { name: "planks", color: "#c79a5b", texture: "planks" },
  { name: "brick", color: "#b5513f", texture: "bricks" },
  { name: "lamp", color: "#ffd76a", texture: "lamp" },
  { name: "water", color: "#3d7fd9", texture: "smooth" },
] as const satisfies readonly Block[];

type Name = (typeof BLOCKS)[number]["name"];

export const B = Object.fromEntries(BLOCKS.map((block, id) => [block.name, id])) as Record<Name, number>;

export const HOTBAR = [B.grass, B.dirt, B.stone, B.sand, B.log, B.leaves, B.planks, B.brick, B.lamp];

export const solid = (block: number) => block !== B.air && block !== B.water;
