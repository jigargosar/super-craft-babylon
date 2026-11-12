import { BLOCKS, HOTBAR } from "../src/blocks";
import { AHEAD_AND_DOWN, expect, STRAIGHT_DOWN, STRAIGHT_UP, test } from "./game";

const START_SLOT = 4;

const colourOf = (slot: number) => BLOCKS[HOTBAR[slot]].color;

test.describe("ghost block", () => {
  test("previews the cell where a right click places the block", async ({ game, page }) => {
    await game.start(AHEAD_AND_DOWN);
    const ghost = await game.mesh("ghost");
    const target = await game.mesh("highlight");
    expect(ghost.shown).toBe(true);
    expect(ghost.alpha, "translucent").toBeGreaterThan(0);
    expect(ghost.alpha, "translucent").toBeLessThan(1);

    // The ghost sits on one face of the targeted block: one axis is one cell apart.
    const apart = ghost.cell.map((c, i) => Math.abs(c - target.cell[i])).sort();
    expect(apart).toEqual([0, 0, 1]);

    // The placed block lies between the eye and the old target, so it becomes the target.
    const { width, height } = page.viewportSize()!;
    await page.mouse.click(width / 2, height / 2, { button: "right" });
    await expect.poll(async () => (await game.mesh("highlight")).cell).toEqual(ghost.cell);
  });

  test("takes the colour of the selected block", async ({ game, page }) => {
    await game.start({ ...AHEAD_AND_DOWN, slot: START_SLOT });
    expect((await game.mesh("ghost")).colour).toBe(colourOf(START_SLOT));

    for (const slot of HOTBAR.keys()) {
      await page.keyboard.press(`Digit${slot + 1}`);
      expect((await game.mesh("ghost")).colour).toBe(colourOf(slot));
    }
  });

  test("is hidden where the block would overlap the body", async ({ game }) => {
    await game.start(STRAIGHT_DOWN);
    expect((await game.mesh("highlight")).shown, "a block is targeted").toBe(true);
    expect((await game.mesh("ghost")).shown).toBe(false);
  });

  test("is hidden when no block is in reach", async ({ game }) => {
    await game.start(STRAIGHT_UP);
    expect((await game.mesh("highlight")).shown, "nothing is targeted").toBe(false);
    expect((await game.mesh("ghost")).shown).toBe(false);
  });
});
