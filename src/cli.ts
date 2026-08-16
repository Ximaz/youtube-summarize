#!/usr/bin/env node
/**
 * summarize <youtube-url>
 *
 * Exit codes:
 *   0  success
 *   1  usage or configuration error (including: claude missing / not logged in)
 *   2  no usable transcript -- the designed failure (no captions / wrong language)
 *   3  the video could not be extracted
 *   4  the model call failed
 */

import { parseArgs } from "node:util";
import type { Effort } from "./claude-cli.ts";
import { exitCodeFor } from "./exit-codes.ts";
import { ExtractionError, type Video, extractVideo } from "./extractor.ts";
import { type OutputLanguage, chooseAnswerLanguage } from "./language.ts";
import { renderMarkdown } from "./render.ts";
import { DEFAULT_MODEL, describePlan, summarize } from "./summarize.ts";
import { InvalidVideoUrlError, parseVideoId } from "./video-id.ts";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

const USAGE = `Usage: summarize <youtube-url> [options]

Answers what a video actually promised and whether it applies to you.
Runs the model through \`claude -p\`, so it uses your existing Claude Code login.

Options:
  --lang <codes>   Caption language preference, comma-separated, or "any".
                   Machine-translated tracks are refused.       (default: en)
  --answer-lang <c>
                   Language to write the summary in. Defaults to the first
                   --lang code, so \`--lang fr\` answers in French. Set it
                   separately to summarise an English video in another
                   language: \`--lang en --answer-lang fr\`. Anything
                   unrecognised falls back to English.
  --effort <level> low | medium | high | xhigh | max            (default: high)
  --model <id>     Model name or alias (e.g. opus, sonnet).  (default: ${DEFAULT_MODEL})
  --dry-run        Extract and report what would be sent; no model call.
  --json           Emit the structured summary instead of Markdown.
  --quiet          Suppress the cost line on stderr.
  -h, --help       Show this message.

Exit codes: 0 ok · 1 usage · 2 no usable transcript · 3 extraction failed · 4 model failed
`;

function fail(message: string, code: number, hint?: string): never {
  process.stderr.write(`error: ${message}\n`);
  if (hint) process.stderr.write(`\n${hint}\n`);
  process.exit(code);
}

function money(value: number): string {
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

interface Options {
  model: string;
  json: boolean;
  quiet: boolean;
  "dry-run": boolean;
}

async function main(): Promise<void> {
  let values, positionals;
  try {
    ({ values, positionals } = parseArgs({
      options: {
        lang: { type: "string", default: "en" },
        "answer-lang": { type: "string", default: "" },
        effort: { type: "string", default: "high" },
        model: { type: "string", default: DEFAULT_MODEL },
        "dry-run": { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        quiet: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: true,
    }));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), 1, USAGE);
  }

  if (values.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (positionals.length !== 1) {
    fail("expected exactly one YouTube URL", 1, USAGE);
  }

  const effort = values.effort as Effort;
  if (!EFFORTS.includes(effort)) {
    fail(`--effort must be one of ${EFFORTS.join(", ")}`, 1);
  }

  let videoId: string;
  try {
    videoId = parseVideoId(positionals[0] as string);
  } catch (error) {
    if (error instanceof InvalidVideoUrlError) fail(error.message, 1);
    throw error;
  }

  let video: Video;
  try {
    video = await extractVideo(videoId, values.lang);
  } catch (error) {
    if (error instanceof ExtractionError) {
      const notes: string[] = [];
      if (error.availableLangs?.length) {
        notes.push(`Available caption languages: ${error.availableLangs.join(", ")}`);
        notes.push(`Re-run with --lang <code>, or --lang any.`);
      }
      if (error.hint) notes.push(error.hint);
      fail(`[${error.code}] ${error.message}`, error.exitCode, notes.join("\n\n") || undefined);
    }
    throw error;
  }

  const language = chooseAnswerLanguage(values.lang, values["answer-lang"]);

  try {
    await runModel(video, values as unknown as Options, effort, language);
  } catch (error) {
    const code = exitCodeFor(error);
    if (code !== null && error instanceof Error) fail(error.message, code);
    throw error;
  }
}

async function runModel(
  video: Video,
  values: Options,
  effort: Effort,
  language: OutputLanguage,
): Promise<void> {
  if (values["dry-run"]) {
    const plan = describePlan(video, values.model, effort, language);
    process.stdout.write(
      [
        video.title,
        `${video.channel}${video.uploadDate ? ` · ${video.uploadDate}` : ""}`,
        `${video.transcript.segments.length} segments -> ${plan.blocks} timestamped blocks ` +
          `(${video.transcript.source}, ${video.transcript.lang})`,
        ``,
        `model        : ${plan.model} (effort ${plan.effort})`,
        `answer in    : ${plan.language.name}`,
        `prompt size  : ${plan.characters.toLocaleString("en-US")} characters`,
        `approx tokens: ~${plan.approxTokens.toLocaleString("en-US")}   (characters/4 -- a rough`,
        `               approximation, not a measurement. Every real run reports`,
        `               Claude's own exact cost and token usage.)`,
        ``,
        `No model call was made.`,
      ].join("\n") + "\n",
    );
    return;
  }

  const { summary, costUsd, inputTokens, outputTokens } = await summarize(
    video,
    values.model,
    effort,
    language,
  );

  process.stdout.write(
    values.json ? `${JSON.stringify(summary, null, 2)}\n` : renderMarkdown(video, summary),
  );

  // Cost goes to stderr so stdout stays a clean pipe for --json.
  if (!values.quiet && costUsd !== null) {
    const tokens =
      inputTokens !== null && outputTokens !== null
        ? ` · ${inputTokens.toLocaleString("en-US")} in / ${outputTokens.toLocaleString("en-US")} out`
        : "";
    process.stderr.write(`\n${money(costUsd)}${tokens}\n`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`error: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(4);
});
