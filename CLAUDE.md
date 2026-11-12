# Working rules

These apply to every session in this project.

## How to work

- Before fresh work, write the objectives as a numbered list.
- Before every tool call, log one line: what it does and which objective it serves.
- Take small steps. Stop and discuss when something fails or a big decision comes up.
- Do not ask the user to decide feel questions in the abstract. Make the options switchable in play.
- Commit only when the user asks. Add files by name. Commit first when a change is large.
- Only the user commits `SPEC.md`.
- Never delete or move files in a temp folder.
- Name constants with units. No magic numbers.

## Three sessions

| Role | Session name | Last seen ref | Does | Owns |
| --- | --- | --- | --- | --- |
| executor | `executor` | f8734c | Builds the game, wires modules together, runs the dev server | `src/main.ts`, `src/world.ts`, `index.html`, `CLAUDE.md`, `NOTES.md` |
| researcher | `researcher` | 91feae | Checks docs and library source, writes new modules agreed with the executor | `RESEARCH.md`, `src/atlas.ts`, `src/sky.ts`, `src/debug.ts`, texture fields in `src/blocks.ts` |
| tester | `tester` | 0fb742 | Writes and runs automated tests, reports failures to the owner of the code | `e2e/`, `src/*.test.ts`, `playwright.config.ts`, `vitest.config.ts` |

Hello on startup, and again after a restart or compaction:

1. List the running sessions.
2. Send each peer one line: role, session name, ref, "started" or "resumed", and the current task.
3. A peer missing from the list is gone. Say so to the user and do not wait for it.
4. A peer whose ref differs from the table has restarted. Its old ref is dead. The executor updates the table.

Working together:

- Messages are short and self-contained. The first line says what the message is about.
- Ask the owner before editing a file you do not own.
- Tell the executor before `pnpm add`. Only one session changes `package.json` at a time.
- Report each finished piece as its own message: file, exported interface, what the receiver must do.

## Testing with the user

- The user tests by hand what headless Chrome cannot: real pointer lock, a real mouse wheel, display refresh rate, feel.
- One dev server serves everyone: `http://localhost:5173/`. The executor starts it with `--open`.
- No other session starts a server. Tests run against that URL.
- If the port ever changes, the executor updates this line and tells every session.
- `pnpm test` runs the unit tests. `pnpm test:e2e` runs the Playwright tests.
- Tests use the Playwright library, not manual CDP calls, wherever the library has an API.

## Where things are

- `SPEC.md`: what to build.
- `NOTES.md`: current state, next actions, verified facts.
- `RESEARCH.md`: checked APIs for upcoming steps.
