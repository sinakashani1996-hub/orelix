import assert from "node:assert/strict";
import test from "node:test";
import { imapSearchCommand } from "../lib/imap-cursor";

test("uses an IMAP UID cursor to fetch only newer mail", () => {
  assert.equal(imapSearchCommand("42"), "UID SEARCH UID 43:*");
});

test("falls back to a bounded initial mailbox scan without a cursor", () => {
  assert.equal(imapSearchCommand(null), "UID SEARCH ALL");
  assert.equal(imapSearchCommand("not-a-uid"), "UID SEARCH ALL");
});
