import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { integrations } from "../db/schema";

type Integration = typeof integrations.$inferSelect;

export const GOOGLE_CALENDAR_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
];

type GoogleToken = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
};

export type GoogleCalendarEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

function calendarConfig() {
  // A single Google OAuth client can be used for Gmail and Calendar. Separate
  // variables remain possible when Orelix later splits the Google projects.
  const clientId =
    process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GMAIL_CLIENT_ID;
  const clientSecret =
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET;
  const encryptionKey =
    process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY ||
    process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
  if (!clientId || !clientSecret || !encryptionKey) return null;
  return { clientId, clientSecret, encryptionKey };
}

function requireCalendarConfig() {
  const config = calendarConfig();
  if (!config) {
    throw new Error("Google Agenda is nog niet geconfigureerd");
  }
  return config;
}

export function isGoogleCalendarConfigured() {
  return Boolean(calendarConfig());
}

export async function exchangeGoogleCalendarCode(
  code: string,
  redirectUri: string,
): Promise<GoogleToken> {
  const config = requireCalendarConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) {
    throw new Error(`Google Agenda token exchange failed: ${response.status}`);
  }
  return (await response.json()) as GoogleToken;
}

export async function googleCalendarProfile(accessToken: string) {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Google Agenda profiel ophalen failed: ${response.status}`);
  }
  return (await response.json()) as { email?: string };
}

export async function encryptCalendarRefreshToken(token: string) {
  const key = await calendarEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(token),
  );
  return `${base64(iv)}.${base64(new Uint8Array(encrypted))}`;
}

async function decryptCalendarRefreshToken(value: string) {
  const [ivValue, encryptedValue] = value.split(".");
  if (!ivValue || !encryptedValue) throw new Error("Ongeldige Google Agenda-token");
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(ivValue) },
    await calendarEncryptionKey(),
    fromBase64(encryptedValue),
  );
  return new TextDecoder().decode(decrypted);
}

export async function calendarAccessTokenFor(integration: Integration) {
  const config = requireCalendarConfig();
  const refreshToken = await decryptCalendarRefreshToken(
    integration.encryptedRefreshToken,
  );
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) {
    throw new Error(`Google Agenda token vernieuwen failed: ${response.status}`);
  }
  return ((await response.json()) as { access_token: string }).access_token;
}

export async function calendarIntegrationForOrganization(organizationId: string) {
  return (
    await getDb()
      .select()
      .from(integrations)
      .where(
        and(
          eq(integrations.organizationId, organizationId),
          eq(integrations.provider, "google_calendar"),
        ),
      )
      .limit(1)
  )[0] ?? null;
}

export async function listUpcomingCalendarEvents(integration: Integration) {
  const accessToken = await calendarAccessTokenFor(integration);
  const url = new URL(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
  );
  url.searchParams.set("timeMin", new Date().toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "100");
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Google Agenda ophalen failed: ${response.status}`);
  }
  const result = (await response.json()) as { items?: GoogleCalendarEvent[] };
  return result.items || [];
}

export async function createGoogleCalendarEvent(
  integration: Integration,
  event: {
    title: string;
    description?: string;
    location?: string;
    startDateTime: string;
    endDateTime: string;
  },
) {
  const accessToken = await calendarAccessTokenFor(integration);
  const response = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        summary: event.title,
        description: event.description || undefined,
        location: event.location || undefined,
        start: { dateTime: event.startDateTime, timeZone: "Europe/Brussels" },
        end: { dateTime: event.endDateTime, timeZone: "Europe/Brussels" },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Google Agenda afspraak opslaan failed: ${response.status}`);
  }
  return (await response.json()) as GoogleCalendarEvent;
}

async function calendarEncryptionKey() {
  const value = requireCalendarConfig().encryptionKey;
  return crypto.subtle.importKey(
    "raw",
    fromBase64(value),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

function base64(value: Uint8Array) {
  return btoa(String.fromCharCode(...value));
}

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
