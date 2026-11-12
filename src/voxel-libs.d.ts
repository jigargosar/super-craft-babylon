type GetVoxel<T> = (x: number, y: number, z: number) => T;

declare module "voxel-aabb-sweep" {
  type Box = { base: number[]; max: number[]; translate(by: number[]): void };
  type OnCollide = (dist: number, axis: number, dir: number, left: number[]) => boolean | void;
  export default function sweep(getVoxel: GetVoxel<unknown>, box: Box, vector: number[], onCollide: OnCollide): number;
}

declare module "fast-voxel-raycast" {
  export default function raycast<T>(
    getVoxel: GetVoxel<T>,
    start: number[],
    direction: number[],
    distance: number,
    hitPosition: number[],
    hitNormal: number[],
  ): T | 0;
}
