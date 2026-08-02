import { NextResponse } from "next/server";
import {
  authStateCookieName,
  getWorkOS,
  workosConfig,
} from "../../lib/auth";

export async function GET(request: Request) {
  const config = workosConfig();
  const workos = getWorkOS();
  if (!config || !workos) {
    return NextResponse.redirect(new URL("/?auth=setup-required", request.url));
  }

  const state = crypto.randomUUID();
  const redirectUri = new URL("/auth/callback", request.url).toString();
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
