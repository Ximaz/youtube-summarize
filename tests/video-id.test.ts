import { test } from "node:test";
import assert from "node:assert/strict";
import { InvalidVideoUrlError, parseVideoId } from "../src/video-id.ts";

const ID = "dQw4w9WgXcQ";

const ACCEPTED: [string, string][] = [
  ["bare id", ID],
  ["watch url", `https://www.youtube.com/watch?v=${ID}`],
  ["watch url without www", `https://youtube.com/watch?v=${ID}`],
  ["http", `http://www.youtube.com/watch?v=${ID}`],
  ["no scheme", `youtube.com/watch?v=${ID}`],
  ["short link", `https://youtu.be/${ID}`],
  ["short link with time", `https://youtu.be/${ID}?t=42`],
  ["shorts", `https://www.youtube.com/shorts/${ID}`],
  ["embed", `https://www.youtube.com/embed/${ID}`],
  ["live", `https://www.youtube.com/live/${ID}`],
  ["/v/ form", `https://www.youtube.com/v/${ID}`],
  ["mobile", `https://m.youtube.com/watch?v=${ID}`],
  ["music", `https://music.youtube.com/watch?v=${ID}`],
  ["nocookie", `https://www.youtube-nocookie.com/embed/${ID}`],
  ["inside a playlist", `https://www.youtube.com/watch?v=${ID}&list=PLabc&index=2`],
  ["with timestamp", `https://www.youtube.com/watch?v=${ID}&t=754s`],
  ["surrounding whitespace", `  https://youtu.be/${ID}  `],
];

for (const [label, input] of ACCEPTED) {
  test(`accepts ${label}`, () => {
    assert.equal(parseVideoId(input), ID);
  });
}

const REJECTED: [string, string][] = [
  ["empty string", ""],
  ["a bare word", "hello"],
  ["a non-YouTube host", "https://vimeo.com/watch?v=dQw4w9WgXcQ"],
  ["a lookalike host", "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ"],
  ["a channel page", "https://www.youtube.com/@someone"],
  ["a playlist without a video", "https://www.youtube.com/playlist?list=PLabc"],
  ["an id that is too short", "https://youtu.be/abc"],
  ["an id that is too long", `https://youtu.be/${ID}xyz`],
  ["an id with invalid characters", "https://www.youtube.com/watch?v=abcdefghij!"],
  ["a file scheme", "file:///etc/passwd"],
];

for (const [label, input] of REJECTED) {
  test(`rejects ${label}`, () => {
    assert.throws(() => parseVideoId(input), InvalidVideoUrlError);
  });
}

test("does not treat a hostname as a video id", () => {
  // 11 chars, but it is a host -- must not be mistaken for an ID.
  assert.throws(() => parseVideoId("https://evil.example/watch"), InvalidVideoUrlError);
});
