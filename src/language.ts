/**
 * Output language, derived from --lang.
 *
 * `--lang` is a caption-track preference first; this reuses it as the answer's
 * language, on the reasoning that someone who asks for French captions wants a
 * French summary. Anything that is not a recognisable language tag -- `any`, a
 * typo, an empty value -- falls back to English rather than guessing.
 */

export interface OutputLanguage {
  /** Canonical BCP-47 tag, e.g. "fr", "pt-BR". */
  code: string;
  /** English display name, e.g. "French", "Brazilian Portuguese". */
  name: string;
}

export const DEFAULT_LANGUAGE: OutputLanguage = { code: "en", name: "English" };

export function resolveOutputLanguage(langOption: string): OutputLanguage {
  // --lang takes a preference list; the first entry is what the reader wants.
  const first = langOption.split(",")[0]?.trim() ?? "";
  if (!first || first.toLowerCase() === "any") return DEFAULT_LANGUAGE;

  // "en-orig" is yt-dlp's name for an original-audio track, not a locale.
  const cleaned = first.replace(/-orig$/i, "");

  let canonical: string;
  try {
    canonical = Intl.getCanonicalLocales(cleaned)[0] ?? "";
  } catch {
    return DEFAULT_LANGUAGE; // malformed tag
  }
  if (!canonical) return DEFAULT_LANGUAGE;

  const display = new Intl.DisplayNames(["en"], { type: "language" });
  const base = canonical.split("-")[0] ?? canonical;

  // Intl echoes an unknown subtag back unchanged ("zz" -> "zz"), which is how
  // we tell a real language from a plausible-looking one.
  const baseName = display.of(base);
  if (!baseName || baseName.toLowerCase() === base.toLowerCase()) {
    return DEFAULT_LANGUAGE;
  }

  return { code: canonical, name: display.of(canonical) ?? baseName };
}

/**
 * Caption language and answer language are separate concerns.
 *
 * Coupling them outright would make the main use case impossible: asking for a
 * French summary would require the video to carry French captions, so a French
 * reader could never summarise an English video. `--lang` therefore only
 * supplies the default, and `--answer-lang` overrides it.
 */
export function chooseAnswerLanguage(
  langOption: string,
  answerLangOption: string,
): OutputLanguage {
  return resolveOutputLanguage(answerLangOption.trim() || langOption);
}
