import assert from "node:assert/strict";
import test from "node:test";
import { filterInboundMailboxMessage } from "../lib/inbox-filter";

test("ignores automatic absence replies", () => {
  const result = filterInboundMailboxMessage({
    from: "Team Advenso <info@advenso.be>",
    subject: "Automatisch antwoord: zomerverlof",
    body: "Bedankt voor uw e-mail. Wij zijn met verlof.",
  });
  assert.deepEqual(result, { action: "ignore", reason: "automatisch antwoord of afwezigheidsmelding" });
});

test("ignores newsletters and delivery failures", () => {
  assert.equal(
    filterInboundMailboxMessage({
      from: "Nieuws <nieuws@example.com>",
      subject: "Onze zomerupdate",
      body: "Schrijf u uit via deze link.",
      listUnsubscribe: "<https://example.com/unsubscribe>",
    }).action,
    "ignore",
  );
  assert.equal(
    filterInboundMailboxMessage({
      from: "MAILER-DAEMON <mailer-daemon@example.com>",
      subject: "Delivery Status Notification (Failure)",
      body: "",
    }).action,
    "ignore",
  );
});

test("keeps a genuine customer question", () => {
  const result = filterInboundMailboxMessage({
    from: "Lance Stroll <lance@example.com>",
    subject: "Offerte zonnepanelen",
    body: "Graag ontvang ik een offerte voor zonnepanelen op mijn woning.",
  });
  assert.deepEqual(result, { action: "keep" });
});
