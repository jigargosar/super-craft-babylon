export const BLOCKS = [
  { name: "air", color: "#000000" },
  { name: "grass", color: "#6fb04a" },
  { name: "dirt", color: "#8a5a3c" },
  { name: "stone", color: "#8d9199" },
  { name: "sand", color: "#e4d391" },
  { name: "snow", color: "#f2f6fa" },
  { name: "log", color: "#6e4a2e" },
  { name: "leaves", color: "#3f8f3a" },
  { name: "planks", color: "#c79a5b" },
  { name: "brick", color: "#b5513f" },
  { name: "lamp", color: "#ffd76a" },
  { name: "water", color: "#3d7fd9" },
] as const;

type Name = (typeof BLOCKS)[number]["name"];

export const B = Object.fromEntries(BLOCKS.map((block, id) => [block.name, id])) as Record<Name, number>;

export const HOTBAR = [B.grass, B.dirt, B.stone, B.sand, B.log, B.leaves, B.planks, B.brick, B.lamp];

export const solid = (block: number) => block !== B.air && block !== B.water;
