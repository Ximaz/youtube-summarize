import type { ExecException } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ExtractionError,
  classifyRunFailure,
  extractVideo,
  type Runner,
} from "../src/extractor.ts";

const VIDEO = {
  id: "dQw4w9WgXcQ",
  title: "A video",
  channel: "A channel",
  channelId: "UC123",
  uploadDate: "2026-08-16",
  durationSeconds: 213,
  description: "",
  chapters: null,
  liveStatus: "not_live",
  availability: "public",
  ageLimit: 0,
  transcript: { source: "manual", lang: "en", segments: [{ start: 1.5, text: "hello" }] },
};

const ok = (payload: unknown): Runner => async () => ({
  code: 0,
  stdout: JSON.stringify(payload),
  stderr: "",
});

const failsWith = (code: number, stderr: string): Runner => async () => ({
  code,
  stdout: "",
  stderr,
});

test("parses a well-formed payload", async () => {
  const video = await extractVideo("dQw4w9WgXcQ", "en", ok(VIDEO));
  assert.equal(video.title, "A video");
  assert.equal(video.transcript.segments[0]?.text, "hello");
});

test("passes the video id and language through to the container", async () => {
  let seen: string[] = [];
  const spy: Runner = async (args) => {
    seen = args;
    return { code: 0, stdout: JSON.stringify(VIDEO), stderr: "" };
  };
  await extractVideo("dQw4w9WgXcQ", "de,en", spy);
  assert.deepEqual(seen, ["dQw4w9WgXcQ", "--lang", "de,en"]);
});

test("surfaces the error envelope with its code and exit status", async () => {
  const stderr = JSON.stringify({
    error: { code: "NO_CAPTIONS", message: "no captions at all" },
  });
  await assert.rejects(
    () => extractVideo("dQw4w9WgXcQ", "en", failsWith(2, stderr)),
    (error: unknown) => {
      assert.ok(error instanceof ExtractionError);
      assert.equal(error.code, "NO_CAPTIONS");
      assert.equal(error.exitCode, 2);
      return true;
    },
  );
});

test("finds the envelope among yt-dlp's own stderr output", async () => {
  // yt-dlp writes plain-text diagnostics to the same stream.
  const stderr = [
    "WARNING: [youtube] falling back to a different client",
    "ERROR: [youtube] abc: Video unavailable",
    JSON.stringify({ error: { code: "VIDEO_NOT_FOUND", message: "gone" } }),
  ].join("\n");
  await assert.rejects(
    () => extractVideo("dQw4w9WgXcQ", "en", failsWith(3, stderr)),
    (error: unknown) => (error as ExtractionError).code === "VIDEO_NOT_FOUND",
  );
});

test("carries availableLangs and the stale-pin hint through", async () => {
  const stderr = JSON.stringify({
    error: {
      code: "WRONG_LANGUAGE",
      message: "nope",
      availableLangs: ["fr", "de"],
      hint: "extractor pinned to yt-dlp 2026.07.04",
    },
  });
  await assert.rejects(
    () => extractVideo("dQw4w9WgXcQ", "ja", failsWith(2, stderr)),
    (error: unknown) => {
      const e = error as ExtractionError;
      assert.deepEqual(e.availableLangs, ["fr", "de"]);
      assert.match(e.hint ?? "", /pinned to yt-dlp/);
      return true;
    },
  );
});

test("finds a pretty-printed envelope, not just a compact one", async () => {
  // Robustness against the container being rebuilt with different formatting:
  // whitespace must not decide whether the exit code is meaningful.
  const stderr = [
    "ERROR: [youtube] abc: some diagnostic",
    JSON.stringify(
      { error: { code: "WRONG_LANGUAGE", message: "nope", availableLangs: ["de", "en"] } },
      null,
      2,
    ),
  ].join("\n");
  await assert.rejects(
    () => extractVideo("dQw4w9WgXcQ", "zz", failsWith(2, stderr)),
    (error: unknown) => {
      const e = error as ExtractionError;
      assert.equal(e.code, "WRONG_LANGUAGE");
      assert.equal(e.exitCode, 2);
      assert.deepEqual(e.availableLangs, ["de", "en"]);
      return true;
    },
  );
});

test("falls back to a generic error when stderr carries no envelope", async () => {
  await assert.rejects(
    () => extractVideo("dQw4w9WgXcQ", "en", failsWith(3, "segfault")),
    (error: unknown) => (error as ExtractionError).code === "UPSTREAM_ERROR",
  );
});

test("reports non-JSON stdout rather than throwing a TypeError", async () => {
  const runner: Runner = async () => ({ code: 0, stdout: "not json", stderr: "" });
  await assert.rejects(
    () => extractVideo("dQw4w9WgXcQ", "en", runner),
    (error: unknown) => (error as ExtractionError).code === "UPSTREAM_ERROR",
  );
});

test("reports contract drift with the offending field", async () => {
  const { transcript, ...withoutTranscript } = VIDEO;
  void transcript;
  await assert.rejects(
    () => extractVideo("dQw4w9WgXcQ", "en", ok(withoutTranscript)),
    (error: unknown) => {
      const e = error as ExtractionError;
      assert.equal(e.code, "CONTRACT_MISMATCH");
      assert.match(e.message, /transcript/);
      return true;
    },
  );
});

test("accepts a payload with null chapters and duration", async () => {
  const video = await extractVideo(
    "dQw4w9WgXcQ",
    "en",
    ok({ ...VIDEO, chapters: null, durationSeconds: null, uploadDate: null }),
  );
  assert.equal(video.chapters, null);
  assert.equal(video.durationSeconds, null);
});

test("rejects an unknown transcript source", async () => {
  await assert.rejects(
    () =>
      extractVideo(
        "dQw4w9WgXcQ",
        "en",
        ok({ ...VIDEO, transcript: { ...VIDEO.transcript, source: "whisper" } }),
      ),
    (error: unknown) => (error as ExtractionError).code === "CONTRACT_MISMATCH",
  );
});

// --------------------------------------------------- run-failure classification

/** execFile's error shape: `cmd` is always present on a real ExecException. */
const runFailure = (error: Error, extra: Record<string, unknown>): ExecException =>
  Object.assign(error, { cmd: "docker compose run", ...extra }) as ExecException;

test("a missing docker is a setup problem, not a bad video", () => {
  // Exit 1 matches how a missing `claude` is reported: "your machine is not
  // set up" rather than "this video could not be read".
  const error = classifyRunFailure(runFailure(new Error("spawn docker ENOENT"), {
    code: "ENOENT",
  }));
  assert.equal(error.code, "DOCKER_UNAVAILABLE");
  assert.equal(error.exitCode, 1);
});

test("a killed process is reported as a timeout, not a missing docker", () => {
  // The first run also builds the image, which is exactly when this fires.
  const error = classifyRunFailure(runFailure(new Error("timed out"), {
    killed: true,
    signal: "SIGTERM" as const,
  }));
  assert.equal(error.code, "EXTRACTOR_TIMEOUT");
  assert.equal(error.exitCode, 3);
  assert.match(error.message, /docker compose build extractor/);
});

test("an oversized output is reported as such", () => {
  const error = classifyRunFailure(runFailure(new Error("stdout maxBuffer exceeded"), {
    code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
  }));
  assert.equal(error.code, "UPSTREAM_ERROR");
  assert.equal(error.exitCode, 3);
});

test("an unrecognised run failure keeps its message", () => {
  const error = classifyRunFailure(runFailure(new Error("permission denied"), {
    code: "EACCES",
  }));
  assert.equal(error.code, "DOCKER_UNAVAILABLE");
  assert.match(error.message, /permission denied/);
});
