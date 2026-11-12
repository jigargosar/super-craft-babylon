import { HOTBAR } from "../src/blocks";
import { expect, test } from "./game";

test("the world loads, streams chunks and shows the hotbar", async ({ game, page }) => {
  await game.load(); // waits for the seed, a streamed world and a resting player
  await expect(page.locator("#hotbar > *")).toHaveCount(HOTBAR.length);
  await expect(page.locator("#hotbar > [data-on]")).toHaveText("1");
});
