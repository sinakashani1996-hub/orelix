import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("build contains the finished Orelix Office product surface", async () => {
  const [page, dashboard, layout, packageJson, workItemsRoute] =
    await Promise.all([
      readFile(new URL("app/page.tsx", root), "utf8"),
      readFile(new URL("app/Dashboard.tsx", root), "utf8"),
      readFile(new URL("app/layout.tsx", root), "utf8"),
      readFile(new URL("package.json", root), "utf8"),
      readFile(new URL("app/api/work-items/route.ts", root), "utf8"),
    ]);

  await access(new URL("dist/server/index.js", root));
  await access(new URL("public/og.png", root));

  assert.match(page, /<Dashboard/);
  assert.match(dashboard, /Goedemorgen/);
  assert.match(dashboard, /Werk voor jou klaar/);
  assert.match(dashboard, /Offerte Assistent/);
  assert.match(dashboard, /Gmail verbonden/);
  assert.match(dashboard, /ORIGINELE E-MAIL/);
  assert.match(dashboard, /VOORGESTELD ANTWOORD/);
  assert.match(dashboard, /<textarea/);
  assert.match(dashboard, /Wijzigingen opslaan/);
  assert.match(dashboard, /Toewijzen aan/);
  assert.match(dashboard, /Workspace niet geladen/);
  assert.match(dashboard, /Nog niet gemeten/);
  assert.match(dashboard, /Openstaand/);
  assert.match(dashboard, /Verzonden/);
  assert.match(dashboard, /Archief/);
  assert.match(dashboard, /Definitief verwijderen/);
  assert.match(dashboard, /filter === "all_records"/);
  assert.match(dashboard, /OFFERTEBOUWER/);
  assert.match(dashboard, /Offerte opslaan/);
  assert.match(dashboard, /PDF bekijken/);
  assert.match(dashboard, /Maak de offerte eerst compleet/);
  assert.match(workItemsRoute, /export async function DELETE/);
  assert.match(workItemsRoute, /Alleen gearchiveerde dossiers/);
  assert.doesNotMatch(
    dashboard,
    /Jan Peeters|Elise Vermeulen|Tom De Smet|38 taken|1u 47m|96%/,
  );
  assert.match(layout, /Orelix Office/);
  assert.match(layout, /openGraph/);
  assert.doesNotMatch(page, /codex-preview|SkeletonPreview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(packageJson, /pdf-lib/);
});
