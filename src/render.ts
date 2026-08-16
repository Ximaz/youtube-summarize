/**
 * Summary -> Markdown. Pure: no I/O, no formatting decisions upstream.
 *
 * Verdict and payoff lead, because they are the two questions the tool exists
 * to answer. Everything else is there to be skipped.
 *
 * Section labels come from the model rather than from constants here, so that a
 * summary requested in French is French throughout instead of French prose
 * under English headings. See src/language.ts.
 */

import type { Video } from "./extractor.ts";
import type { Summary } from "./schema.ts";

/**
 * C0 and C1 control characters, keeping tab and newline.
 *
 * Everything rendered here is either attacker-controlled (video title, channel)
 * or model-generated from attacker-controlled input, and it is written to a
 * terminal. ESC (0x1B) in a video title would otherwise emit raw ANSI: colour
 * and cursor control at best, and at worst text that rewrites what the reader
 * sees the tool concluding.
 */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

function safe(text: string): string {
  return text.replace(CONTROL_CHARS, "");
}

/** Labels additionally collapse whitespace so none can break a heading. */
function label(text: string): string {
  return safe(text).replace(/\s+/g, " ").trim();
}

export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function link(videoId: string, seconds: number): string {
  return `https://www.youtube.com/watch?v=${videoId}&t=${Math.max(0, Math.floor(seconds))}s`;
}

export function renderMarkdown(video: Video, summary: Summary): string {
  const labels = summary.labels;
  const facts = [
    label(video.channel),
    video.uploadDate,
    video.durationSeconds ? formatTimestamp(video.durationSeconds) : null,
    `${video.transcript.source} captions (${label(video.transcript.lang)})`,
  ].filter(Boolean);

  const out: string[] = [
    `# ${label(video.title)}`,
    "",
    facts.join(" · "),
    "",
    `## ${label(labels.verdict)}`,
    "",
    safe(summary.verdict.reason),
    "",
    `## ${label(labels.payoff)}`,
    "",
    safe(summary.payoff.answer),
  ];

  if (summary.payoff.timestampSeconds !== null) {
    const t = summary.payoff.timestampSeconds;
    out.push(
      "",
      `${label(labels.deliveredAt)} **${formatTimestamp(t)}** — ${link(video.id, t)}`,
    );
  }

  out.push(
    "",
    `## ${label(labels.inShort)}`,
    "",
    safe(summary.tldr),
    "",
    `## ${label(labels.whoItsFor)}`,
    "",
    safe(summary.verdict.whoItsFor),
  );

  if (summary.verdict.prerequisites.length > 0) {
    out.push("", `**${label(labels.assumes)}**`, "");
    for (const prerequisite of summary.verdict.prerequisites) {
      out.push(`- ${label(prerequisite)}`);
    }
  }

  if (summary.outline.length > 0) {
    out.push("", `## ${label(labels.outline)}`, "");
    for (const entry of summary.outline) {
      out.push(
        `- [${formatTimestamp(entry.startSeconds)}](${link(video.id, entry.startSeconds)}) **${label(entry.title)}** — ${safe(entry.summary)}`,
      );
    }
  }

  // The transcript source is a caveat worth carrying: an auto-caption summary
  // inherits whatever the ASR made of proper nouns and jargon.
  if (video.transcript.source === "automatic") {
    out.push("", "---", "", `_${label(labels.autoCaptionNote)}_`);
  }

  return `${out.join("\n")}\n`;
}
