"""json3 parser tests.

The real fixture is the primary oracle; the synthetic cases below cover shapes
the captured slice happens not to contain.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from extractor.json3 import parse

FIXTURE = Path(__file__).parent / "fixtures" / "auto-captions.json3.json"


def event(text: str | None = None, start: int | None = None, **extra):
    ev: dict = {}
    if start is not None:
        ev["tStartMs"] = start
    if text is not None:
        ev["segs"] = [{"utf8": text}]
    ev.update(extra)
    return ev


def doc(*events):
    return {"wireMagic": "pb3", "events": list(events)}


class RealTrack(unittest.TestCase):
    def setUp(self):
        self.raw = json.loads(FIXTURE.read_text())
        self.segments = parse(self.raw)

    def test_produces_segments(self):
        self.assertGreater(len(self.segments), 50)

    def test_no_empty_text(self):
        self.assertTrue(all(s.text.strip() for s in self.segments))

    def test_timestamps_are_monotonic(self):
        starts = [s.start for s in self.segments]
        self.assertEqual(starts, sorted(starts))

    def test_no_scroll_markers_survive(self):
        # Every aAppend event in this track is a bare newline.
        self.assertFalse(any(s.text == "\n" for s in self.segments))

    def test_drops_exactly_the_non_text_events(self):
        events = self.raw["events"]
        text_bearing = [e for e in events if e.get("segs") and not e.get("aAppend")]
        self.assertEqual(len(self.segments), len(text_bearing))

    def test_keeps_every_word(self):
        # Scroll markers carry no words, so dropping them must not lose text.
        naive = " ".join(
            "".join(s.get("utf8", "") for s in (e.get("segs") or []))
            for e in self.raw["events"]
        )
        parsed = " ".join(s.text for s in self.segments)
        self.assertEqual(len(parsed.split()), len(naive.split()))


class StructuralRules(unittest.TestCase):
    def test_drops_events_without_segs(self):
        # Window/style definitions: indexing into them is what breaks naive parsers.
        result = parse(doc(
            {"tStartMs": 0, "id": 1, "wpWinPosId": 1, "wsWinStyleId": 1},
            event("hello", start=1000),
        ))
        self.assertEqual([s.text for s in result], ["hello"])

    def test_drops_scroll_markers(self):
        result = parse(doc(
            event("first", start=0),
            event("\n", start=500, aAppend=1),
            event("second", start=1000),
        ))
        self.assertEqual([s.text for s in result], ["first", "second"])

    def test_missing_tstartms_is_zero(self):
        self.assertEqual(parse(doc(event("hi")))[0].start, 0.0)

    def test_joins_multiple_segs(self):
        result = parse(doc({"tStartMs": 0, "segs": [
            {"utf8": "a"}, {"utf8": " few"}, {"utf8": " words"},
        ]}))
        self.assertEqual(result[0].text, "a few words")

    def test_normalises_whitespace(self):
        result = parse(doc(event("  ragged\n  wrapped   text \n", start=0)))
        self.assertEqual(result[0].text, "ragged wrapped text")

    def test_drops_whitespace_only_events(self):
        self.assertEqual(parse(doc(event("   \n  ", start=0))), [])

    def test_tolerates_missing_utf8_key(self):
        result = parse(doc({"tStartMs": 0, "segs": [{"acAsrConf": 0}, {"utf8": "ok"}]}))
        self.assertEqual(result[0].text, "ok")

    def test_ignores_non_dict_events(self):
        self.assertEqual([s.text for s in parse(doc("junk", 42, event("ok")))], ["ok"])

    def test_handles_absent_events_key(self):
        self.assertEqual(parse({"wireMagic": "pb3"}), [])

    def test_milliseconds_convert_to_seconds(self):
        self.assertEqual(parse(doc(event("hi", start=12340)))[0].start, 12.34)


class Deduplication(unittest.TestCase):
    def test_drops_exact_repeat(self):
        result = parse(doc(event("same text here", start=0), event("same text here", start=1000)))
        self.assertEqual(len(result), 1)

    def test_strips_rolling_prefix(self):
        result = parse(doc(
            event("a long enough opening line", start=0),
            event("a long enough opening line and the rest", start=1000),
        ))
        self.assertEqual([s.text for s in result],
                         ["a long enough opening line", "and the rest"])

    def test_leaves_short_repeats_alone(self):
        # "okay so" is a genuine spoken repeat, not a rolling artefact.
        result = parse(doc(event("okay so", start=0), event("okay so we begin", start=1000)))
        self.assertEqual([s.text for s in result], ["okay so", "okay so we begin"])

    def test_requires_word_boundary(self):
        result = parse(doc(event("transcription", start=0), event("transcriptions plural", start=1000)))
        self.assertEqual([s.text for s in result], ["transcription", "transcriptions plural"])

    def test_clamps_out_of_order_timestamps(self):
        result = parse(doc(event("first", start=5000), event("second", start=1000)))
        self.assertEqual([s.start for s in result], [5.0, 5.0])
        self.assertEqual([s.text for s in result], ["first", "second"])


if __name__ == "__main__":
    unittest.main()
