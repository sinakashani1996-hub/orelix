import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { integrations } from "../../../../../db/schema";
import { getAppContext } from "../../../../../lib/context";

/** Permanently removes the encrypted IMAP/SMTP credential for this workspace. */
export async function POST() {
  const context = await getAppContext();
  if (!context?.organization) {
    return Response.json({ error: "Niet aangemeld" }, { status: 401 });
  }
  await getDb()
    .delete(integrations)
    .where(
      and(
        eq(integrations.organizationId, context.organization.id),
        eq(integrations.provider, "imap_smtp"),
      ),
    );
  return Response.json({ ok: true });
}
