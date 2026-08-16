"""Entry point. One JSON document on stdout; errors on stderr; exit code is the
error channel.
"""

from __future__ import annotations

import argparse
import json
import re
import sys

from .errors import EXIT_USAGE, ExtractorError

# The service accepts a video ID, never a URL. Nothing reaches a shell and
# there is no request-forgery surface: parsing URLs is the caller's job.
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")

# A stale pin and a genuinely caption-less video are indistinguishable from the
# outside, so the errors where that ambiguity bites carry the version.
_PIN_SENSITIVE = ("NO_CAPTIONS", "WRONG_LANGUAGE", "UPSTREAM_ERROR", "RATE_LIMITED")


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="extractor",
        description="Extract YouTube metadata and a timestamped transcript.",
    )
    parser.add_argument("video_id", nargs="?", help="11-character YouTube video ID")
    parser.add_argument(
        "--lang",
        default="en",
        help="Comma-separated language preference, or 'any' (default: en)",
    )
    parser.add_argument(
        "--check-extractor",
        action="store_true",
        help="Report the pinned yt-dlp version and its capabilities, then exit",
    )
    parser.add_argument(
        "--assert-ready",
        action="store_true",
        help="With --check-extractor, exit non-zero unless captions can work",
    )
    return parser.parse_args(argv)


def _languages(raw: str) -> list[str] | None:
    if raw.strip().lower() == "any":
        return None
    langs = [part.strip().lower() for part in raw.split(",") if part.strip()]
    if not langs:
        raise ExtractorError("BAD_REQUEST", "--lang must name at least one language.")
    return langs


def _fail(error: ExtractorError) -> int:
    payload = error.to_dict()
    if error.code in _PIN_SENSITIVE:
        try:
            import yt_dlp

            payload["error"]["hint"] = (
                f"extractor pinned to yt-dlp {yt_dlp.version.__version__}; if this "
                f"video shows captions in a browser the pin is likely stale -- see "
                f"README 'Updating the extractor'."
            )
        except ImportError:  # pragma: no cover
            pass
    # One compact line: yt-dlp writes its own diagnostics to stderr too, so the
    # caller finds this by scanning upward for the last line that parses as
    # JSON carrying an "error" key.
    sys.stderr.write(json.dumps(payload) + "\n")
    return error.exit_code


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(sys.argv[1:] if argv is None else argv)

    try:
        if args.check_extractor:
            from .youtube import assert_ready, probe

            report = probe()
            if args.assert_ready:
                assert_ready(report)
            json.dump(report, sys.stdout, indent=2)
            sys.stdout.write("\n")
            return 0

        if not args.video_id:
            raise ExtractorError("BAD_REQUEST", "A video ID is required.")
        if not VIDEO_ID.match(args.video_id):
            raise ExtractorError(
                "BAD_REQUEST",
                "Expected an 11-character YouTube video ID, not a URL.",
            )

        from .youtube import extract

        payload = extract(args.video_id, _languages(args.lang))
        json.dump(payload, sys.stdout, ensure_ascii=False)
        sys.stdout.write("\n")
        return 0

    except ExtractorError as error:
        return _fail(error)
    except KeyboardInterrupt:  # pragma: no cover
        return EXIT_USAGE
    except Exception as exc:  # noqa: BLE001 - last resort, keep stdout clean
        return _fail(ExtractorError("UPSTREAM_ERROR", f"{type(exc).__name__}: {exc}"))


if __name__ == "__main__":
    raise SystemExit(main())
