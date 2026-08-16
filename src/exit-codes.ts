/**
 * Error -> process exit code.
 *
 * Lives apart from cli.ts because that module runs `main()` on import, so the
 * mapping would otherwise be untestable -- and this table is a documented part
 * of the tool's contract (see the exit-code table in README.md).
 */

import {
  ClaudeInvocationError,
  ClaudeUnavailableError,
  ModelRefusedError,
  OutputTruncatedError,
} from "./claude-cli.ts";
import { ExtractionError } from "./extractor.ts";
import { MalformedSummaryError } from "./summarize.ts";
import { InvalidVideoUrlError } from "./video-id.ts";

export const EXIT_OK = 0;
export const EXIT_USAGE = 1;
export const EXIT_NO_TRANSCRIPT = 2;
export const EXIT_EXTRACTION = 3;
export const EXIT_MODEL = 4;

/**
 * Returns null for anything unrecognised, so the caller rethrows rather than
 * inventing an exit code for a bug.
 */
export function exitCodeFor(error: unknown): number | null {
  // The extractor already classified itself -- 2 for "no usable transcript",
  // 3 for an unreadable video, 1 for a missing docker.
  if (error instanceof ExtractionError) return error.exitCode;

  // A missing or logged-out `claude` is a setup problem, not a model failure:
  // the fix is a command the user runs, not a retry.
  if (error instanceof ClaudeUnavailableError) return EXIT_USAGE;
  if (error instanceof InvalidVideoUrlError) return EXIT_USAGE;

  if (
    error instanceof ModelRefusedError ||
    error instanceof OutputTruncatedError ||
    error instanceof MalformedSummaryError ||
    error instanceof ClaudeInvocationError
  ) {
    return EXIT_MODEL;
  }

  return null;
}
