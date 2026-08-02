import { NextResponse } from "next/server";
import { sessionCookieName } from "../../lib/auth";

export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.delete(sessionCookieName());
  return response;
}
