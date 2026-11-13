import {
  Clamp,
  Color3,
  DirectionalLight,
  HemisphericLight,
  Lerp,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Vector3,
  VertexData,
  type Scene,
} from "@babylonjs/core";
import { GradientMaterial } from "@babylonjs/materials";
// GradientMaterial loads its shaders lazily, and the first compile ran before they arrived.
// Babylon then fetched them by URL and got the page HTML. Registering them up front avoids that.
import "@babylonjs/materials/gradient/gradient.vertex.js";
import "@babylonjs/materials/gradient/gradient.fragment.js";
import alea from "alea";
import { OFF } from "./off";

const DOME_DIAMETER = 380; // blocks. Radius must stay under camera.maxZ.
const STAR_DISTANCE = 180; // blocks from the camera
const DISC_DISTANCE = 170; // blocks from the camera
const SUN_RADIUS = 14; // blocks
const MOON_RADIUS = 9; // blocks
const STAR_COUNT = 700;
const STAR_SIZE = 2; // pixels
const SUN_TILT = 0.35; // sideways lean of the sun path, keeps noon shadows off the block grid
const TWILIGHT = 0.15; // sine of sun elevation over which day fades to night
const HORIZON_FADE = 5; // light reaches full strength at sine elevation 1 / HORIZON_FADE
const SUN_INTENSITY = 0.5;
const MOON_INTENSITY = 0.1;
const AMBIENT_DAY = 0.6;
const AMBIENT_NIGHT = 0.18;
const GRADIENT_SMOOTHNESS = 1.3; // above 1 the horizon colour reaches higher, which hides the fog line

const hex = (value: string) => Color3.FromHexString(value);
// low is the horizon and the fog. top is the zenith.
const NIGHT = { low: hex("#101a30"), top: hex("#05070f") };
const DUSK = { low: hex("#f2a25c"), top: hex("#3b4a8a") };
const DAY = { low: hex("#a9d4f5"), top: hex("#3f7fd8") };
const SUN_LOW = hex("#ffb070");
const SUN_HIGH = hex("#fff4e0");
const MOONLIGHT = hex("#8fa8ff");

// dayFraction: 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset.
export function createSky(scene: Scene) {
  const celestial = <T extends Mesh>(mesh: T) => Object.assign(mesh, { infiniteDistance: true, isPickable: false });
  const unlit = (name: string, color: Color3) =>
    Object.assign(new StandardMaterial(name, scene), {
      emissiveColor: color,
      disableLighting: true,
      fogEnabled: false,
      backFaceCulling: false,
    });

  const dome = celestial(
    MeshBuilder.CreateSphere("sky", { diameter: DOME_DIAMETER, segments: 12, sideOrientation: Mesh.BACKSIDE }, scene),
  );
  const gradient = Object.assign(new GradientMaterial("sky", scene), {
    scale: 2 / DOME_DIAMETER,
    offset: 0,
    smoothness: GRADIENT_SMOOTHNESS,
    disableLighting: true,
    fogEnabled: false,
    disableDepthWrite: true, // the dome is a backdrop. Clouds beyond its radius must still show.
  });
  dome.material = gradient;

  const disc = (name: string, radius: number, color: Color3) => {
    const mesh = celestial(MeshBuilder.CreateDisc(name, { radius, tessellation: 24 }, scene));
    mesh.material = unlit(name, color);
    mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    return mesh;
  };
  const sunDisc = disc("sun disc", SUN_RADIUS, hex("#fff2c0"));
  const moonDisc = disc("moon disc", MOON_RADIUS, hex("#dfe6ff"));

  const random = alea("stars");
  const positions = Array.from({ length: STAR_COUNT }, () => {
    const y = random() * 2 - 1;
    const turn = random() * 2 * Math.PI;
    const ring = Math.sqrt(1 - y * y) * STAR_DISTANCE;
    return [Math.cos(turn) * ring, y * STAR_DISTANCE, Math.sin(turn) * ring];
  }).flat();
  const stars = celestial(new Mesh("stars", scene));
  Object.assign(new VertexData(), { positions }).applyToMesh(stars);
  const starlight = Object.assign(unlit("stars", Color3.White()), { pointsCloud: true, pointSize: STAR_SIZE });
  stars.material = starlight;

  const ambient = new HemisphericLight("ambient", Vector3.Up(), scene);
  ambient.groundColor = new Color3(0.5, 0.5, 0.55);
  const sun = new DirectionalLight("sun", Vector3.Down(), scene);
  const toSun = Vector3.Up();
  const zenith = Color3.Black();
  // With lighting off, GradientMaterial outputs its colour squared. Feeding square roots gives the colour meant.
  const root = (from: Color3, into: Color3) => into.set(Math.sqrt(from.r), Math.sqrt(from.g), Math.sqrt(from.b));

  // Moves the sky to the given time and returns daylight from 0 (night) to 1 (day).
  const update = (dayFraction: number) => {
    const angle = (dayFraction - 0.25) * 2 * Math.PI;
    toSun.set(Math.cos(angle), Math.sin(angle), SUN_TILT).normalize();
    const daylight = Clamp((toSun.y + TWILIGHT) / (2 * TWILIGHT));
    const up = toSun.y > 0;

    const [from, to, amount] = daylight < 0.5 ? [NIGHT, DUSK, daylight * 2] : [DUSK, DAY, daylight * 2 - 1];
    Color3.LerpToRef(from.low, to.low, amount, scene.fogColor);
    Color3.LerpToRef(from.top, to.top, amount, zenith);
    root(scene.fogColor, gradient.bottomColor);
    root(zenith, gradient.topColor);

    sunDisc.position.copyFrom(toSun).scaleInPlace(DISC_DISTANCE);
    moonDisc.position.copyFrom(toSun).scaleInPlace(-DISC_DISTANCE);
    stars.rotation.x = angle;
    stars.setEnabled(daylight < 1);
    starlight.alpha = 1 - daylight;

    // One light serves as sun by day and moon by night. It fades to zero at the horizon, so the swap never shows.
    sun.direction.copyFrom(toSun).scaleInPlace(up ? -1 : 1);
    sun.intensity = (up ? SUN_INTENSITY : MOON_INTENSITY) * Clamp(Math.abs(toSun.y) * HORIZON_FADE);
    Color3.LerpToRef(up ? SUN_LOW : MOONLIGHT, up ? SUN_HIGH : MOONLIGHT, Clamp(toSun.y * 2), sun.diffuse);
    ambient.intensity = Lerp(AMBIENT_NIGHT, AMBIENT_DAY, daylight);
    return daylight;
  };

  if (OFF.has("sky")) for (const mesh of [dome, sunDisc, moonDisc, stars]) mesh.dispose();
  update(0.5);
  return { update, sun };
}
