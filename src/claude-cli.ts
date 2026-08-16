/**
 * Thin wrapper around `claude -p`.
 *
 * Using the Claude Code CLI instead of the API SDK means the tool inherits
 * whatever authentication the user already has (OAuth subscription, token, or
 * key) rather than requiring ANTHROPIC_API_KEY.
 *
 * It also changes the threat model. The SDK is a pure text->text call; the CLI
 * is an agent that ships with file and shell access, and we pipe an untrusted
 * third-party transcript into it. The flags below are load-bearing, not
 * incidental -- see buildArgs.
 */

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** The `--output-format json` envelope. Only the fields we rely on. */
export interface ClaudeEnvelope {
  is_error?: boolean;
  subtype?: string;
  stop_reason?: string;
  result?: string;
  total_cost_usd?: number;
  api_error_status?: string | null;
  num_turns?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export class ClaudeUnavailableError extends Error {
  override name = "ClaudeUnavailableError";
}
export class ClaudeInvocationError extends Error {
  override name = "ClaudeInvocationError";
  tag: string | undefined;
  constructor(message: string, tag?: string) {
    super(message);
    this.tag = tag;
  }
}
export class ModelRefusedError extends Error {
  override name = "ModelRefusedError";
}
export class OutputTruncatedError extends Error {
  override name = "OutputTruncatedError";
}

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Runner = (args: string[], stdin: string) => Promise<CommandResult>;

export interface InvokeOptions {
  model: string;
  effort: Effort;
  systemPrompt: string;
  jsonSchema: string;
}

export function buildArgs(options: InvokeOptions): string[] {
  return [
    "-p",
    "--output-format",
    "json",
    "--model",
    options.model,
    "--effort",
    options.effort,

    // THE security control. Claude Code has Bash, Read, Write and friends by
    // default; the transcript we hand it is written by a stranger. "" disables
    // the entire built-in tool set, so a transcript that says "run rm -rf" has
    // nothing to reach for.
    "--tools",
    "",

    // Do not inherit this repository's CLAUDE.md, skills, hooks, MCP servers or
    // custom agents. They are irrelevant to summarising a video and would be
    // silently prepended to the summariser's context. Unlike --bare, safe-mode
    // leaves authentication alone, which is the whole point of this path.
    "--safe-mode",

    // The input is untrusted and the output is disposable; nothing about this
    // run belongs in the user's resumable session history.
    "--no-session-persistence",

    // Claude Code reads project settings from <cwd>/.claude/settings.json, and
    // --safe-mode does NOT cover two of the keys in that file: `apiKeyHelper`
    // (an arbitrary shell command, executed) and `env` (which can repoint
    // ANTHROPIC_BASE_URL at an attacker's host, sending them the transcript and
    // the auth header, and letting them choose the "summary" the user reads).
    // Verified reproducible on claude 2.1.233 with the rest of this flag list.
    // We run in a scratch cwd, so pin the sources to the user's own settings:
    // nothing under cwd is trusted.
    "--setting-sources",
    "user",

    // Replace the coding-agent system prompt outright rather than appending to
    // it: it is irrelevant here and measurably larger than ours.
    "--system-prompt",
    options.systemPrompt,

    // Structured output, enforced server-side.
    "--json-schema",
    options.jsonSchema,
  ];
}

/** Claude Code tags machine-readable failures as `[claude-code:some_tag]`. */
export function parseErrorTag(stderr: string): string | undefined {
  return /\[claude-code:([a-z0-9_.-]+)\]/i.exec(stderr)?.[1];
}

const AUTH_TAGS = new Set([
  "authentication_error",
  "unauthorized",
  "invalid_api_key",
  "oauth_token_expired",
  "not_logged_in",
]);

/**
 * A machine-readable tag is authoritative when present: an `unrecognized_model`
 * failure whose prose happens to contain the word "authentication" is not an
 * auth problem, and routing it to "run `claude` to log in" (exit 1) would send
 * the user chasing the wrong thing.
 */
export function isAuthFailure(tag: string | undefined, stderr: string): boolean {
  if (tag) return AUTH_TAGS.has(tag);
  return /not logged in|please run .?claude|invalid api key|unauthorized|authentication (error|failed|required)/i.test(
    stderr,
  );
}

export const claudeRunner: Runner = (args, stdin) =>
  new Promise((resolvePromise, reject) => {
    // A scratch cwd, so the child is not sitting in a directory full of the
    // user's source. Note this is NOT itself a hardening measure -- a shared
    // temp root is world-writable on Linux, and Claude Code would read
    // <cwd>/.claude/settings.json from it. `--setting-sources user` in
    // buildArgs is what makes any cwd safe; this is just tidiness.
    const child = spawn("claude", args, { cwd: tmpdir(), stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(
      () => {
        if (settled) return;
        settled = true;
        child.kill("SIGTERM");
        reject(
          new ClaudeInvocationError(
            "`claude -p` did not finish in time. Try a shorter video or a lower --effort.",
          ),
        );
      },
      // Long videos at high effort legitimately take minutes.
      15 * 60 * 1000,
    );

    // setEncoding decodes across chunk boundaries via StringDecoder. Calling
    // chunk.toString() per chunk would corrupt any multi-byte character that
    // straddles a boundary -- and transcripts are routinely non-ASCII.
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        error.code === "ENOENT"
          ? new ClaudeUnavailableError(
              "`claude` was not found on PATH. Install Claude Code, or see README.",
            )
          : new ClaudeUnavailableError(`Could not run claude: ${error.message}`),
      );
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });

    // claude may exit before consuming all of stdin; EPIPE is expected then and
    // the close handler reports the real reason.
    child.stdin.on("error", () => {});
    child.stdin.end(stdin);
  });

/**
 * Run `claude -p` and return the envelope plus the raw result string.
 *
 * With --json-schema the successful stop_reason is `tool_use`, not `end_turn`
 * (structured output is implemented as a forced tool call), so `is_error` is
 * the gate rather than the stop reason.
 */
export async function invokeClaude(
  prompt: string,
  options: InvokeOptions,
  run: Runner = claudeRunner,
): Promise<{ envelope: ClaudeEnvelope; result: string }> {
  const { code, stdout, stderr } = await run(buildArgs(options), prompt);

  let envelope: ClaudeEnvelope | null = null;
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (typeof parsed === "object" && parsed !== null) envelope = parsed as ClaudeEnvelope;
  } catch {
    envelope = null;
  }

  const failed = !envelope || envelope.is_error === true || code !== 0;

  if (failed) {
    // Classified once, before splitting on envelope shape: a real auth failure
    // arrives WITH a parseable envelope (exit 1 + is_error), so checking only
    // the no-envelope path would report "not logged in" as a model failure.
    const tag = parseErrorTag(stderr);
    if (isAuthFailure(tag, stderr)) {
      throw new ClaudeUnavailableError(
        "`claude` is not authenticated. Run `claude` once interactively to log in, " +
          "or `claude setup-token` for a long-lived token.",
      );
    }
    if (!envelope) {
      throw new ClaudeInvocationError(
        stderr.trim() || `claude exited with status ${code} and produced no JSON.`,
        tag,
      );
    }
    const detail = stderr.trim() || envelope.subtype || `status ${code}`;
    throw new ClaudeInvocationError(
      `claude failed: ${detail}${envelope.api_error_status ? ` (${envelope.api_error_status})` : ""}`,
      tag,
    );
  }
  // `failed` is false, so the envelope exists.
  envelope = envelope as ClaudeEnvelope;

  if (envelope.stop_reason === "refusal") {
    throw new ModelRefusedError("Claude declined to summarise this transcript.");
  }
  if (envelope.stop_reason === "max_tokens") {
    throw new OutputTruncatedError(
      "The response hit the token ceiling and the structured output is incomplete. " +
        "Try a lower --effort, or a shorter video.",
    );
  }

  const result = envelope.result ?? "";
  if (!result.trim()) {
    throw new ClaudeInvocationError("claude returned an empty result.");
  }
  return { envelope, result };
}
