import { NextResponse } from "next/server";
import {
  authStateCookieName,
  getWorkOS,
  sessionCookieName,
  workosConfig,
} from "../../../lib/auth";

export async function GET(request: Request) {
  const config = workosConfig();
  const workos = getWorkOS();
  if (!config || !workos) {
    return NextResponse.redirect(new URL("/?auth=setup-required", request.url));
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieHeader = request.headers.get("cookie") ?? "";
  const expectedState = cookieHeader
    .split(";")
    .map((item) => item.trim().split("="))
    .find(([name]) => name === authStateCookieName())?.[1];

  if (!code || !state || state !== expectedState) {
    return NextResponse.redirect(new URL("/?auth=invalid-state", request.url));
  }

  try {
    const auth = await workos.userManagement.authenticateWithCode({
      clientId: config.clientId,
      code,
      session: {
        sealSession: true,
        cookiePassword: config.cookiePassword,
      },
    });
    if (!auth.sealedSession) throw new Error("Missing sealed session");

    const response = NextResponse.redirect(new URL("/", request.url));
    response.cookies.set(sessionCookieName(), auth.sealedSession, {
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });
    response.cookies.delete(authStateCookieName());
    return response;
  } catch {
    return NextResponse.redirect(new URL("/?auth=failed", request.url));
  }
}
