import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { organizations } from "../../../db/schema";
import { getAppContext, createWorkspaceForUser } from "../../../lib/context";
import { getWorkOS } from "../../../lib/auth";

export async function POST(request: Request) {
  const context = await getAppContext();
  if (!context) {
    return Response.json({ error: "Niet aangemeld" }, { status: 401 });
  }
  if (context.organization) {
    return Response.json({ organization: context.organization });
  }

  const body = (await request.json()) as { name?: string };
  const name = body.name?.trim();
  if (!name || name.length < 2 || name.length > 80) {
    return Response.json(
      { error: "Geef een geldige bedrijfsnaam op" },
      { status: 400 },
    );
  }

  let providerOrganizationId: string | undefined;
  const workos = getWorkOS();
  if (context.user.provider === "workos" && workos) {
    const organization = await workos.organizations.createOrganization(
      { name },
      { idempotencyKey: `orelix-${context.user.id}-${slugKey(name)}` },
    );
    await workos.userManagement.createOrganizationMembership({
      organizationId: organization.id,
      userId: context.user.id,
      roleSlug: "admin",
    });
    providerOrganizationId = organization.id;
  }

  const organization = await createWorkspaceForUser(
    context.user,
    name,
    providerOrganizationId,
  );
  return Response.json({ organization }, { status: 201 });
}

export async function PATCH(request: Request) {
  const context = await getAppContext();
  if (!context?.organization) {
    return Response.json({ error: "Niet aangemeld" }, { status: 401 });
  }

  const body = (await request.json()) as {
    name?: string;
    companyAddress?: string;
    companyVatNumber?: string;
    companyEmail?: string;
  };
  const name = body.name?.trim();
  const companyAddress = body.companyAddress?.trim() || "";
  const companyVatNumber = body.companyVatNumber?.trim() || "";
  const companyEmail = body.companyEmail?.trim().toLowerCase() || "";

  if (!name || name.length < 2 || name.length > 80) {
    return Response.json({ error: "Geef een geldige bedrijfsnaam op" }, { status: 400 });
  }
  if (companyAddress.length > 300 || companyVatNumber.length > 60) {
    return Response.json({ error: "Een bedrijfsgegeven is te lang" }, { status: 400 });
  }
  if (companyEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(companyEmail)) {
    return Response.json({ error: "Geef een geldig bedrijfs-e-mailadres op" }, { status: 400 });
  }

  const db = getDb();
  const [organization] = await db
    .update(organizations)
    .set({
      name,
      companyAddress,
      companyVatNumber,
      companyEmail,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(organizations.id, context.organization.id))
    .returning();

  return Response.json({ organization });
}

function slugKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
}
