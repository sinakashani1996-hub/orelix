import { and, eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "../db";
import { members, organizations, organizationModules } from "../db/schema";
import { getCurrentUser, type OrelixUser } from "./auth";

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  companyAddress: string;
  companyVatNumber: string;
  companyEmail: string;
  quoteNumberMode: "automatic" | "manual";
  quoteNumberPrefix: string;
  quoteNumberNext: number;
  quoteNumberStart: number;
  quoteNumberResetYearly: boolean;
  quoteNumberYear: number | null;
  role: string;
  providerOrganizationId: string | null;
};

export type AppContext = {
  user: OrelixUser;
  organization: Omit<WorkspaceSummary, "role" | "providerOrganizationId"> | null;
  /** All local workspaces this person can access. Kept for visibility and safe recovery. */
  workspaces: WorkspaceSummary[];
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
  const membershipRows = await db
    .select({
      role: members.role,
      organizationId: organizations.id,
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
      companyAddress: organizations.companyAddress,
      companyVatNumber: organizations.companyVatNumber,
      companyEmail: organizations.companyEmail,
      quoteNumberMode: organizations.quoteNumberMode,
      quoteNumberPrefix: organizations.quoteNumberPrefix,
      quoteNumberNext: organizations.quoteNumberNext,
      quoteNumberStart: organizations.quoteNumberStart,
      quoteNumberResetYearly: organizations.quoteNumberResetYearly,
      quoteNumberYear: organizations.quoteNumberYear,
      providerOrganizationId: organizations.authProviderOrganizationId,
    })
    .from(members)
    .innerJoin(organizations, eq(members.organizationId, organizations.id))
    .where(eq(members.authUserId, user.id))
    .limit(50);

  const workspaces = membershipRows.map(toWorkspaceSummary);
  // A WorkOS session is authoritative for the active organization. If that
  // organization was deleted in WorkOS, do not silently fall back to an old
  // local D1 workspace and show the user the wrong company's data.
  const activeWorkspace = user.providerOrganizationId
    ? workspaces.find(
        (workspace) => workspace.providerOrganizationId === user.providerOrganizationId,
      )
    : workspaces[0];

  if (!activeWorkspace) {
    return { user, organization: null, workspaces: [], role: null };
  }

  return {
    user,
    organization: {
      id: activeWorkspace.id,
      name: activeWorkspace.name,
      slug: activeWorkspace.slug,
      companyAddress: activeWorkspace.companyAddress,
      companyVatNumber: activeWorkspace.companyVatNumber,
      companyEmail: activeWorkspace.companyEmail,
      quoteNumberMode: activeWorkspace.quoteNumberMode,
      quoteNumberPrefix: activeWorkspace.quoteNumberPrefix,
      quoteNumberNext: activeWorkspace.quoteNumberNext,
      quoteNumberStart: activeWorkspace.quoteNumberStart,
      quoteNumberResetYearly: activeWorkspace.quoteNumberResetYearly,
      quoteNumberYear: activeWorkspace.quoteNumberYear,
    },
    workspaces,
    role: activeWorkspace.role,
  };
}

export async function findExistingWorkspaceForUser(userId: string) {
  await ensureDatabase();
  const db = getDb();
  const rows = await db
    .select({
      role: members.role,
      organizationId: organizations.id,
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
      companyAddress: organizations.companyAddress,
      companyVatNumber: organizations.companyVatNumber,
      companyEmail: organizations.companyEmail,
      quoteNumberMode: organizations.quoteNumberMode,
      quoteNumberPrefix: organizations.quoteNumberPrefix,
      quoteNumberNext: organizations.quoteNumberNext,
      quoteNumberStart: organizations.quoteNumberStart,
      quoteNumberResetYearly: organizations.quoteNumberResetYearly,
      quoteNumberYear: organizations.quoteNumberYear,
      providerOrganizationId: organizations.authProviderOrganizationId,
    })
    .from(members)
    .innerJoin(organizations, eq(members.organizationId, organizations.id))
    .where(eq(members.authUserId, userId))
    .limit(1);

  return rows[0] ? toWorkspaceSummary(rows[0]) : null;
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

function toWorkspaceSummary(row: {
  role: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  companyAddress: string;
  companyVatNumber: string;
  companyEmail: string;
  quoteNumberMode: string;
  quoteNumberPrefix: string;
  quoteNumberNext: number;
  quoteNumberStart: number;
  quoteNumberResetYearly: boolean;
  quoteNumberYear: number | null;
  providerOrganizationId: string | null;
}): WorkspaceSummary {
  return {
    id: row.organizationId,
    name: row.organizationName,
    slug: row.organizationSlug,
    companyAddress: row.companyAddress,
    companyVatNumber: row.companyVatNumber,
    companyEmail: row.companyEmail,
    quoteNumberMode: row.quoteNumberMode === "manual" ? "manual" : "automatic",
    quoteNumberPrefix: row.quoteNumberPrefix,
    quoteNumberNext: row.quoteNumberNext,
    quoteNumberStart: row.quoteNumberStart,
    quoteNumberResetYearly: row.quoteNumberResetYearly,
    quoteNumberYear: row.quoteNumberYear,
    role: row.role,
    providerOrganizationId: row.providerOrganizationId,
  };
}
