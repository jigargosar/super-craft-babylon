import { AHEAD_AND_DOWN, expect, EYE, REACH, STRAIGHT_DOWN, test, type Start } from "./game";

const HOLD_MS = 1000;
const REACH_MARGIN = 0.1; // blocks either side of the reach limit

test.describe("break and place", () => {
  test.beforeEach(({ game }) => game.start(AHEAD_AND_DOWN));

  test("a left click breaks one block", async ({ game }) => {
    await game.click("left");
    expect(await game.savedEdits()).toEqual({ broken: 1, placed: 0 });
  });

  test("a right click places one block", async ({ game }) => {
    await game.click("right");
    expect(await game.savedEdits()).toEqual({ broken: 0, placed: 1 });
  });

  test("a held left button breaks only one block", async ({ game }) => {
    await game.hold("left", HOLD_MS);
    expect(await game.savedEdits()).toEqual({ broken: 1, placed: 0 });
  });

  test("a held right button places only one block", async ({ game }) => {
    await game.hold("right", HOLD_MS);
    expect(await game.savedEdits()).toEqual({ broken: 0, placed: 1 });
  });

  test("two clicks with no pause break two blocks", async ({ game }) => {
    await game.click("left");
    await game.click("left");
    expect(await game.savedEdits()).toEqual({ broken: 2, placed: 0 });
  });

  test("a button pressed while the other is held still acts", async ({ game, page }) => {
    const surface = (await game.mesh("ghost")).cell; // where a lone right click would place
    await page.mouse.down({ button: "left" });
    await page.mouse.down({ button: "right" }); // the browser reports this one as a pointer move
    await page.mouse.up({ button: "right" });
    await page.mouse.up({ button: "left" });

    expect((await game.savedEdits()).placed, "the right press placed a block").toBe(1);
    // Had the left press been lost, the block would sit on the surface and be the target now.
    expect((await game.mesh("highlight")).cell, "the left press broke a block first").not.toEqual(surface);
  });
});

test.describe("mouse capture", () => {
  test("the click that captures the mouse does not act", async ({ game }) => {
    await game.load(AHEAD_AND_DOWN);
    await game.click("left");
    await expect.poll(() => game.locked()).toBe(true);
    expect(await game.savedEdits()).toEqual({ broken: 0, placed: 0 });
  });
});

test.describe("reach and body", () => {
  test("nothing is placed where the block would overlap the body", async ({ game }) => {
    await game.start(STRAIGHT_DOWN);
    await game.click("right");
    expect(await game.savedEdits()).toEqual({ broken: 0, placed: 0 });
  });

  test("the ground is in reach just inside 6 blocks and out of reach just beyond", async ({ game }) => {
    // Find the spawn column, then hover over it with the eye an exact distance above the ground.
    await game.start(STRAIGHT_DOWN);
    const [x, ground, z] = await game.cell();
    const hover = (eyeToGround: number): Start => ({ ...STRAIGHT_DOWN, fly: true, feet: [x + 0.5, ground + eyeToGround - EYE, z + 0.5] });

    await game.start(hover(REACH + REACH_MARGIN));
    expect((await game.mesh("highlight")).shown, "no target beyond reach").toBe(false);
    await game.click("left");
    expect(await game.savedEdits()).toEqual({ broken: 0, placed: 0 });

    await game.start(hover(REACH - REACH_MARGIN));
    expect((await game.mesh("highlight")).shown, "a target within reach").toBe(true);
    await game.click("left");
    expect(await game.savedEdits()).toEqual({ broken: 1, placed: 0 });
  });
});
