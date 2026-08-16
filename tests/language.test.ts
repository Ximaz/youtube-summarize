import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LANGUAGE, resolveOutputLanguage } from "../src/language.ts";

const RECOGNISED: [string, string, string][] = [
  // --lang value          -> code,    name
  ["fr", "fr", "French"],
  ["de", "de", "German"],
  ["ja", "ja", "Japanese"],
  ["FR", "fr", "French"], // canonicalised
  ["  fr  ", "fr", "French"], // trimmed
  ["pt-BR", "pt-BR", "Brazilian Portuguese"], // regional variant preserved
  ["fr-CA", "fr-CA", "Canadian French"],
  ["es-419", "es-419", "Latin American Spanish"],
];

for (const [input, code, name] of RECOGNISED) {
  test(`resolves ${JSON.stringify(input)} to ${name}`, () => {
    assert.deepEqual(resolveOutputLanguage(input), { code, name });
  });
}

test("takes the first entry of a preference list", () => {
  // --lang de,en means "German captions, else English" -- the reader wants German.
  assert.equal(resolveOutputLanguage("de,en").name, "German");
});

test("ignores whitespace around list entries", () => {
  assert.equal(resolveOutputLanguage(" de , en ").name, "German");
});

const FALLBACKS = ["any", "ANY", "", "   ", "zz", "xx-YY", "not-a-language", "123"];

for (const input of FALLBACKS) {
  test(`falls back to English for ${JSON.stringify(input)}`, () => {
    assert.deepEqual(resolveOutputLanguage(input), DEFAULT_LANGUAGE);
  });
}

test("English stays English rather than being treated as unrecognised", () => {
  assert.deepEqual(resolveOutputLanguage("en"), { code: "en", name: "English" });
});

test("strips yt-dlp's original-audio suffix", () => {
  // "en-orig" is a track name, not a locale; without stripping it, Intl would
  // reject it and silently drop the user back to English.
  assert.equal(resolveOutputLanguage("fr-orig").name, "French");
});

test("does not throw on malformed tags", () => {
  for (const input of ["-", "--", "a-b-c-d-e-f", "!!"]) {
    assert.doesNotThrow(() => resolveOutputLanguage(input));
    assert.deepEqual(resolveOutputLanguage(input), DEFAULT_LANGUAGE);
  }
});
