/**
 * The model's output contract. Single source of truth for the request format,
 * the `--json` output, and the Markdown renderer's input.
 *
 * Converted with `z.toJSONSchema()` and handed to `claude --json-schema`, then
 * validated back against this same schema on the way in.
 *
 * Constraints this schema respects:
 *  - no optional fields (absent values are expressed as nullable via anyOf)
 *  - no recursion
 *  - no numeric/length constraints: they would be enforced on our side after
 *    the fact rather than shaping generation, so a violation would surface as
 *    a hard failure instead of a shorter sentence. Guidance that needs to
 *    reach the model goes in `.describe()`, which becomes the JSON Schema
 *    `description` the model actually reads.
 */

import { z } from "zod";

export const SummarySchema = z.object({
  tldr: z
    .string()
    .describe(
      "Two or three sentences: what this video actually is and what it delivers. No hype, no restatement of the title.",
    ),

  payoff: z
    .object({
      answer: z
        .string()
        .describe(
          "The specific thing the title or opening promised, stated plainly and completely enough to act on without watching. If the video never delivers it, say so explicitly here.",
        ),
      timestampSeconds: z
        .number()
        .nullable()
        .describe(
          "Seconds into the video where the payoff is actually delivered, taken from a transcript timestamp. Null if it is never delivered.",
        ),
    })
    .describe("The reason someone clicked, extracted."),

  outline: z
    .array(
      z.object({
        startSeconds: z.number().describe("Start time, from a transcript timestamp."),
        title: z.string().describe("Short label for this stretch of the video."),
        summary: z.string().describe("What is actually said here, in one or two sentences."),
      }),
    )
    .describe(
      "Chronological outline derived from the transcript itself, not from the creator's chapter list. Enough entries to navigate the video, no more.",
    ),

  verdict: z
    .object({
      worthWatching: z
        .enum(["yes", "skim", "no"])
        .describe(
          "'yes' if watching adds something this summary cannot convey; 'skim' if only a section is worth it; 'no' if the summary is a complete substitute.",
        ),
      reason: z.string().describe("One or two sentences justifying the verdict."),
      whoItsFor: z
        .string()
        .describe("The specific situation or person this genuinely helps."),
      prerequisites: z
        .array(z.string())
        .describe(
          "Assumptions the advice depends on -- budget, country, equipment, prior knowledge, job type. Empty array if it applies broadly.",
        ),
    })
    .describe("Whether to spend the time, and whether it applies to this viewer."),

  labels: z
    .object({
      verdict: z
        .string()
        .describe(
          'Heading for the verdict section, matching worthWatching. In English exactly "Worth watching", "Worth skimming", or "Not worth watching".',
        ),
      payoff: z.string().describe('In English exactly "The payoff".'),
      inShort: z.string().describe('In English exactly "In short".'),
      whoItsFor: z.string().describe(`In English exactly "Who it's for".`),
      assumes: z.string().describe('In English exactly "Assumes:".'),
      outline: z.string().describe('In English exactly "Outline".'),
      deliveredAt: z
        .string()
        .describe(
          'Precedes the payoff timestamp, as in "Delivered at 12:34". In English exactly "Delivered at".',
        ),
      autoCaptionNote: z
        .string()
        .describe(
          'One sentence shown when the transcript came from auto-generated captions. In English exactly "Built from YouTube\'s auto-generated captions, which mangle names and jargon. Check anything surprising against the timestamp."',
        ),
    })
    .describe(
      "Section labels for the rendered document, in the same language as the rest of the output. Keep them short and free of trailing punctuation except where the English reference has it.",
    ),
});

export type Summary = z.infer<typeof SummarySchema>;
