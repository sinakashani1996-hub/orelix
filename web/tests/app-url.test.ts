import assert from "node:assert/strict";
import test from "node:test";
import { appUrl, normaliseBaseUrl } from "../lib/app-url";

test("uses the configured production base for OAuth callbacks", () => {
  const request = new Request("http://localhost:3000/login");
  assert.equal(
    appUrl(request, "/auth/callback", "https://app.orelix.be"),
    "https://app.orelix.be/auth/callback",
  );
});

test("keeps local callbacks local when no public base is configured", () => {
  const request = new Request("http://localhost:3000/login");
  assert.equal(
    appUrl(request, "/api/integrations/gmail/callback"),
    "http://localhost:3000/api/integrations/gmail/callback",
  );
});

test("rejects non-http configured application URLs", () => {
  assert.equal(normaliseBaseUrl("javascript:alert(1)"), null);
});
