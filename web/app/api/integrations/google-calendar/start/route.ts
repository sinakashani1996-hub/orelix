import { getDb } from "../../../../../db";
import { oauthStates } from "../../../../../db/schema";
import { getAppContext } from "../../../../../lib/context";
import {
  GOOGLE_CALENDAR_SCOPES,
  isGoogleCalendarConfigured,
} from "../../../../../lib/google-calendar";
import { appUrl } from "../../../../../lib/app-url";

export async function GET(request: Request) {
  const context = await getAppContext();
  if (!context?.organization) {
    return Response.redirect(new URL("/planning?calendar=workspace-required", request.url));
  }
  if (!isGoogleCalendarConfigured()) {
    return Response.redirect(new URL("/planning?calendar=setup-required", request.url));
  }

  const state = crypto.randomUUID();
  const redirectUri = appUrl(
    request,
    "/api/integrations/google-calendar/callback",
    process.env.GOOGLE_CALENDAR_REDIRECT_URI,
  );
  await getDb().insert(oauthStates).values({
    state,
    organizationId: context.organization.id,
    authUserId: context.user.id,
    provider: "google_calendar",
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });

  const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorization.searchParams.set(
    "client_id",
    process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GMAIL_CLIENT_ID || "",
  );
  authorization.searchParams.set("redirect_uri", redirectUri);
  authorization.searchParams.set("response_type", "code");
  authorization.searchParams.set("scope", GOOGLE_CALENDAR_SCOPES.join(" "));
  authorization.searchParams.set("access_type", "offline");
  authorization.searchParams.set("include_granted_scopes", "true");
  authorization.searchParams.set("prompt", "consent");
  authorization.searchParams.set("state", state);
  return Response.redirect(authorization);
}
