# Fixtures

`auto-captions.json3.json` — a **real** json3 caption track, captured from
YouTube video `8jPQjjsBbIc` (`automatic_captions["en"]`) via the extractor's own
fetch path. Trimmed to the first 150 of 646 events to keep the repository small;
the slice preserves every structural feature the parser has to handle:

| feature | count in slice |
|---|---|
| `aAppend: 1` scroll markers (payload is exactly `"\n"`) | 74 |
| events with no `segs` key (window/style definitions) | 1 |

Captured rather than synthesised because yt-dlp ships no json3 parser — there is
no upstream implementation to validate against, so the format's real shape is
the only reliable oracle.

Measured on the untrimmed track: the VTT rendering of this same track contains
6757 words against json3's 2253 — exactly 3.00×, because VTT re-emits the
previous line in every cue. That measurement is why the extractor requests
json3.
