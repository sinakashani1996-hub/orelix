import { NextResponse } from "next/server";
import {
  authStateCookieName,
  getWorkOS,
  isLocalDevRequest,
  localSignedOutCookieName,
  workosConfig,
} from "../../lib/auth";
import { appUrl } from "../../lib/app-url";

export async function GET(request: Request) {
  // De AuthKit-callback wijst naar productie, dus lokaal aanmelden betekent
  // simpelweg de demo-gebruiker weer toelaten.
  if (isLocalDevRequest(new URL(request.url).host)) {
    const localResponse = NextResponse.redirect(new URL("/", request.url));
    localResponse.cookies.delete(localSignedOutCookieName());
    return localResponse;
  }

  const config = workosConfig();
  const workos = getWorkOS();
  if (!config || !workos) {
    return NextResponse.redirect(new URL("/?auth=setup-required", request.url));
  }

  const state = crypto.randomUUID();
  const redirectUri = appUrl(
    request,
    "/auth/callback",
    process.env.WORKOS_REDIRECT_URI,
  );
  const authorizationUrl = workos.userManagement.getAuthorizationUrl({
    clientId: config.clientId,
    provider: "authkit",
    redirectUri,
    state,
  });
  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set(authStateCookieName(), state, {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return response;
}
