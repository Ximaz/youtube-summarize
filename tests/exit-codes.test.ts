/**
 * The exit-code table is a documented contract (README.md), so it gets a test.
 * The mapping lives in its own module precisely so this file can import it
 * without cli.ts running main() on import.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ClaudeInvocationError,
  ClaudeUnavailableError,
  ModelRefusedError,
  OutputTruncatedError,
} from "../src/claude-cli.ts";
import { ExtractionError } from "../src/extractor.ts";
import { exitCodeFor } from "../src/exit-codes.ts";
import { MalformedSummaryError } from "../src/summarize.ts";
import { InvalidVideoUrlError } from "../src/video-id.ts";

test("a missing transcript is exit 2, the designed failure", () => {
  const error = new ExtractionError({ code: "NO_CAPTIONS", message: "none", exitCode: 2 });
  assert.equal(exitCodeFor(error), 2);
});

test("an unreadable video is exit 3", () => {
  const error = new ExtractionError({ code: "AGE_RESTRICTED", message: "gated", exitCode: 3 });
  assert.equal(exitCodeFor(error), 3);
});

test("a missing docker is exit 1, not exit 3", () => {
  // Carried through from the extractor's own classification.
  const error = new ExtractionError({
    code: "DOCKER_UNAVAILABLE",
    message: "docker not found",
    exitCode: 1,
  });
  assert.equal(exitCodeFor(error), 1);
});

test("a missing or logged-out claude is exit 1, not a model failure", () => {
  // The fix is a command the user runs, not a retry -- so it must not be
  // reported as "the model call failed".
  assert.equal(exitCodeFor(new ClaudeUnavailableError("not logged in")), 1);
});

test("a bad URL is exit 1", () => {
  assert.equal(exitCodeFor(new InvalidVideoUrlError("not youtube")), 1);
});

test("every model-side failure is exit 4", () => {
  for (const error of [
    new ModelRefusedError("declined"),
    new OutputTruncatedError("truncated"),
    new MalformedSummaryError("bad json"),
    new ClaudeInvocationError("cli blew up"),
  ]) {
    assert.equal(exitCodeFor(error), 4, error.name);
  }
});

test("an unrecognised error is not given an exit code", () => {
  // null means "rethrow": a bug should surface as a stack trace, not be
  // laundered into a documented failure mode.
  assert.equal(exitCodeFor(new TypeError("undefined is not a function")), null);
  assert.equal(exitCodeFor("a string"), null);
});
