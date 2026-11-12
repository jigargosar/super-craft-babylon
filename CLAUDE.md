# Working rules

These apply to every session in this project.

## How to work

- Before fresh work, write the objectives as a numbered list.
- Before every tool call, log one line: what it does and which objective it serves.
- Take small steps. Stop and discuss when something fails or a big decision comes up.
- Do not ask the user to decide feel questions in the abstract. Make the options switchable in play.
- Commit each finished feature, then tell the user what is new to test by hand. Add files by name.
- Only the user commits `SPEC.md`.
- Never delete or move files in a temp folder.
- Name constants with units. No magic numbers.
- Speed comes first. No new automated tests unless the user asks.
- A test that fails because the design changed is deleted, not rewritten.

## Dev server and tests

- One dev server: `http://localhost:5173/`. Start it with `--open` when it is not running.
- If the port ever changes, update this line.
- `pnpm test` runs the unit tests. `pnpm test:e2e` runs the Playwright tests against that URL.
- Do not run the whole suite. Run only the tests a change touches, in the background, and keep working meanwhile.

## Where things are

- `SPEC.md`: what to build.
- `NOTES.md`: current state, next actions, verified facts.
- `RESEARCH.md`: checked APIs for upcoming steps.
