import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sha256Base64 } from "../src/sha256.js";

test("sha256Base64 matches node:crypto for empty, ASCII, Turkish and multi-block input", () => {
  for (const text of ["", "abc", "ığüşöçİ €", "x".repeat(55), "x".repeat(56), "y".repeat(5000)]) {
    assert.equal(sha256Base64(text), createHash("sha256").update(text).digest("base64"), `length ${text.length}`);
  }
});
