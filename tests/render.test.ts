import { test } from "node:test";
import assert from "node:assert/strict";
import type { Video } from "../src/extractor.ts";
import type { Summary } from "../src/schema.ts";
import { formatTimestamp, renderMarkdown } from "../src/render.ts";

const VIDEO: Video = {
  id: "dQw4w9WgXcQ",
  title: "Your life sucks? Do this FIRST",
  channel: "Advice Channel",
  channelId: "UC123",
  uploadDate: "2026-08-16",
  durationSeconds: 1832,
  description: "",
  chapters: null,
  liveStatus: "not_live",
  availability: "public",
  ageLimit: 0,
  transcript: { source: "manual", lang: "en", segments: [] },
};

const SUMMARY: Summary = {
  tldr: "Thirty minutes of anecdote around one suggestion.",
  payoff: { answer: "Write down three tasks the night before.", timestampSeconds: 754 },
  outline: [
    { startSeconds: 0, title: "Cold open", summary: "A story about a bad year." },
    { startSeconds: 754, title: "The tip", summary: "The actual advice, finally." },
  ],
  verdict: {
    worthWatching: "skim",
    reason: "The single idea is stated in one sentence at 12:34.",
    whoItsFor: "People who feel scattered in the morning.",
    prerequisites: ["Willingness to plan the night before"],
  },
  labels: {
    verdict: "Worth skimming",
    payoff: "The payoff",
    inShort: "In short",
    whoItsFor: "Who it's for",
    assumes: "Assumes:",
    outline: "Outline",
    deliveredAt: "Delivered at",
    autoCaptionNote:
      "Built from YouTube's auto-generated captions, which mangle names and jargon.",
  },
};

/** The same summary as it would come back for `--lang fr`. */
const FRENCH: Summary = {
  ...SUMMARY,
  labels: {
    verdict: "À survoler",
    payoff: "L'essentiel",
    inShort: "En bref",
    whoItsFor: "Pour qui",
    assumes: "Suppose :",
    outline: "Plan",
    deliveredAt: "Énoncé à",
    autoCaptionNote: "Établi à partir des sous-titres générés automatiquement.",
  },
};

test("formats timestamps under and over an hour", () => {
  assert.equal(formatTimestamp(0), "0:00");
  assert.equal(formatTimestamp(65), "1:05");
  assert.equal(formatTimestamp(754), "12:34");
  assert.equal(formatTimestamp(3725), "1:02:05");
});

test("clamps negative timestamps", () => {
  assert.equal(formatTimestamp(-5), "0:00");
});

test("leads with the verdict and the payoff", () => {
  const md = renderMarkdown(VIDEO, SUMMARY);
  const verdictAt = md.indexOf("Worth skimming");
  const payoffAt = md.indexOf("## The payoff");
  const outlineAt = md.indexOf("## Outline");
  assert.ok(verdictAt > 0 && payoffAt > verdictAt && outlineAt > payoffAt);
});

test("links the payoff to the exact second", () => {
  assert.match(
    renderMarkdown(VIDEO, SUMMARY),
    /https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ&t=754s/,
  );
});

test("renders each outline entry as a deep link", () => {
  const md = renderMarkdown(VIDEO, SUMMARY);
  assert.match(md, /\[0:00\]\(https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ&t=0s\)/);
  assert.match(md, /\[12:34\]\(https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ&t=754s\)/);
});

test("lists prerequisites when the advice is conditional", () => {
  assert.match(renderMarkdown(VIDEO, SUMMARY), /\*\*Assumes:\*\*/);
});

test("omits the assumptions block when the advice applies broadly", () => {
  const md = renderMarkdown(VIDEO, {
    ...SUMMARY,
    verdict: { ...SUMMARY.verdict, prerequisites: [] },
  });
  assert.doesNotMatch(md, /Assumes:/);
});

test("says plainly when the payoff is never delivered", () => {
  const md = renderMarkdown(VIDEO, {
    ...SUMMARY,
    payoff: { answer: "The video never states it.", timestampSeconds: null },
  });
  assert.match(md, /The video never states it\./);
  assert.doesNotMatch(md, /Delivered at/);
});

test("flags auto-generated captions as a caveat", () => {
  const md = renderMarkdown(
    { ...VIDEO, transcript: { ...VIDEO.transcript, source: "automatic" } },
    SUMMARY,
  );
  assert.match(md, /auto-generated captions/);
});

test("does not add the caveat for human captions", () => {
  assert.doesNotMatch(renderMarkdown(VIDEO, SUMMARY), /auto-generated captions/);
});

test("renders every section heading in the summary's language", () => {
  const md = renderMarkdown(VIDEO, FRENCH);
  assert.match(md, /## À survoler/);
  assert.match(md, /## L'essentiel/);
  assert.match(md, /## En bref/);
  assert.match(md, /## Pour qui/);
  assert.match(md, /## Plan/);
  assert.match(md, /\*\*Suppose :\*\*/);
  assert.match(md, /Énoncé à \*\*12:34\*\*/);
});

test("leaves no English chrome in a translated summary", () => {
  // The whole point: French prose under English headings is a half-done job.
  const md = renderMarkdown(VIDEO, FRENCH);
  for (const english of [
    "## The payoff",
    "## In short",
    "## Who it's for",
    "## Outline",
    "Worth skimming",
    "Delivered at",
    "Assumes:",
  ]) {
    assert.ok(!md.includes(english), `expected no English chrome, found: ${english}`);
  }
});

test("uses the translated caption caveat too", () => {
  const md = renderMarkdown(
    { ...VIDEO, transcript: { ...VIDEO.transcript, source: "automatic" } },
    FRENCH,
  );
  assert.match(md, /sous-titres générés automatiquement/);
  assert.doesNotMatch(md, /auto-generated captions/);
});

test("strips ANSI escapes from an attacker-controlled title", () => {
  // A video title is written by a stranger and lands on a terminal. Raw ESC
  // would let it repaint the screen -- including what the tool appears to say.
  const ESC = "\u001B";
  const md = renderMarkdown({ ...VIDEO, title: `Nice ${ESC}[31mvideo${ESC}[0m` }, SUMMARY);
  assert.ok(!md.includes(ESC), "ESC must not reach the terminal");
  assert.match(md, /# Nice \[31mvideo\[0m/);
});

test("strips control characters from model-produced prose", () => {
  const md = renderMarkdown(VIDEO, {
    ...SUMMARY,
    tldr: "before\u0007\u001B]0;pwned\u0007after",
    payoff: { answer: "answer\u0000here", timestampSeconds: null },
  });
  assert.doesNotMatch(md, /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/);
  assert.match(md, /answerhere/);
  // Only the control bytes are removed; the OSC payload is printable text and
  // survives as inert characters, which is the intended outcome.
  assert.match(md, /before\]0;pwnedafter/);
});

test("keeps newlines in prose so paragraphs survive", () => {
  const md = renderMarkdown(VIDEO, { ...SUMMARY, tldr: "line one\nline two" });
  assert.match(md, /line one\nline two/);
});

test("collapses whitespace in labels so none can break a heading", () => {
  const md = renderMarkdown(VIDEO, {
    ...SUMMARY,
    labels: { ...SUMMARY.labels, payoff: "The\n\npayoff  section" },
  });
  assert.match(md, /## The payoff section\n/);
});

test("survives a video with no duration or upload date", () => {
  const md = renderMarkdown({ ...VIDEO, durationSeconds: null, uploadDate: null }, SUMMARY);
  assert.match(md, /# Your life sucks\? Do this FIRST/);
  assert.match(md, /Advice Channel/);
});
