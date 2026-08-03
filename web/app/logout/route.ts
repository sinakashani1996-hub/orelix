import { NextResponse } from "next/server";
import {
  authStateCookieName,
  getWorkOS,
  sessionCookieName,
  workosConfig,
} from "../../lib/auth";

export async function GET(request: Request) {
  const fallbackUrl = new URL("/", request.url);
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
