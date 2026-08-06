import { NextResponse } from "next/server";
import {
  authStateCookieName,
  getWorkOS,
  isLocalDevRequest,
  localSignedOutCookieName,
  sessionCookieName,
  workosConfig,
} from "../../lib/auth";

export async function GET(request: Request) {
  const fallbackUrl = new URL("/", request.url);

  // Lokaal bestaat er geen WorkOS-sessie om te beëindigen. Zonder deze marker
  // zou de demo-gebruiker meteen weer aangemeld zijn en leek afmelden stuk.
  if (isLocalDevRequest(new URL(request.url).host)) {
    const localResponse = NextResponse.redirect(fallbackUrl);
    localResponse.cookies.set(localSignedOutCookieName(), "1", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    localResponse.cookies.delete(sessionCookieName());
    localResponse.cookies.delete(authStateCookieName());
    return localResponse;
  }
  const cookieHeader = request.headers.get("cookie") ?? "";
  const sealedSession = cookieHeader
    .split(";")
    .map((item) => item.trim().split("="))
    .find(([name]) => name === sessionCookieName())?.[1];

  let destination = fallbackUrl;
  const config = workosConfig();
  const workos = getWorkOS();

  // Deleting only Orelix's cookie leaves the WorkOS browser session alive.
  // End both sessions so the next visit always shows the sign-in screen.
  if (config && workos && sealedSession) {
    try {
      const auth = await workos.userManagement.authenticateWithSessionCookie({
        sessionData: sealedSession,
        cookiePassword: config.cookiePassword,
      });
      if (auth.authenticated) {
        destination = new URL(
          workos.userManagement.getLogoutUrl({ sessionId: auth.sessionId }),
        );
      }
    } catch {
      // The local cookie is still removed below, even when it has expired.
    }
  }

  const response = NextResponse.redirect(destination);
  response.cookies.delete(sessionCookieName());
  response.cookies.delete(authStateCookieName());
  return response;
}
