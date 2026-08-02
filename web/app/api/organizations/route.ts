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

function slugKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
}
