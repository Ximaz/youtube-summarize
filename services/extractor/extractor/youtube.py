"""Metadata + caption extraction, in a single yt-dlp pass.

`extract_info(download=False)` yields the metadata, the description, the
chapters and the caption-track map at once. The chosen track is then fetched in
the same process, because the timedtext URLs are signed and IP-bound -- they
cannot be stored, cached, or handed to another process.
"""

from __future__ import annotations

import json
import sys
from typing import Any, NamedTuple

from .errors import ExtractorError, classify_download_error
from .json3 import Segment, parse as parse_json3

# yt-dlp writes progress and warnings to stdout by default. stdout is our JSON
# contract, so every yt-dlp message is routed to stderr instead.
class _StderrLogger:
    # We never download media, so yt-dlp's ffmpeg advisory is always spurious
    # here and would otherwise be the loudest line in a failure report.
    _SUPPRESS = ("ffmpeg not found",)

    def debug(self, message: str) -> None:
        pass

    def info(self, message: str) -> None:
        self._emit(message)

    def warning(self, message: str) -> None:
        self._emit(message)

    def error(self, message: str) -> None:
        self._emit(message)

    def _emit(self, message: str) -> None:
        if any(noise in message for noise in self._SUPPRESS):
            return
        print(message, file=sys.stderr)


_YDL_OPTS: dict[str, Any] = {
    "skip_download": True,
    "noplaylist": True,
    "quiet": True,
    "no_color": True,
    "socket_timeout": 30,
    "retries": 2,
    "logger": _StderrLogger(),
    # Deliberately NOT setting extractor_args.player_client. yt-dlp accumulates
    # caption languages across every client it tries; pinning one client gives
    # a single shot and turns a transient failure into a false "no captions".
}


class Track(NamedTuple):
    source: str  # "manual" | "automatic"
    lang: str
    entry: dict[str, Any]


def build_ydl():
    from yt_dlp import YoutubeDL

    return YoutubeDL(_YDL_OPTS)


# --------------------------------------------------------------------------
# diagnostics


def probe() -> dict[str, Any]:
    """Report the pinned version and the two capabilities captions depend on.

    Both helpers are yt-dlp private API. That is a deliberate trade: they are
    the only way to check impersonation and JS-runtime availability without a
    network round-trip, and this runs as a build-time assertion where a clear
    failure is the desired outcome.
    """
    import yt_dlp

    with build_ydl() as ydl:
        getter = getattr(ydl, "_get_available_impersonate_targets", None)
        if getter is None:
            raise RuntimeError(
                "yt-dlp probe API changed: _get_available_impersonate_targets is gone"
            )
        targets = [str(t[0]) if isinstance(t, tuple) else str(t) for t in getter()]

        registry = getattr(ydl, "_js_runtimes", None)
        if registry is None:
            raise RuntimeError("yt-dlp probe API changed: _js_runtimes is gone")
        runtimes = []
        for runtime in registry.values():
            info = getattr(runtime, "info", None)
            if info and getattr(info, "supported", False):
                runtimes.append({"name": info.name, "version": info.version})

    return {
        "ytdlpVersion": yt_dlp.version.__version__,
        "impersonateTargets": targets,
        "jsRuntimes": runtimes,
    }


def assert_ready(report: dict[str, Any]) -> None:
    """Fail the image build rather than a 2am video."""
    if not report["impersonateTargets"]:
        raise RuntimeError(
            "no impersonation backend available -- caption fetches will fail. "
            "Install the curl-cffi extra (yt-dlp[curl-cffi])."
        )
    if not report["jsRuntimes"]:
        raise RuntimeError(
            "no supported JavaScript runtime available -- yt-dlp silently "
            "degrades to its JS-less client set. Install the deno extra "
            "(yt-dlp[deno])."
        )


# --------------------------------------------------------------------------
# gating


def gate(info: dict[str, Any]) -> None:
    """Reject videos that cannot yield a usable transcript, with a real reason.

    Runs on the success path, where yt-dlp gives structured fields -- far more
    reliable than matching its error prose.
    """
    live_status = info.get("live_status")
    if live_status in ("is_live", "is_upcoming"):
        raise ExtractorError(
            "LIVE_OR_UPCOMING",
            "This is a live or upcoming stream; captions are absent or partial "
            "until it has finished processing.",
        )

    availability = info.get("availability")
    if availability == "subscriber_only":
        raise ExtractorError("MEMBERS_ONLY", "This video is members-only.")
    if availability == "premium_only":
        raise ExtractorError("PREMIUM_ONLY", "This video requires YouTube Premium.")
    if availability in ("private", "needs_auth"):
        raise ExtractorError("PRIVATE", "This video is private.")

    if (info.get("age_limit") or 0) >= 18:
        raise ExtractorError(
            "AGE_RESTRICTED",
            "This video is age-restricted, so captions cannot be fetched "
            "anonymously. This is an authentication limit, not a missing "
            "transcript.",
        )


# --------------------------------------------------------------------------
# caption-track selection


def _base(lang: str | None) -> str | None:
    if not lang:
        return None
    return lang.lower().split("-")[0] or None


def _usable(tracks: dict[str, Any] | None) -> dict[str, Any]:
    # `live_chat` is a pseudo-track yt-dlp exposes alongside real subtitles.
    return {k: v for k, v in (tracks or {}).items() if k != "live_chat" and v}


def _json3_entry(entries: Any) -> dict[str, Any] | None:
    # subtitles[lang] is a LIST of format dicts -- json3, srv1..3, ttml, vtt.
    if not isinstance(entries, list):
        return None
    return next((e for e in entries if isinstance(e, dict) and e.get("ext") == "json3"), None)


def _matches(available: dict[str, Any], want: str) -> list[str]:
    """Keys for `want`, most specific first: exact, then -orig, then variants."""
    exact = [k for k in available if k.lower() == want]
    orig = [k for k in available if k.lower() == f"{want}-orig"]
    variants = sorted(
        k for k in available if k.lower().startswith(f"{want}-") and k.lower() != f"{want}-orig"
    )
    return exact + orig + variants


def _is_original(key: str, want: str, video_lang: str | None) -> bool:
    """Guard against YouTube's auto-translated caption tracks.

    `automatic_captions` carries the ASR track for the spoken language plus
    machine translations into ~100 others. A machine translation of a machine
    transcription is not a transcript worth summarising, so it is refused --
    consistent with this tool's fail-loudly stance.
    """
    if key.lower().endswith("-orig"):
        return True
    if video_lang is None:
        return True  # nothing to contradict it
    return video_lang == want


def _describe_available(manual: dict[str, Any], automatic: dict[str, Any]) -> list[str]:
    """Languages worth reporting -- not the ~100 auto-translated ones."""
    langs = sorted(manual)
    langs += sorted(k for k in automatic if k.lower().endswith("-orig"))
    return sorted(set(langs))


def select_track(info: dict[str, Any], requested: list[str] | None) -> Track:
    """Pick a caption track. `requested is None` means "any usable track"."""
    manual = _usable(info.get("subtitles"))
    automatic = _usable(info.get("automatic_captions"))
    video_lang = _base(info.get("language"))

    if not manual and not automatic:
        raise ExtractorError(
            "NO_CAPTIONS",
            "This video has no caption track of any kind. This tool "
            "deliberately has no speech-recognition fallback.",
        )

    if requested is None:
        wants: list[str] = []
        for candidate in [video_lang, *(_base(k) for k in manual), *(
            _base(k) for k in automatic if k.lower().endswith("-orig")
        )]:
            if candidate and candidate not in wants:
                wants.append(candidate)
    else:
        wants = requested

    for want in wants:
        for key in _matches(manual, want):
            entry = _json3_entry(manual[key])
            if entry:
                return Track("manual", key, entry)
        for key in _matches(automatic, want):
            if not _is_original(key, want, video_lang):
                continue
            entry = _json3_entry(automatic[key])
            if entry:
                return Track("automatic", key, entry)

    available = _describe_available(manual, automatic)
    raise ExtractorError(
        "WRONG_LANGUAGE",
        f"No caption track for {', '.join(wants)}. Machine-translated tracks "
        f"are refused. Re-run with --lang any to accept what exists.",
        availableLangs=available,
    )


# --------------------------------------------------------------------------
# caption fetch


def _impersonate_extension(ydl, entry: dict[str, Any]) -> dict[str, Any]:
    """Resolve yt-dlp's `impersonate: True` marker into a concrete target.

    The request extension takes an ImpersonateTarget, not a bool -- passing the
    raw `True` trips an assertion deep inside the curl-cffi handler. yt-dlp's
    own downloader resolves it via _parse_impersonate_targets, so we do too.
    """
    requested = entry.get("impersonate")
    if not requested:
        return {}

    parse = getattr(ydl, "_parse_impersonate_targets", None)
    if parse is None:
        raise RuntimeError(
            "yt-dlp API changed: _parse_impersonate_targets is gone; caption "
            "impersonation cannot be resolved"
        )

    available, _requested_targets = parse(requested)
    if available is None:
        # The image build asserts a backend exists, so this means the entry
        # asked for a target this build cannot provide. Bare is better than
        # failing outright -- YouTube may still serve it.
        return {}
    return {"impersonate": available}


def fetch_track(ydl, track: Track, info: dict[str, Any]) -> list[Segment]:
    """Fetch a caption track the way yt-dlp itself would.

    `ydl.urlopen(url_string)` is NOT equivalent: it wraps a bare string with no
    headers and no impersonation extension, and the timedtext endpoint
    TLS-fingerprints.
    """
    from yt_dlp.networking import Request
    from yt_dlp.networking.exceptions import HTTPError, TransportError

    request = Request(
        track.entry["url"],
        headers=info.get("http_headers") or {},
        extensions=_impersonate_extension(ydl, track.entry),
    )

    try:
        raw = ydl.urlopen(request).read()
    except HTTPError as exc:
        status = getattr(exc, "status", None)
        if status == 429:
            raise ExtractorError(
                "RATE_LIMITED", "YouTube rate-limited the caption request."
            ) from exc
        raise ExtractorError(
            "UPSTREAM_ERROR", f"Caption fetch failed with HTTP {status}."
        ) from exc
    except TransportError as exc:
        raise ExtractorError("UPSTREAM_ERROR", f"Caption fetch failed: {exc}") from exc

    try:
        payload = json.loads(raw)
    except ValueError as exc:
        raise ExtractorError(
            "UPSTREAM_ERROR", "Caption track was not valid json3."
        ) from exc

    segments = parse_json3(payload)
    if not segments:
        raise ExtractorError(
            "NO_CAPTIONS",
            f"The {track.lang} caption track exists but contains no text.",
        )
    return segments


# --------------------------------------------------------------------------
# orchestration


def _upload_date(raw: str | None) -> str | None:
    if not raw or len(raw) != 8 or not raw.isdigit():
        return None
    return f"{raw[0:4]}-{raw[4:6]}-{raw[6:8]}"


def _chapters(raw: Any) -> list[dict[str, Any]] | None:
    if not raw:
        return None
    out = []
    for chapter in raw:
        if not isinstance(chapter, dict):
            continue
        out.append(
            {
                "title": chapter.get("title") or "",
                "startTime": float(chapter.get("start_time") or 0.0),
                "endTime": float(chapter["end_time"]) if chapter.get("end_time") else None,
            }
        )
    return out or None


def extract(video_id: str, requested: list[str] | None) -> dict[str, Any]:
    from yt_dlp.utils import DownloadError

    url = f"https://www.youtube.com/watch?v={video_id}"
    with build_ydl() as ydl:
        try:
            info = ydl.extract_info(url, download=False)
        except DownloadError as exc:
            raise classify_download_error(exc) from exc
        except Exception as exc:  # noqa: BLE001 - yt-dlp raises a wide range
            raise classify_download_error(exc) from exc

        if not info:
            raise ExtractorError("VIDEO_NOT_FOUND", "yt-dlp returned no video info.")

        gate(info)
        track = select_track(info, requested)
        segments = fetch_track(ydl, track, info)

    return {
        "id": info.get("id") or video_id,
        "title": info.get("title") or "",
        "channel": info.get("channel") or info.get("uploader") or "",
        "channelId": info.get("channel_id") or "",
        "uploadDate": _upload_date(info.get("upload_date")),
        "durationSeconds": info.get("duration"),
        "description": info.get("description") or "",
        "chapters": _chapters(info.get("chapters")),
        "liveStatus": info.get("live_status"),
        "availability": info.get("availability"),
        "ageLimit": info.get("age_limit") or 0,
        "transcript": {
            "source": track.source,
            "lang": track.lang,
            "segments": [{"start": s.start, "text": s.text} for s in segments],
        },
    }
