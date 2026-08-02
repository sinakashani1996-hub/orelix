import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { integrations, oauthStates } from "../../../../../db/schema";
import { getAppContext } from "../../../../../lib/context";
import {
  encryptRefreshToken,
  exchangeGoogleCode,
  getGmailProfile,
  normalizeGmailHistoryId,
  registerGmailWatch,
} from "../../../../../lib/gmail";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const context = await getAppContext();
  if (!code || !state || !context?.organization) {
    return Response.redirect(new URL("/?gmail=invalid-callback", request.url));
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
        ),
      )
      .limit(1)
  )[0];
  if (!stateRow || new Date(stateRow.expiresAt).getTime() < Date.now()) {
    return Response.redirect(new URL("/?gmail=expired-state", request.url));
  }

  try {
    const redirectUri =
      process.env.GMAIL_REDIRECT_URI ||
      new URL("/api/integrations/gmail/callback", request.url).toString();
    const token = await exchangeGoogleCode(code, redirectUri);
    const profile = await getGmailProfile(token.access_token);
    const existing = (
      await db
        .select()
        .from(integrations)
        .where(
          and(
            eq(integrations.organizationId, context.organization.id),
            eq(integrations.provider, "gmail"),
          ),
        )
        .limit(1)
    )[0];
    const encryptedRefreshToken = token.refresh_token
      ? await encryptRefreshToken(token.refresh_token)
      : existing?.encryptedRefreshToken;
    if (!encryptedRefreshToken) {
      throw new Error("Google returned no refresh token");
    }
    const watch = await registerGmailWatch(token.access_token);
    const historyId = normalizeGmailHistoryId(
      watch?.historyId || profile.historyId,
    );
    const now = new Date().toISOString();

    await db
      .insert(integrations)
      .values({
        id: existing?.id || `integration_${crypto.randomUUID()}`,
        organizationId: context.organization.id,
        provider: "gmail",
        accountEmail: profile.emailAddress,
        status: "connected",
        encryptedRefreshToken,
        scopes: token.scope,
        historyId,
        watchExpiration: watch?.expiration
          ? new Date(Number(watch.expiration)).toISOString()
          : null,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [integrations.organizationId, integrations.provider],
        set: {
          accountEmail: profile.emailAddress,
          status: "connected",
          encryptedRefreshToken,
          scopes: token.scope,
          historyId,
          watchExpiration: watch?.expiration
            ? new Date(Number(watch.expiration)).toISOString()
            : null,
          updatedAt: now,
        },
      });
    await db.delete(oauthStates).where(eq(oauthStates.state, state));
    return Response.redirect(new URL("/?gmail=connected", request.url));
  } catch (caught) {
    const message =
      caught instanceof Error ? caught.message : "Unknown Gmail callback error";
    console.error("Gmail OAuth callback failed:", message);
    const reason = message.includes("UNIQUE constraint failed")
      ? "account-in-use"
      : message.includes("Google token exchange failed")
        ? "token-exchange"
        : message.includes("no refresh token")
          ? "no-refresh-token"
          : "failed";
    return Response.redirect(new URL(`/?gmail=${reason}`, request.url));
  }
}
