import { WorkOS } from "@workos-inc/node";
import { cookies, headers } from "next/headers";

const SESSION_COOKIE = "orelix_session";
const AUTH_STATE_COOKIE = "orelix_auth_state";
const LOCAL_SIGNED_OUT_COOKIE = "orelix_local_signed_out";

export type OrelixUser = {
  id: string;
  email: string;
  name: string;
  provider: "workos" | "sites" | "local";
  providerOrganizationId?: string;
  role?: string;
};

export function workosConfig() {
  const apiKey = process.env.WORKOS_API_KEY;
  const clientId = process.env.WORKOS_CLIENT_ID;
  const cookiePassword = process.env.WORKOS_COOKIE_PASSWORD;
  if (!apiKey || !clientId || !cookiePassword || cookiePassword.length < 32) {
    return null;
  }
  return { apiKey, clientId, cookiePassword };
}

export function getWorkOS() {
  const config = workosConfig();
  return config ? new WorkOS(config.apiKey, { clientId: config.clientId }) : null;
}

export async function getCurrentUser(): Promise<OrelixUser | null> {
  const config = workosConfig();
  const cookieStore = await cookies();
  const sealedSession = cookieStore.get(SESSION_COOKIE)?.value;

  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "";
  // Local development skips WorkOS entirely, even when the production keys
  // from .env.local are present. The AuthKit callback points at app.orelix.be,
  // so a real login flow can never complete on localhost anyway. Afmelden zou
  // daardoor niets doen; de marker hieronder maakt uitloggen lokaal wel mogelijk.
  if (
    process.env.NODE_ENV !== "production" &&
    (host.startsWith("localhost") || host.startsWith("127.0.0.1"))
  ) {
    if (cookieStore.get(LOCAL_SIGNED_OUT_COOKIE)?.value === "1") return null;
    return {
      id: "local:sina",
      email: "demo@orelix.local",
      name: "Sina Kashani",
      provider: "local",
    };
  }

  if (config) {
    if (!sealedSession) return null;
    try {
      const workos = new WorkOS(config.apiKey, { clientId: config.clientId });
      const result =
        await workos.userManagement.authenticateWithSessionCookie({
          sessionData: sealedSession,
          cookiePassword: config.cookiePassword,
        });
      if (result.authenticated) {
        const name =
          result.user.name ||
          [result.user.firstName, result.user.lastName].filter(Boolean).join(" ") ||
          result.user.email;
        return {
          id: result.user.id,
          email: result.user.email,
          name,
          provider: "workos",
          providerOrganizationId: result.organizationId,
          role: result.role,
        };
      }
    } catch {
      // Invalid or expired WorkOS sessions must never fall back to another identity.
    }
    return null;
  }

  const email = requestHeaders.get("oai-authenticated-user-email");
  if (email) {
    const encodedName = requestHeaders.get("oai-authenticated-user-full-name");
    const encoding = requestHeaders.get(
      "oai-authenticated-user-full-name-encoding",
    );
    const name =
      encodedName && encoding === "percent-encoded-utf-8"
        ? safeDecode(encodedName) || email
        : email;
    return { id: `sites:${email}`, email, name, provider: "sites" };
  }

  if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) {
    return {
      id: "local:sina",
      email: "demo@orelix.local",
      name: "Sina Kashani",
      provider: "local",
    };
  }

  return null;
}

export function sessionCookieName() {
  return SESSION_COOKIE;
}

export function authStateCookieName() {
  return AUTH_STATE_COOKIE;
}

export function localSignedOutCookieName() {
  return LOCAL_SIGNED_OUT_COOKIE;
}

/** True when this request runs against the local demo bypass. */
export function isLocalDevRequest(host: string) {
  return (
    process.env.NODE_ENV !== "production" &&
    (host.startsWith("localhost") || host.startsWith("127.0.0.1"))
  );
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
