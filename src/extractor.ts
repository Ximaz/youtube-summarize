/**
 * Client for the extractor container.
 *
 * The container is a one-shot process, not a service: `docker compose run`
 * gives the same JSON contract with no socket, no readiness race, and no stale
 * container holding a port with an older yt-dlp pin.
 */

import { type ExecException, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { z } from "zod";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const ChapterSchema = z.object({
  title: z.string(),
  startTime: z.number(),
  endTime: z.number().nullable(),
});

const SegmentSchema = z.object({
  start: z.number(),
  text: z.string(),
});

export const VideoSchema = z.object({
  id: z.string(),
  title: z.string(),
  channel: z.string(),
  channelId: z.string(),
  uploadDate: z.string().nullable(),
  durationSeconds: z.number().nullable(),
  description: z.string(),
  chapters: z.array(ChapterSchema).nullable(),
  liveStatus: z.string().nullable(),
  availability: z.string().nullable(),
  ageLimit: z.number(),
  transcript: z.object({
    source: z.enum(["manual", "automatic"]),
    lang: z.string(),
    segments: z.array(SegmentSchema),
  }),
});

export type Video = z.infer<typeof VideoSchema>;
export type Chapter = z.infer<typeof ChapterSchema>;
export type Segment = z.infer<typeof SegmentSchema>;

/** Mirrors the container's exit codes. */
export class ExtractionError extends Error {
  override name = "ExtractionError";
  code: string;
  exitCode: number;
  availableLangs: string[] | undefined;
  hint: string | undefined;

  constructor(init: {
    code: string;
    message: string;
    exitCode: number;
    availableLangs?: string[];
    hint?: string;
  }) {
    super(init.message);
    this.code = init.code;
    this.exitCode = init.exitCode;
    this.availableLangs = init.availableLangs;
    this.hint = init.hint;
  }
}

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Runner = (args: string[]) => Promise<CommandResult>;

/**
 * Distinguish the three ways `docker` can fail to produce output at all.
 *
 * They were previously collapsed into one "docker not found" message, which
 * meant that a slow first run -- where compose also builds the image -- looked
 * like a broken Docker install.
 */
export function classifyRunFailure(error: ExecException): ExtractionError {
  if (error.code === "ENOENT") {
    return new ExtractionError({
      code: "DOCKER_UNAVAILABLE",
      // Exit 1, not 3: this is "your machine is not set up", the same class of
      // problem as `claude` being missing -- not "this video cannot be read".
      message: "docker was not found on PATH. Install Docker, or see README.",
      exitCode: 1,
    });
  }
  if (error.killed === true || error.signal) {
    return new ExtractionError({
      code: "EXTRACTOR_TIMEOUT",
      message:
        "The extractor did not finish in time. The first run also builds the " +
        "image; try `docker compose build extractor` first.",
      exitCode: 3,
    });
  }
  if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
    return new ExtractionError({
      code: "UPSTREAM_ERROR",
      message: "The extractor produced more output than the CLI can buffer.",
      exitCode: 3,
    });
  }
  return new ExtractionError({
    code: "DOCKER_UNAVAILABLE",
    message: `Could not run docker: ${error.message}`,
    exitCode: 3,
  });
}

/**
 * `--progress quiet` keeps compose's own lifecycle chatter off stderr; `-T`
 * disables TTY allocation so stdout stays a clean pipe.
 */
export const dockerRunner: Runner = (args) =>
  new Promise((res, rej) => {
    execFile(
      "docker",
      ["compose", "--progress", "quiet", "run", "--rm", "-T", "extractor", ...args],
      { cwd: PROJECT_ROOT, maxBuffer: 128 * 1024 * 1024, timeout: 5 * 60 * 1000 },
      (error, stdout, stderr) => {
        // execFile reports a non-zero exit as an Error whose `code` is the exit
        // status. Anything non-numeric is a failure to run the process at all --
        // but those are not interchangeable, so they are classified separately.
        if (error && typeof error.code !== "number") {
          rej(classifyRunFailure(error));
          return;
        }
        res({ code: error ? Number(error.code) : 0, stdout, stderr });
      },
    );
  });

/**
 * yt-dlp writes its own diagnostics to stderr alongside our envelope, so scan
 * upward for the last line that parses as JSON carrying an `error` key.
 */
function asEnvelope(candidate: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(candidate);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "error" in parsed &&
      typeof (parsed as { error: unknown }).error === "object" &&
      (parsed as { error: unknown }).error !== null
    ) {
      return (parsed as { error: Record<string, unknown> }).error;
    }
  } catch {
    // Not our envelope.
  }
  return null;
}

function findErrorEnvelope(stderr: string): Record<string, unknown> | null {
  // Every line that opens an object is a candidate start, scanned newest
  // first. Each is tried both as a single line and as a run to end-of-output,
  // so the envelope is found whether it is written compact or pretty-printed.
  const lines = stderr.split("\n");
  const offsets: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    if (line.trimStart().startsWith("{")) offsets.push(cursor + (line.length - line.trimStart().length));
    cursor += line.length + 1;
  }

  for (let i = offsets.length - 1; i >= 0; i -= 1) {
    const start = offsets[i] as number;
    const end = stderr.indexOf("\n", start);
    const single = end === -1 ? stderr.slice(start) : stderr.slice(start, end);
    const found = asEnvelope(single.trim()) ?? asEnvelope(stderr.slice(start).trim());
    if (found) return found;
  }
  return null;
}

export async function extractVideo(
  videoId: string,
  lang: string,
  run: Runner = dockerRunner,
): Promise<Video> {
  const { code, stdout, stderr } = await run([videoId, "--lang", lang]);

  if (code !== 0) {
    const envelope = findErrorEnvelope(stderr);
    if (envelope) {
      throw new ExtractionError({
        code: String(envelope["code"] ?? "UPSTREAM_ERROR"),
        message: String(envelope["message"] ?? "Extraction failed."),
        exitCode: code,
        availableLangs: Array.isArray(envelope["availableLangs"])
          ? (envelope["availableLangs"] as string[])
          : undefined,
        hint: typeof envelope["hint"] === "string" ? envelope["hint"] : undefined,
      });
    }
    throw new ExtractionError({
      code: "UPSTREAM_ERROR",
      message: stderr.trim() || `Extractor exited with status ${code}.`,
      exitCode: 3,
    });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new ExtractionError({
      code: "UPSTREAM_ERROR",
      message: "Extractor produced output that was not JSON.",
      exitCode: 3,
    });
  }

  const parsed = VideoSchema.safeParse(raw);
  if (!parsed.success) {
    // Schema drift between CLI and container should say so, rather than
    // surfacing as a TypeError three frames deeper.
    throw new ExtractionError({
      code: "CONTRACT_MISMATCH",
      message: `Extractor output did not match the expected contract: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
      exitCode: 3,
    });
  }
  return parsed.data;
}
