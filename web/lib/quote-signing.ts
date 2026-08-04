import type { QuoteBuilder } from "./quote-builder";

export type QuoteAcceptance = {
  signerName: string;
  acceptedAt: string;
  customerEmail: string;
  quoteHash: string;
  signatureDataUrl: string;
};

export function createSigningToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64Url(bytes);
}

export async function hashSigningToken(token: string) {
  return sha256Text(token);
}

export async function hashQuoteSnapshot(builder: QuoteBuilder) {
  return sha256Text(JSON.stringify(builder));
}

export function parseSignatureDataUrl(value: unknown) {
  if (typeof value !== "string") {
    throw new Error("Plaats eerst uw handtekening");
  }
  const match = value.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("De handtekening is ongeldig");
  const bytes = Uint8Array.from(atob(match[1]), (character) =>
    character.charCodeAt(0),
  );
  if (bytes.byteLength < 100 || bytes.byteLength > 150_000) {
    throw new Error("De handtekening is ongeldig of te groot");
  }
  return { dataUrl: value, bytes };
}

export function safeSignerName(value: unknown) {
  if (typeof value !== "string") throw new Error("Vul uw volledige naam in");
  const name = value.trim().replace(/\s+/g, " ").slice(0, 140);
  if (name.length < 2) throw new Error("Vul uw volledige naam in");
  return name;
}

async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
