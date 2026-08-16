# CLAUDE.md

Orientation for this repository, then behavioural guidelines. Merge with
`CLAUDE.local.md` (engineering rules) if present.

---

## 0. What this project is

A CLI that answers two questions about a YouTube video without watching it:
**what did the title promise, and does it apply to me?** It exists for videos
that bury the payoff behind 25 minutes of filler.

```
summarize <url>
   │  parse URL → 11-character video ID          src/video-id.ts
   ▼
docker compose run --rm extractor <id>           services/extractor/
   │  one yt-dlp pass: metadata + json3 captions
   ▼
claude -p   (transcript on stdin, --json-schema) src/claude-cli.ts
   ▼
Markdown on stdout · cost line on stderr         src/render.ts
```

Two processes, both one-shot. Nothing is a service, nothing listens on a port,
nothing persists between runs.

### Layout

| Path | What it is |
|---|---|
| `src/` | The CLI. TypeScript, run directly by Node — no build step. |
| `services/extractor/` | Python + yt-dlp container. Emits one JSON document on stdout; exit code is the error channel. |
| `tests/` | CLI suite (`node --test`, native TS). |
| `services/extractor/tests/` | Extractor suite (`unittest`), with a real captured json3 fixture. |

### Commands

```bash
pnpm ci                  # clean install (see the trap in §5)
pnpm typecheck           # tsc --noEmit
pnpm test                # CLI suite
pnpm extractor:test      # extractor suite (no Docker needed; pure logic)
pnpm extractor:check     # pinned yt-dlp version + its two required capabilities
docker compose build extractor
pnpm summarize <url>     # the tool itself
```

**There is no build step and no `dist/`.** Node strips types natively, so
`erasableSyntaxOnly` is on: no enums, no parameter properties, no namespaces.

**There is currently no linter or formatter.** Do not write `pnpm lint` into a
script, a workflow, or a report — it does not exist. Match the surrounding
style by hand. If one is ever added, wire it into §5 of `CLAUDE.local.md` and
into the workflow in the same change.

**There is no CI on push or pull request.** The only workflow is the weekly
yt-dlp bump, which runs the suites *when a bump is available* — so the suites
can go a week without running. Run them locally before reporting anything as
validated.

### Invariants that are not obvious

Breaking any of these passes typecheck and most of the suite:

1. **`--tools ""` and `--setting-sources user`** in `src/claude-cli.ts` are
   security controls, not tuning. We pipe an untrusted transcript into an agent
   CLI that ships with Bash and file access, and `--safe-mode` does *not* cover
   `apiKeyHelper` or the settings `env` block. Both flags have regression tests.
2. **The extractor takes a video ID, never a URL.** Parsing is the CLI's job.
3. **stdout is a contract.** One JSON document from the extractor; Markdown or
   `--json` from the CLI. Diagnostics and the cost line go to stderr.
4. **Everything rendered is untrusted** — video titles and model output alike.
   Control characters are stripped in `src/render.ts`.
5. **yt-dlp is pinned exactly.** A stale pin looks exactly like a caption-less
   video, which is why those errors name the pin.

---

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

The one place to spend complexity deliberately is a **trust boundary** — the
extractor's input validation, the `claude -p` flag set, the render sanitiser.
There, being explicit beats being brief.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.
- Remove imports/variables/functions that *your* changes made unused.

The test: every changed line should trace directly to the request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step work, state a brief plan with a verification step per item.

Prefer evidence over assertion: this project's design decisions were settled by
measurement (json3 vs VTT at 3.00× the tokens; a reproduced settings-injection
exploit). When a claim is checkable, check it and record the number.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer
rewrites due to overcomplication, and clarifying questions arrive before
implementation rather than after mistakes.
