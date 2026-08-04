import { and, eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "../db";
import { members, organizations, organizationModules } from "../db/schema";
import { getCurrentUser, type OrelixUser } from "./auth";

export type AppContext = {
  user: OrelixUser;
  organization: {
    id: string;
    name: string;
    slug: string;
    companyAddress: string;
    companyVatNumber: string;
    companyEmail: string;
  } | null;
  role: string | null;
};

const moduleDefaults = [
  ["quote_assistant", "active"],
  ["inbox_assistant", "beta"],
  ["service_assistant", "beta"],
  ["planning_assistant", "coming_soon"],
  ["crm_assistant", "coming_soon"],
] as const;

export async function getAppContext(): Promise<AppContext | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  await ensureDatabase();

  if (user.provider !== "workos") {
    await ensureDemoWorkspace(user);
  } else if (user.providerOrganizationId) {
    // WorkOS has already verified this user's organization membership in the
    // session. Mirror it locally on first sign-in so invited teammates gain
    // access without an administrator having to edit D1 by hand.
    await ensureWorkOSWorkspaceMembership(user);
  }

  const db = getDb();
  const membership = await db
    .select({
      role: members.role,
      organizationId: organizations.id,
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
      companyAddress: organizations.companyAddress,
      companyVatNumber: organizations.companyVatNumber,
      companyEmail: organizations.companyEmail,
    })
    .from(members)
    .innerJoin(organizations, eq(members.organizationId, organizations.id))
    .where(eq(members.authUserId, user.id))
    .limit(1);

  if (!membership[0]) {
    return { user, organization: null, role: null };
  }

  return {
    user,
    organization: {
      id: membership[0].organizationId,
      name: membership[0].organizationName,
      slug: membership[0].organizationSlug,
      companyAddress: membership[0].companyAddress,
      companyVatNumber: membership[0].companyVatNumber,
      companyEmail: membership[0].companyEmail,
    },
    role: membership[0].role,
  };
}

async function ensureWorkOSWorkspaceMembership(user: OrelixUser) {
  if (!user.providerOrganizationId) return;
  const db = getDb();
  const organization = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.authProviderOrganizationId, user.providerOrganizationId))
    .limit(1);
  if (!organization[0]) return;

  await db
    .insert(members)
    .values({
      id: `member_${crypto.randomUUID()}`,
      organizationId: organization[0].id,
      authUserId: user.id,
      email: user.email,
      name: user.name,
      role: user.role === "admin" ? "admin" : "member",
    })
    .onConflictDoUpdate({
      target: [members.organizationId, members.authUserId],
      set: {
        email: user.email,
        name: user.name,
        role: user.role === "admin" ? "admin" : "member",
      },
    });
}

export async function createWorkspaceForUser(
  user: OrelixUser,
  name: string,
  authProviderOrganizationId?: string,
) {
  await ensureDatabase();
  const db = getDb();
  const suffix = crypto.randomUUID().slice(0, 8);
  const slug = `${slugify(name) || "workspace"}-${suffix}`;
  const organizationId = authProviderOrganizationId || `org_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  await db.insert(organizations).values({
    id: organizationId,
    name,
    slug,
    authProviderOrganizationId,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(members).values({
    id: `member_${crypto.randomUUID()}`,
    organizationId,
    authUserId: user.id,
    email: user.email,
    name: user.name,
    role: "admin",
  });
  await db.insert(organizationModules).values(
    moduleDefaults.map(([moduleId, status]) => ({
      id: `orgmod_${crypto.randomUUID()}`,
      organizationId,
      moduleId,
      status,
    })),
  );

  return { id: organizationId, name, slug };
}

async function ensureDemoWorkspace(user: OrelixUser) {
  const db = getDb();
  const existing = await db
    .select({ id: members.id })
    .from(members)
    .where(
      and(eq(members.organizationId, "org_demo"), eq(members.authUserId, user.id)),
    )
    .limit(1);
  if (existing.length) return;

  await db
    .insert(organizations)
    .values({
      id: "org_demo",
      name: "First Client BV",
      slug: "first-client-demo",
    })
    .onConflictDoNothing();
  await db.insert(members).values({
    id: `member_${crypto.randomUUID()}`,
    organizationId: "org_demo",
    authUserId: user.id,
    email: user.email,
    name: user.name,
    role: "admin",
  });

  for (const [moduleId, status] of moduleDefaults) {
    await db
      .insert(organizationModules)
      .values({
        id: `orgmod_${crypto.randomUUID()}`,
        organizationId: "org_demo",
        moduleId,
        status,
      })
      .onConflictDoNothing();
  }
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}
