/**
 * URL -> video ID. Parsing is the CLI's job: the extractor accepts only an
 * 11-character ID, so nothing resembling a URL ever reaches the container.
 */

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const HOSTS = new Set([
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "youtu.be",
]);

const PATH_FORMS = /^\/(?:shorts|embed|live|v)\/([^/?#]+)/;

export class InvalidVideoUrlError extends Error {
  override name = "InvalidVideoUrlError";
}

export function parseVideoId(raw: string): string {
  const input = raw.trim();
  if (VIDEO_ID.test(input)) return input;

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    throw new InvalidVideoUrlError(`Not a YouTube URL or video ID: ${raw}`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new InvalidVideoUrlError(`Unsupported URL scheme: ${url.protocol}`);
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!HOSTS.has(host)) {
    throw new InvalidVideoUrlError(`Not a YouTube URL: ${url.hostname}`);
  }

  const candidate =
    host === "youtu.be"
      ? url.pathname.slice(1).split("/")[0]
      : (url.searchParams.get("v") ?? url.pathname.match(PATH_FORMS)?.[1]);

  if (!candidate) {
    throw new InvalidVideoUrlError(`No video ID in URL: ${raw}`);
  }
  if (!VIDEO_ID.test(candidate)) {
    throw new InvalidVideoUrlError(
      `"${candidate}" is not an 11-character YouTube video ID.`,
    );
  }
  return candidate;
}
