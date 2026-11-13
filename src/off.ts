// Features switched off through the URL, to isolate frame cost. Example: ?off=shadows,glow
// Names: shadows, bloom, fxaa, tonemap, glow, chips, ripple, atlas, corners, sky.
export const OFF = new Set(new URLSearchParams(location.search).get("off")?.split(",") ?? []);
