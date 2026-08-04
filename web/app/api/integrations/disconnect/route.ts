import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { integrations } from "../../../../db/schema";
import { getAppContext } from "../../../../lib/context";

/** Removes the active mailbox connection and its encrypted access credentials. */
export async function POST() {
  const context = await getAppContext();
  if (!context?.organization) {
    return Response.json({ error: "Niet aangemeld" }, { status: 401 });
  }

  await getDb()
    .delete(integrations)
    .where(eq(integrations.organizationId, context.organization.id));

  return Response.json({ ok: true });
}
