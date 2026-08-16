# youtube-summarize

**Ten lines instead of thirty minutes.**

A lot of YouTube is a two-sentence idea stretched to fill an ad break. The thing
the title promised arrives at minute 24, after the story and the sponsor read —
and half the time, when it finally arrives, it does not even apply to you. This
CLI reads the video's transcript and tells you two things: what the title
actually promised, stated plainly with a timestamp so you can jump straight to
it, and whether it is worth your time given what *you* are trying to do. You
get the payoff in the time it takes to read a paragraph, and a link to the exact
second it is said if you want to hear it from the source.

```console
$ summarize "https://youtu.be/8jPQjjsBbIc" --effort low

# How to stay calm when you know you'll be stressed | Daniel Levitin | TED
TED · 2015-11-23 · 12:20 · manual captions (en)

## Worth skimming

The advice is fully stated in a couple of sentences; the talk's value is the
vivid NNT statistics section, which is worth hearing directly.

## The payoff

Do a 'pre-mortem': before a stressful event, imagine everything that could go
wrong and build systems now, because cortisol will disable rational thought
later. […]

Delivered at **3:30** — https://www.youtube.com/watch?v=8jPQjjsBbIc&t=210s

$0.11 · 6,813 in / 1,335 out
```

## Getting started

You need [Docker](https://docs.docker.com/get-started/get-docker/), Node
24.18.0, [pnpm](https://pnpm.io/installation), and the
[Claude Code](https://claude.com/claude-code) CLI.

```bash
git clone git@github.com:Ximaz/youtube-summarize.git
cd youtube-summarize

nvm install                   # picks up .nvmrc
pnpm ci                       # clean install from the lockfile
docker compose build extractor

claude                        # once, interactively, to log in — then quit
```

Check that the video extractor works before the first real run:

```bash
pnpm extractor:check
```

Then summarize something:

```bash
pnpm summarize "https://youtu.be/8jPQjjsBbIc"
```

The package is private, so nothing lands on your `PATH`. For a bare `summarize`
command, add an alias:

```bash
alias summarize='pnpm --dir /path/to/youtube-summarize summarize'
```

## Usage

```
summarize <youtube-url> [options]

  --lang <codes>    Caption language preference, comma-separated, or "any".
                    Machine-translated tracks are refused.      (default: en)
  --answer-lang <c> Language to write the summary in.
                                        (default: the first --lang code)
  --effort <level>  low | medium | high | xhigh | max           (default: high)
  --model <id>      Model name or alias, e.g. opus, sonnet
                                                     (default: claude-opus-5)
  --dry-run         Report what would be sent; no model call.
  --json            Emit the structured summary instead of Markdown.
  --quiet           Suppress the cost line on stderr.
```

`--effort low` is usually enough — the example above ran in 21 seconds for
$0.11. `--lang` picks the caption track and `--answer-lang` picks the language
the summary is written in, so `--lang de --answer-lang fr` summarizes a German
video in French.

Exit codes: `0` success · `1` bad usage or a missing tool · `2` no usable
transcript · `3` the video could not be extracted · `4` the model call failed.

## The model backend

All prompt processing goes through **`claude -p`**, the Claude Code CLI in
headless mode. The upside is that there is nothing to configure: it uses
whatever login `claude` already has, so there is no API key to set, no billing
to wire up, and no secret to leak.

**Other LLM APIs are not supported and not planned.** The reason is cost, not
architecture. Adding a provider means testing it on real videos every time the
prompt or the output schema changes, which means holding funded accounts with
Google, OpenAI, xAI and everyone else — each with its own billing and its own
monthly bill for a side project. `claude -p` costs nothing extra: the
subscription is already paid for and already logged in. A fork that wants a
different backend should start at `src/claude-cli.ts`.

## Limitations

- One backend: `claude -p`. See above.
- No playlists, no batch mode.
- Videos without captions fail outright — there is no speech-recognition
  fallback, since transcribing would cost the half hour the tool exists to save.
- The model reads the transcript only, so a video whose value is visual
  summarizes poorly.
- Auto-generated captions mangle proper nouns and jargon. Summaries built on
  them say so.
- Age-restricted videos cannot be extracted anonymously.

## Development

```bash
pnpm typecheck          # tsc --noEmit
pnpm test               # CLI suite
pnpm extractor:test     # extractor suite
```

There is no build step — Node runs the TypeScript directly. `zod` is the only
runtime dependency.

yt-dlp is pinned exactly, and YouTube breaks it on a schedule; a weekly workflow
opens a bump PR and never auto-merges. When the pin goes stale the symptom is
"no captions", so those errors name the pinned version — if the video shows
captions in your browser, the pin is the problem, not the video.
