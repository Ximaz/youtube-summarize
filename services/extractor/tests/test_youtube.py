"""Track selection, availability gating, and error classification.

None of these touch the network: they exercise the pure decision logic that
sits between yt-dlp's info dict and the JSON contract.
"""

from __future__ import annotations

import unittest

from extractor.errors import ExtractorError, classify_download_error
from extractor.youtube import _chapters, _upload_date, gate, select_track


def track(ext: str = "json3"):
    return [{"ext": ext, "url": f"https://example.invalid/{ext}", "impersonate": True}]


def info(**overrides):
    base = {
        "id": "abcdefghijk",
        "title": "t",
        "availability": "public",
        "live_status": "not_live",
        "age_limit": 0,
    }
    base.update(overrides)
    return base


class Selection(unittest.TestCase):
    def test_prefers_manual_over_automatic(self):
        chosen = select_track(
            info(subtitles={"en": track()}, automatic_captions={"en": track()}), ["en"]
        )
        self.assertEqual((chosen.source, chosen.lang), ("manual", "en"))

    def test_matches_regional_variant(self):
        chosen = select_track(info(subtitles={"en-GB": track()}), ["en"])
        self.assertEqual(chosen.lang, "en-GB")

    def test_exact_match_beats_variant(self):
        chosen = select_track(info(subtitles={"en-GB": track(), "en": track()}), ["en"])
        self.assertEqual(chosen.lang, "en")

    def test_prefers_original_audio_track(self):
        chosen = select_track(
            info(automatic_captions={"en-GB": track(), "en-orig": track()}, language="en"),
            ["en"],
        )
        self.assertEqual(chosen.lang, "en-orig")

    def test_honours_language_preference_order(self):
        chosen = select_track(info(subtitles={"en": track(), "fr": track()}), ["fr", "en"])
        self.assertEqual(chosen.lang, "fr")

    def test_falls_through_to_second_preference(self):
        chosen = select_track(info(subtitles={"en": track()}), ["de", "en"])
        self.assertEqual(chosen.lang, "en")

    def test_refuses_machine_translated_track(self):
        # English audio, so automatic_captions["de"] is a translation of a
        # transcription -- refused rather than silently summarised.
        with self.assertRaises(ExtractorError) as ctx:
            select_track(info(automatic_captions={"de": track()}, language="en"), ["de"])
        self.assertEqual(ctx.exception.code, "WRONG_LANGUAGE")

    def test_accepts_automatic_track_in_spoken_language(self):
        chosen = select_track(info(automatic_captions={"de": track()}, language="de"), ["de"])
        self.assertEqual((chosen.source, chosen.lang), ("automatic", "de"))

    def test_accepts_automatic_when_language_unknown(self):
        chosen = select_track(info(automatic_captions={"de": track()}), ["de"])
        self.assertEqual(chosen.source, "automatic")

    def test_manual_translation_is_allowed(self):
        # A human-provided translation is a legitimate transcript.
        chosen = select_track(info(subtitles={"de": track()}, language="en"), ["de"])
        self.assertEqual((chosen.source, chosen.lang), ("manual", "de"))

    def test_no_tracks_at_all(self):
        with self.assertRaises(ExtractorError) as ctx:
            select_track(info(), ["en"])
        self.assertEqual(ctx.exception.code, "NO_CAPTIONS")
        self.assertEqual(ctx.exception.exit_code, 2)

    def test_wrong_language_lists_what_exists(self):
        with self.assertRaises(ExtractorError) as ctx:
            select_track(
                info(subtitles={"fr": track()}, automatic_captions={"en-orig": track()}),
                ["ja"],
            )
        self.assertEqual(ctx.exception.code, "WRONG_LANGUAGE")
        self.assertEqual(ctx.exception.extra["availableLangs"], ["en-orig", "fr"])

    def test_any_picks_spoken_language(self):
        chosen = select_track(
            info(automatic_captions={"en-orig": track(), "de": track()}, language="en"), None
        )
        self.assertEqual(chosen.lang, "en-orig")

    def test_any_accepts_sole_manual_track(self):
        chosen = select_track(info(subtitles={"ja": track()}), None)
        self.assertEqual((chosen.source, chosen.lang), ("manual", "ja"))

    def test_ignores_live_chat_pseudo_track(self):
        with self.assertRaises(ExtractorError) as ctx:
            select_track(info(subtitles={"live_chat": track()}), ["en"])
        self.assertEqual(ctx.exception.code, "NO_CAPTIONS")

    def test_skips_language_without_json3(self):
        with self.assertRaises(ExtractorError) as ctx:
            select_track(info(subtitles={"en": track("vtt")}), ["en"])
        self.assertEqual(ctx.exception.code, "WRONG_LANGUAGE")

    def test_picks_json3_from_the_format_list(self):
        entries = track("vtt") + track("srv3") + track("json3")
        chosen = select_track(info(subtitles={"en": entries}), ["en"])
        self.assertEqual(chosen.entry["ext"], "json3")


class Gating(unittest.TestCase):
    def test_public_video_passes(self):
        self.assertIsNone(gate(info()))

    def test_live_stream(self):
        with self.assertRaises(ExtractorError) as ctx:
            gate(info(live_status="is_live"))
        self.assertEqual(ctx.exception.code, "LIVE_OR_UPCOMING")

    def test_upcoming_premiere(self):
        with self.assertRaises(ExtractorError) as ctx:
            gate(info(live_status="is_upcoming"))
        self.assertEqual(ctx.exception.code, "LIVE_OR_UPCOMING")

    def test_finished_stream_is_allowed(self):
        self.assertIsNone(gate(info(live_status="was_live")))

    def test_members_only(self):
        with self.assertRaises(ExtractorError) as ctx:
            gate(info(availability="subscriber_only"))
        self.assertEqual(ctx.exception.code, "MEMBERS_ONLY")

    def test_premium_only(self):
        with self.assertRaises(ExtractorError) as ctx:
            gate(info(availability="premium_only"))
        self.assertEqual(ctx.exception.code, "PREMIUM_ONLY")

    def test_private(self):
        with self.assertRaises(ExtractorError) as ctx:
            gate(info(availability="private"))
        self.assertEqual(ctx.exception.code, "PRIVATE")

    def test_age_restricted_is_not_reported_as_missing_captions(self):
        with self.assertRaises(ExtractorError) as ctx:
            gate(info(age_limit=18))
        self.assertEqual(ctx.exception.code, "AGE_RESTRICTED")
        self.assertEqual(ctx.exception.exit_code, 3)


class ErrorClassification(unittest.TestCase):
    CASES = [
        ("ERROR: [youtube] x: Video unavailable", "VIDEO_NOT_FOUND"),
        ("ERROR: [youtube] x: Private video. Sign in if you've been granted access", "PRIVATE"),
        ("Join this channel to get access to members-only content", "MEMBERS_ONLY"),
        ("Sign in to confirm you're not a bot", "RATE_LIMITED"),
        ("HTTP Error 429: Too Many Requests", "RATE_LIMITED"),
        ("Sign in to confirm your age", "AGE_RESTRICTED"),
        ("This video is age-restricted", "AGE_RESTRICTED"),
        ("The uploader has not made this video available in your country", "GEO_BLOCKED"),
        ("This live event will begin in 3 hours", "LIVE_OR_UPCOMING"),
        ("something nobody predicted", "UPSTREAM_ERROR"),
    ]

    def test_messages_map_to_codes(self):
        for message, expected in self.CASES:
            with self.subTest(message=message):
                self.assertEqual(classify_download_error(Exception(message)).code, expected)

    def test_age_gate_wins_over_unavailability(self):
        # Both phrases present; the age gate is the actionable one.
        error = classify_download_error(
            Exception("Video unavailable. Sign in to confirm your age")
        )
        self.assertEqual(error.code, "AGE_RESTRICTED")

    def test_unknown_code_is_rejected(self):
        with self.assertRaises(AssertionError):
            ExtractorError("NOT_A_CODE", "x")

    def test_envelope_shape(self):
        payload = ExtractorError("NO_CAPTIONS", "none", availableLangs=["fr"]).to_dict()
        self.assertEqual(payload["error"]["code"], "NO_CAPTIONS")
        self.assertEqual(payload["error"]["availableLangs"], ["fr"])

    def test_envelope_omits_absent_extras(self):
        self.assertNotIn("availableLangs", ExtractorError("NO_CAPTIONS", "x").to_dict()["error"])


class Normalisation(unittest.TestCase):
    def test_upload_date(self):
        self.assertEqual(_upload_date("20260816"), "2026-08-16")

    def test_upload_date_rejects_junk(self):
        for value in (None, "", "2026-08-16", "abcdefgh"):
            with self.subTest(value=value):
                self.assertIsNone(_upload_date(value))

    def test_chapters_absent_is_none_not_empty_list(self):
        self.assertIsNone(_chapters(None))
        self.assertIsNone(_chapters([]))

    def test_chapters_are_camel_cased(self):
        result = _chapters([{"title": "Intro", "start_time": 0, "end_time": 12.5}])
        self.assertEqual(result, [{"title": "Intro", "startTime": 0.0, "endTime": 12.5}])

    def test_chapter_without_end_time(self):
        self.assertIsNone(_chapters([{"title": "x", "start_time": 3}])[0]["endTime"])


if __name__ == "__main__":
    unittest.main()
