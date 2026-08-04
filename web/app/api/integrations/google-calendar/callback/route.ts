import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { integrations, oauthStates } from "../../../../../db/schema";
import { getAppContext } from "../../../../../lib/context";
import {
  encryptCalendarRefreshToken,
  exchangeGoogleCalendarCode,
  googleCalendarProfile,
} from "../../../../../lib/google-calendar";
import { appUrl } from "../../../../../lib/app-url";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const context = await getAppContext();
  if (!code || !state || !context?.organization) {
    return Response.redirect(new URL("/planning?calendar=invalid-callback", request.url));
  }

  const db = getDb();
  const stateRow = (
    await db
      .select()
      .from(oauthStates)
      .where(
        and(
          eq(oauthStates.state, state),
          eq(oauthStates.organizationId, context.organization.id),
          eq(oauthStates.authUserId, context.user.id),
          eq(oauthStates.provider, "google_calendar"),
        ),
      )
      .limit(1)
  )[0];
  if (!stateRow || new Date(stateRow.expiresAt).getTime() < Date.now()) {
    return Response.redirect(new URL("/planning?calendar=expired-state", request.url));
  }

  try {
    const redirectUri = appUrl(
      request,
      "/api/integrations/google-calendar/callback",
      process.env.GOOGLE_CALENDAR_REDIRECT_URI,
    );
    const token = await exchangeGoogleCalendarCode(code, redirectUri);
    const profile = await googleCalendarProfile(token.access_token);
    if (!profile.email) throw new Error("Google gaf geen e-mailadres terug");

    const existing = await getDb()
      .select()
      .from(integrations)
      .where(
        and(
          eq(integrations.organizationId, context.organization.id),
          eq(integrations.provider, "google_calendar"),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]);
    const encryptedRefreshToken = token.refresh_token
      ? await encryptCalendarRefreshToken(token.refresh_token)
      : existing?.encryptedRefreshToken;
    if (!encryptedRefreshToken) {
      throw new Error("Google gaf geen blijvende toegang terug");
    }
    const now = new Date().toISOString();
    await db
      .insert(integrations)
      .values({
        id: existing?.id || `integration_${crypto.randomUUID()}`,
        organizationId: context.organization.id,
        provider: "google_calendar",
        accountEmail: profile.email.toLowerCase(),
        status: "connected",
        encryptedRefreshToken,
        encryptedCredentials: "",
        scopes: token.scope,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [integrations.organizationId, integrations.provider],
        set: {
          accountEmail: profile.email.toLowerCase(),
          status: "connected",
          encryptedRefreshToken,
          scopes: token.scope,
          updatedAt: now,
        },
      });
    await db.delete(oauthStates).where(eq(oauthStates.state, state));
    return Response.redirect(new URL("/planning?calendar=connected", request.url));
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Unknown calendar callback error";
    console.error("Google Calendar OAuth callback failed:", message);
    const reason = message.includes("UNIQUE constraint failed")
      ? "account-in-use"
      : message.includes("token exchange")
        ? "token-exchange"
        : message.includes("blijvende toegang")
          ? "no-refresh-token"
          : "failed";
    return Response.redirect(new URL(`/planning?calendar=${reason}`, request.url));
  }
}
