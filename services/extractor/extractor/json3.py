"""Parser for YouTube's `json3` caption format.

yt-dlp downloads json3 verbatim and hands conversion to ffmpeg, so there is no
upstream implementation to follow. The rules below were derived from captured
tracks and are pinned by the fixtures in tests/fixtures/.

Shape:

    {"wireMagic": "pb3",
     "events": [{"tStartMs": 0, "dDurationMs": 1620,
                 "segs": [{"utf8": "hello", "tOffsetMs": 0}]}]}

Why json3 and not VTT: measured on one auto-generated track (fixture
`auto-captions.json3.json`, 646 events), the VTT rendering of the *same* track
carries 6757 words against json3's 2253 -- exactly 3.00x -- because VTT re-emits
the previous line in each cue to drive scroll-up rendering. That is 3x the
tokens and a far worse transcript.

Three things bite naive parsers:

1. Not every event has `segs` -- window and style definitions (`wpWinPosId`,
   `wsWinStyleId`) do not, and indexing into them raises.
2. Auto-generated tracks interleave events flagged `aAppend: 1`. In the
   captured fixture all 322 of them contain exactly `"\\n"`: they are
   scroll-advance markers, not text. Dropping them avoids emitting empty
   segments carrying misleading timestamps.
3. `tStartMs` may be absent on the first event.
"""

from __future__ import annotations

from typing import Any, NamedTuple

# Below this length a shared prefix is more likely to be a genuine repeated
# phrase ("okay so", "and then") than a rolling duplicate, so we leave it be.
_MIN_PREFIX_STRIP = 12


class Segment(NamedTuple):
    start: float
    text: str


def parse(payload: dict[str, Any]) -> list[Segment]:
    """Turn a decoded json3 document into ordered, de-duplicated segments."""
    collected: list[Segment] = []
    for event in payload.get("events") or []:
        if not isinstance(event, dict):
            continue
        segs = event.get("segs")
        if not segs:
            continue
        if event.get("aAppend"):
            continue
        text = _normalise("".join(seg.get("utf8") or "" for seg in segs))
        if not text:
            continue
        collected.append(Segment(_seconds(event.get("tStartMs")), text))
    return _dedupe(collected)


def _normalise(text: str) -> str:
    # Auto-captions wrap mid-phrase; collapse all whitespace to single spaces
    # so the transcript reads as prose and costs fewer tokens.
    return " ".join(text.split())


def _seconds(value: Any) -> float:
    if not isinstance(value, (int, float)):
        return 0.0
    return round(max(0.0, float(value)) / 1000.0, 3)


def _dedupe(segments: list[Segment]) -> list[Segment]:
    """Drop exact repeats and strip rolling prefixes that survived `aAppend`.

    Deliberately conservative: this runs after the `aAppend` filter has already
    removed the structural duplicates, so it only needs to catch residue. Over-
    stripping would silently delete real speech, which is worse than leaving a
    duplicated phrase in.
    """
    out: list[Segment] = []
    for segment in segments:
        start, text = segment
        if out:
            previous = out[-1]
            # Keep timestamps monotonic without discarding the text.
            start = max(start, previous.start)
            if text == previous.text:
                continue
            if (
                len(previous.text) >= _MIN_PREFIX_STRIP
                and text.startswith(previous.text + " ")
            ):
                text = text[len(previous.text) :].strip()
                if not text:
                    continue
        out.append(Segment(start, text))
    return out
