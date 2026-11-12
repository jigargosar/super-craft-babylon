import type { Scene } from "@babylonjs/core";

type Token = { readonly isDisposed: boolean; dispose(): void };

const shown = new WeakMap<Scene, Token>();

// Dev only. Shows the Babylon Inspector, or hides it when it is open.
// The dynamic import keeps the Inspector out of the production bundle.
export async function toggleInspector(scene: Scene) {
  if (!import.meta.env.DEV) return;
  const token = shown.get(scene);
  if (token && !token.isDisposed) return token.dispose();
  const { ShowInspector } = await import("@babylonjs/inspector");
  shown.set(scene, ShowInspector(scene));
}
