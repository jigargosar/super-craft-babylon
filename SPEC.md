# Super Craft spec

Working title. High-level only.

## Goal

A browser voxel game in the block-building genre.
Survival-lite is the real game.
Creative sandbox is one keypress away, for testing features.
Impact comes from four places: visuals, world scale, build feel and a living world.
Critical: Code stays small by switching on engine features and using libraries.

## Principles

- Use a library or engine feature before writing code by hand.
- One data table each for blocks, items, recipes and creatures. Adding content means adding a row.
- No line cap. Fewest moving parts that deliver the feature.
- Original names, creatures, art and sounds. Nothing copied from an existing game.
- No asset files. Textures, sounds and creature models are generated in code.
- Errors crash loudly.

## Stack

- Babylon.js, TypeScript, Vite, pnpm.
- HTML and CSS overlay for the HUD, styled with Tailwind.
- Libraries for noise, sound effects and storage. Candidates: simplex-noise, zzfx, idb-keyval.
- Library and engine feature picks are from recall. Check each against current docs at build time.

## Modes

- Survival-lite + Creative (fly, unlimited blocks, instant break, no damage, creatures stay passive, keys to set time of day.)
- One key toggles between the two at any time. World and position carry over.

## World

- Endless, seeded, generated in chunks around the player. Far chunks unload.
- Height from layered noise.
- Biomes: meadow, forest, desert, snow peaks.
- Caves, trees, ore veins, water at sea level.
- Player edits are stored as per-chunk diffs over the seed.

## Blocks

- About 16 types: grass, dirt, stone, sand, snow, log, leaves, planks, brick, glass, water, lamp, workbench, three ores.
- Each row holds texture, hardness, drop, transparency and light emission.

## Player

- First person, pointer lock, WASD, jump, sprint, swim.
- Hold left mouse to break. Right mouse to place.
- Number keys and the wheel pick the hotbar slot.
- And since most elements are Voxels, AABB math custom/library is a simpler option. at some places we can use babylon builtins and or accompaning libraries.

## Survival-lite

- Health. Damage from falls, drowning and hostile creatures. Slow regeneration.
- Hunger is added last in this step.
- Break time depends on block hardness and the held tool.
- Tool tiers: hand, wood, stone, metal.
- Broken blocks go straight into the inventory. No dropped item entities.
- Inventory is a hotbar plus a grid, with stack counts.
- Crafting is a recipe list. Click a recipe to craft when the ingredients are present. About 12 recipes.
- Death respawns the player at the spawn point with the inventory kept.

## Living world

- Creatures are built from boxes, with a limb-swing walk cycle.
- Grazer: daytime herd animal. Wanders, flees when hit, drops food that heals.
- Stalker: appears at night, chases and hits the player, fades at dawn.
- Ambient: birds overhead and fish in water. No interaction.
- One small state machine is shared by all: idle, wander, flee, chase.

## Visuals

Art direction: textured blocks with slight per-block tint variation, soft corner shading, warm sun and deep fog. Textures are generated in code.

- Day-night cycle with sun, moon, stars and a sky gradient.
- Sun shadows.
- Ambient occlusion baked into block corners.
- Fog tinted to the sky. It hides the chunk edge.
- Translucent animated water.
- Bloom and tone mapping from the engine's post-process pipeline.
- Glow on lamps and ores.
- Clouds.
- Break particles in the block's colour.
- Outline on the targeted block.

## Feel and audio

- Generated sound effects for break, place, step, hurt and pickup.
- Crack overlay while breaking.
- Camera cues: wider FOV on sprint, bob on walk, shake on damage.
- Held block or tool visible in hand, with a swing.

## HUD

- Crosshair, hotbar, health bar, inventory and crafting panel, mode badge.
- Translucent debug panel with FPS, position and chunk count.
- Translucent shortcut panel that lists every shortcut, grouped by purpose.
- `?` toggles both panels.

## Saving

- Seed, chunk diffs, player state and inventory live in IndexedDB.
- Autosave.
- One shortcut starts a new world.
- One shortcut downloads the save as a file. One shortcut loads a save file.
- No buttons. Every action is a shortcut shown in the shortcut panel.

## Platform

Desktop browser, keyboard and mouse.

## Out of scope

Multiplayer, touch, gamepad, farming, shaped crafting grid, dropped item entities, wiring or logic blocks, extra dimensions, texture packs, menus.

## Build order

1. Creative walk and fly on generated terrain.
2. Break, place, hotbar.
3. Endless chunks, biomes, caves, trees, saving.
4. Visuals pass.
5. Survival layer: health, mining time, inventory, crafting, tools, then hunger.
6. Creatures.
7. Audio and feel pass.

Each step ends playable.
Creative mode exists from step 1, so every later feature is testable there.

## Clarified assumptions
- Textures generated in code.
- Hunger at the end of step 5.
- Broken blocks go straight to the inventory.
- Recipe list instead of a crafting grid.
- Inventory kept on death.
- Desktop only.
- Local save in the browser. Download and load by shortcut.
