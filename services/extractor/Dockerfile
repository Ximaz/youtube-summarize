# Digest-pinned; the tag alone is mutable. Refresh with:
#   docker buildx imagetools inspect python:3.13-slim
FROM python:3.13-slim@sha256:ffb752e139c0a19692a43af8d8523b274222dd68eebad5d583b45c2201c6e30a

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # The container runs read-only; give yt-dlp and deno a writable cache on
    # the tmpfs that compose mounts.
    XDG_CACHE_HOME=/tmp/cache

WORKDIR /app

# Dependencies first so application edits do not invalidate this layer.
# --require-hashes rejects anything not matching requirements.lock; --no-deps
# keeps pip from re-resolving what uv already pinned.
COPY requirements.lock ./
RUN pip install --require-hashes --no-deps -r requirements.lock

RUN useradd --create-home --uid 10001 extractor

COPY extractor ./extractor

# Fail the build, not a real video at 2am. Verifies that an impersonation
# backend (curl-cffi) and a JS runtime (deno) are both present -- without
# either, caption fetches fail in ways that look like "no captions".
RUN python -m extractor --check-extractor --assert-ready

USER extractor
ENTRYPOINT ["python", "-m", "extractor"]
