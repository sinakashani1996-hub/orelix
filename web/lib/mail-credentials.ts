/**
 * Encryption shared by non-OAuth mailbox integrations.
 *
 * The secret is supplied only by the Orelix runtime. The browser never sees it
 * and mailbox passwords are encrypted before they enter D1.
 */
export async function encryptMailboxCredentials(value: object) {
  const key = await mailboxEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return `${toBase64(iv)}.${toBase64(new Uint8Array(encrypted))}`;
}

export async function decryptMailboxCredentials<T extends object>(value: string) {
  const [ivValue, encryptedValue] = value.split(".");
  if (!ivValue || !encryptedValue) throw new Error("Ongeldige mailboxgegevens");
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(ivValue) },
    await mailboxEncryptionKey(),
    fromBase64(encryptedValue),
  );
  return JSON.parse(new TextDecoder().decode(decrypted)) as T;
}

async function mailboxEncryptionKey() {
  // GMAIL_TOKEN_ENCRYPTION_KEY already exists in the live environment. A
  // dedicated MAIL_CREDENTIAL_ENCRYPTION_KEY can be introduced without a
  // migration later; both must be a 32-byte base64 value.
  const raw =
    process.env.MAIL_CREDENTIAL_ENCRYPTION_KEY ||
    process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("Mail-encryptiesleutel ontbreekt");
  const bytes = fromBase64(raw);
  if (bytes.byteLength !== 32) {
    throw new Error("Mail-encryptiesleutel moet 32 bytes zijn");
  }
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

function toBase64(value: Uint8Array) {
  let binary = "";
  value.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary);
}

function fromBase64(value: string) {
  const padded = value.padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
