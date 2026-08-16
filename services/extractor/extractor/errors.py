"""Error taxonomy shared by the extractor and, over the JSON contract, the CLI.

Exit codes are part of the contract:
    1  caller error (bad video id, bad usage)
    2  no usable transcript -- the designed failure mode of this tool
    3  the video could not be extracted
"""

from __future__ import annotations

from typing import Any

EXIT_USAGE = 1
EXIT_NO_TRANSCRIPT = 2
EXIT_UNAVAILABLE = 3

# code -> exit status
_EXIT_CODES = {
    "BAD_REQUEST": EXIT_USAGE,
    "NO_CAPTIONS": EXIT_NO_TRANSCRIPT,
    "WRONG_LANGUAGE": EXIT_NO_TRANSCRIPT,
    "VIDEO_NOT_FOUND": EXIT_UNAVAILABLE,
    "PRIVATE": EXIT_UNAVAILABLE,
    "MEMBERS_ONLY": EXIT_UNAVAILABLE,
    "PREMIUM_ONLY": EXIT_UNAVAILABLE,
    "AGE_RESTRICTED": EXIT_UNAVAILABLE,
    "LIVE_OR_UPCOMING": EXIT_UNAVAILABLE,
    "GEO_BLOCKED": EXIT_UNAVAILABLE,
    "RATE_LIMITED": EXIT_UNAVAILABLE,
    "UPSTREAM_ERROR": EXIT_UNAVAILABLE,
}


class ExtractorError(Exception):
    """Raised for every expected failure. Serialised to stderr as JSON."""

    def __init__(self, code: str, message: str, **extra: Any) -> None:
        super().__init__(message)
        if code not in _EXIT_CODES:
            raise AssertionError(f"unknown error code {code!r}")
        self.code = code
        self.message = message
        self.extra = {k: v for k, v in extra.items() if v is not None}

    @property
    def exit_code(self) -> int:
        return _EXIT_CODES[self.code]

    def to_dict(self) -> dict[str, Any]:
        return {"error": {"code": self.code, "message": self.message, **self.extra}}


# Substrings yt-dlp puts in DownloadError messages, most specific first. A
# video that is simultaneously unavailable and age-gated should report the
# age gate, so ordering matters.
_MESSAGE_PATTERNS: tuple[tuple[str, str], ...] = (
    ("sign in to confirm your age", "AGE_RESTRICTED"),
    ("confirm your age", "AGE_RESTRICTED"),
    ("age-restricted", "AGE_RESTRICTED"),
    ("inappropriate for some users", "AGE_RESTRICTED"),
    ("sign in to confirm you're not a bot", "RATE_LIMITED"),
    ("too many requests", "RATE_LIMITED"),
    ("http error 429", "RATE_LIMITED"),
    ("join this channel", "MEMBERS_ONLY"),
    ("members-only", "MEMBERS_ONLY"),
    ("available to this channel's members", "MEMBERS_ONLY"),
    ("youtube premium", "PREMIUM_ONLY"),
    ("private video", "PRIVATE"),
    ("this video is private", "PRIVATE"),
    ("live event will begin", "LIVE_OR_UPCOMING"),
    ("premieres in", "LIVE_OR_UPCOMING"),
    # Verbatim from yt-dlp: extractor/common.py raise_geo_restricted default,
    # and the YouTube-specific subreason in extractor/youtube/_video.py.
    ("not available from your location", "GEO_BLOCKED"),
    ("available in your country", "GEO_BLOCKED"),
    ("video unavailable", "VIDEO_NOT_FOUND"),
    ("does not exist", "VIDEO_NOT_FOUND"),
    ("has been removed", "VIDEO_NOT_FOUND"),
    ("account associated with this video has been terminated", "VIDEO_NOT_FOUND"),
)


def classify_download_error(exc: BaseException) -> ExtractorError:
    """Map a yt-dlp exception onto the taxonomy.

    yt-dlp reports nearly everything as a DownloadError carrying a humanised
    message, so string matching is the only signal available on the failure
    path. On the success path we use the info dict's structured fields
    (availability / live_status / age_limit) instead -- see youtube.gate().
    """
    try:  # GeoRestrictedError is a precise signal; prefer it over the text.
        from yt_dlp.utils import GeoRestrictedError

        if isinstance(exc, GeoRestrictedError):
            return ExtractorError("GEO_BLOCKED", str(exc))
    except ImportError:  # pragma: no cover - yt_dlp always provides this
        pass

    haystack = str(exc).lower()
    for needle, code in _MESSAGE_PATTERNS:
        if needle in haystack:
            return ExtractorError(code, str(exc))
    return ExtractorError("UPSTREAM_ERROR", str(exc))
