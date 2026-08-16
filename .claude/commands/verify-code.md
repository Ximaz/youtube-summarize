---
description: Self-review a change against this project's known failure modes
allowed-tools: Bash(git diff:*), Bash(git status:*), Bash(git log:*), Bash(grep:*), Bash(rg:*), Bash(pnpm:*), Bash(node:*), Bash(docker:*), Read, Grep, Glob, Edit
argument-hint: [optional scope, e.g. a path]
---

You are self-reviewing a change you have just finished making, against the
failure modes specific to this project. **None of what follows is caught by
`pnpm typecheck` or the test suites** — that is the entire reason this command
exists. Do not treat a green run as evidence for any item below.

## 0. Establish scope

```bash
git status --short
git diff --stat HEAD
```

If the branch has its own commits, add `git diff --stat main...HEAD`. If this is
not a git repository yet, review the working tree against the task description
instead and say so.

Additional scope from the caller (may be empty): $ARGUMENTS

Two rules for the whole review:

- **Review what changed.** Problems in untouched code are reported, not fixed —
  `.claude/CLAUDE.md` §3 (Surgical Changes).
- **Verify before reporting.** Read the code for every finding you raise. Never
  list a check as passed if you did not actually run it; say it was skipped and
  why. Reproduce security claims where practical rather than reasoning about
  them — a claimed vulnerability that cannot be demonstrated is a hypothesis.

Skip any section whose subject the change did not touch, and **say which
sections you skipped**. An unqualified "no issues found" is not an acceptable
outcome.

---

## 1. The `claude -p` invocation

Applies if `src/claude-cli.ts` or anything feeding `buildArgs` changed.

The transcript is written by a stranger and goes into an agent CLI that ships
with Bash and file access. These flags are the reason that is safe:

```bash
node --input-type=module -e '
  const { buildArgs } = await import("./src/claude-cli.ts");
  console.log(JSON.stringify(buildArgs({model:"m",effort:"high",systemPrompt:"s",jsonSchema:"{}"})));
'
```

Confirm every one of these, and that a test asserts each:

- [ ] `--tools ""` — an empty string, not omitted, not `"default"`. Disables the
      whole built-in tool set.
- [ ] `--setting-sources user` — stops a planted `<cwd>/.claude/settings.json`
      from executing `apiKeyHelper` or repointing `ANTHROPIC_BASE_URL`.
      `--safe-mode` does **not** cover those two keys.
- [ ] `--safe-mode` — drops project `CLAUDE.md`, skills, plugins, hooks, MCP.
- [ ] `--no-session-persistence` — untrusted input stays out of session history.
- [ ] `--system-prompt` (replacing), not `--append-system-prompt`.
- [ ] No `--dangerously-skip-permissions`, no `--permission-mode bypassPermissions`.
- [ ] No video-derived string in argv. The transcript goes on **stdin**.

If a flag was renamed upstream, the failure must be loud. Silent loss of
`--tools ""` is a security regression that nothing else would surface.

## 2. Untrusted input, end to end

Applies if parsing, prompting, or rendering changed.

- [ ] The extractor still accepts only `^[A-Za-z0-9_-]{11}$` — a video ID, never
      a URL. URL parsing stays in the CLI.
- [ ] Untrusted text in the prompt is fenced and labelled as data; all
      instructions remain in the system prompt.
- [ ] Anything rendered passes through the control-character sanitiser in
      `src/render.ts` — video titles and model output alike. Check new
      interpolations specifically:

Wrapped values read `${label(video.title)}`, so this finds the **unwrapped**
ones:

```bash
grep -nE '\$\{(video|summary|entry|labels)\.' src/render.ts
```

Each hit must be either wrapped or provably constrained. At the time of
writing there is exactly one legitimate hit — `video.transcript.source`, a zod
enum of `manual | automatic`. Anything else in that output is a finding.

- [ ] Subprocesses are invoked with an argv array, never an interpolated shell
      string.

## 3. The extractor contract

Applies if `services/extractor/` or `src/extractor.ts` changed.

- [ ] stdout carries exactly one JSON document on success; every diagnostic goes
      to stderr. yt-dlp is chatty — confirm its logger still routes to stderr.
- [ ] The error envelope is a single compact line, and the CLI can still find it
      among yt-dlp's own stderr output.
- [ ] The Python error taxonomy and the zod schema in `src/extractor.ts` still
      agree, field for field. A mismatch surfaces as `CONTRACT_MISMATCH`.
- [ ] Availability gating (`live_status`, `availability`, `age_limit`) still
      classifies before caption selection, so an age-gated video reports
      `AGE_RESTRICTED` rather than `NO_CAPTIONS`.
- [ ] json3 parsing still drops `segs`-less events and `aAppend` markers. If you
      changed it, run the suite — the fixture is a real captured track.

```bash
pnpm extractor:test
```

## 4. Structured output

Applies if `src/schema.ts` changed.

Structured output has constraints that fail at request time, not typecheck time:

- [ ] No optional fields — absent values are nullable via `anyOf`.
- [ ] `additionalProperties: false` on **every** object, including nested ones.
- [ ] No recursion, no `minLength`/`maximum`-style constraints.
- [ ] Guidance for the model lives in `.describe()`, which becomes the JSON
      Schema `description`.

```bash
node --input-type=module -e '
  const { summarySchemaJson } = await import("./src/summarize.ts");
  const s = JSON.parse(summarySchemaJson());
  console.log("$schema stripped:", !("$schema" in s));
  console.log(JSON.stringify(s).includes("$ref") ? "HAS $ref" : "no $ref");
'
```

- [ ] Every new field is also consumed — by `src/render.ts`, `--json`, or both.
      A schema field nothing reads is tokens spent for nothing.

## 5. The documented surface

Applies if flags, output, or error handling changed.

- [ ] The exit-code mapping in `src/exit-codes.ts` still matches the table in
      `README.md` **and** the `Exit codes:` line in the CLI's own `--help`.
- [ ] A new error class is mapped, or deliberately left to rethrow.
- [ ] `--help` lists every flag `parseArgs` accepts, and no flag it does not.

```bash
node src/cli.ts --help
```

- [ ] stdout stays a clean pipe: `--json` output must remain parseable, with the
      cost line on stderr.

## 6. Pins and the image

Applies if a lockfile, `requirements.txt`, the Dockerfile, or a workflow changed.

- [ ] `requirements.txt` and `requirements.lock` agree, and the lock carries
      hashes.
- [ ] `curl-cffi`, `deno` and the `pin*` extras survived the change.
- [ ] The base image is digest-pinned.
- [ ] The build-time assertion still passes:

```bash
docker compose build extractor && pnpm extractor:check
```

- [ ] Actions are pinned to 40-character SHAs with the release in a comment;
      permissions are least-privilege; runners are explicitly versioned.
- [ ] No third-party value is interpolated into a `run:` block via `${{ }}` —
      it must arrive through `env:` and be shape-validated.

## 7. Tests

- [ ] Each behavior change has a test that fails without it. For a security
      control, assert the control itself, not only its effect.
- [ ] No test was weakened or deleted to make the suite pass.
- [ ] Network- and model-dependent paths are still excluded from the default
      suites.

```bash
pnpm typecheck && pnpm test && pnpm extractor:test
```

## 8. Documentation

- [ ] `README.md` still describes implemented behavior: flags, exit codes,
      sample outputs, the security table, setup commands.
- [ ] Sample output was regenerated if the format changed — a stale `--dry-run`
      block is a defect.
- [ ] `.claude/CLAUDE.md`'s invariants list still holds.
- [ ] No comment claims a property the code no longer has.

---

## Report

For each section: **applied and clean**, **applied with findings**, or
**skipped, because …**. For every finding give `file:line`, what is wrong, and
the concrete failure it causes.

Fix defects your change introduced. Report pre-existing ones and leave them
alone unless fixing them was the request.

Close by stating plainly what this review does and does not establish: it checked
these specific failure modes, and it is not a claim that the change is secure or
correct.
