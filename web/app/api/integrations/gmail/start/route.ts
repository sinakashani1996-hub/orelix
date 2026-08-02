import { getDb } from "../../../../../db";
import { oauthStates } from "../../../../../db/schema";
import { getAppContext } from "../../../../../lib/context";
import { GMAIL_SCOPES, gmailConfig } from "../../../../../lib/gmail";

export async function GET(request: Request) {
  const context = await getAppContext();
  if (!context?.organization) {
    return Response.redirect(new URL("/?gmail=workspace-required", request.url));
  }
  const config = gmailConfig();
  if (!config) {
    return Response.redirect(new URL("/?gmail=setup-required", request.url));
  }

  const state = crypto.randomUUID();
  const redirectUri =
    process.env.GMAIL_REDIRECT_URI ||
    new URL("/api/integrations/gmail/callback", request.url).toString();
  await getDb().insert(oauthStates).values({
    state,
    organizationId: context.organization.id,
    authUserId: context.user.id,
    provider: "gmail",
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });

  const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorization.searchParams.set("client_id", config.clientId);
  authorization.searchParams.set("redirect_uri", redirectUri);
  authorization.searchParams.set("response_type", "code");
  authorization.searchParams.set("scope", GMAIL_SCOPES.join(" "));
  authorization.searchParams.set("access_type", "offline");
  authorization.searchParams.set("include_granted_scopes", "true");
  authorization.searchParams.set("prompt", "consent");
  authorization.searchParams.set("state", state);
  return Response.redirect(authorization);
}
