import { connect } from "cloudflare:sockets";

export type ImapMailboxSettings = {
  email: string;
  password: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
};

export type ImapInboundMessage = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  body: string;
  receivedAt: string;
  uid: string;
};

const MAX_MESSAGE_BYTES = 256 * 1024;
const MAX_RECENT_MESSAGES = 15;

export function parseImapMailboxSettings(value: unknown): ImapMailboxSettings {
  const input = value as Partial<ImapMailboxSettings>;
  const email = input.email?.trim().toLowerCase() || "";
  const password = input.password || "";
  const imapHost = input.imapHost?.trim().toLowerCase() || "";
  const smtpHost = input.smtpHost?.trim().toLowerCase() || "";
  const imapPort = Number(input.imapPort || 993);
  const smtpPort = Number(input.smtpPort || 465);
  if (!/^\S+@\S+\.\S+$/.test(email) || !password) {
    throw new Error("Vul een geldig e-mailadres en mailboxwachtwoord in");
  }
  if (!isSafeMailHost(imapHost) || !isSafeMailHost(smtpHost)) {
    throw new Error("Vul geldige mailservernamen in");
  }
  if (imapPort !== 993 || ![465, 587].includes(smtpPort)) {
    throw new Error("Gebruik IMAP-poort 993 en SMTP-poort 465 of 587");
  }
  return { email, password, imapHost, imapPort, smtpHost, smtpPort };
}

/** Tests the incoming mailbox before Orelix stores any customer credential. */
export async function verifyImapMailbox(settings: ImapMailboxSettings) {
  const session = await openImap(settings);
  try {
    await session.command("A001", `LOGIN ${quote(settings.email)} ${quote(settings.password)}`);
  } finally {
    await session.close();
  }
}

/**
 * Reads a small, bounded window of the INBOX. IMAP has no push service for a
 * generic hosted mailbox, so this is intentionally idempotent and is called by
 * the explicit Sync button (and later by the scheduled connector worker).
 */
export async function fetchRecentImapMessages(
  settings: ImapMailboxSettings,
  limit = MAX_RECENT_MESSAGES,
): Promise<ImapInboundMessage[]> {
  const session = await openImap(settings);
  try {
    await session.command("A001", `LOGIN ${quote(settings.email)} ${quote(settings.password)}`);
    await session.command("A002", "SELECT INBOX");
    const search = await session.command("A003", "UID SEARCH ALL");
    const uids = collectUids(search.lines).slice(-Math.min(limit, MAX_RECENT_MESSAGES));
    const messages: ImapInboundMessage[] = [];
    for (let index = 0; index < uids.length; index += 1) {
      const tag = `F${String(index + 1).padStart(3, "0")}`;
      const fetched = await session.command(
        tag,
        `UID FETCH ${uids[index]} (UID RFC822<0.${MAX_MESSAGE_BYTES}>)`,
      );
      const raw = fetched.literals.join("");
      if (!raw) continue;
      const parsed = parseRawEmail(raw, uids[index]);
      if (parsed) messages.push(parsed);
    }
    return messages;
  } finally {
    await session.close();
  }
}

export function parseRawEmail(raw: string, uid: string): ImapInboundMessage | null {
  const separator = raw.search(/\r?\n\r?\n/);
  const headerBlock = separator >= 0 ? raw.slice(0, separator) : raw;
  const bodyBlock = separator >= 0 ? raw.slice(separator).replace(/^\r?\n\r?\n/, "") : "";
  const headers = parseHeaders(headerBlock);
  const from = headers.get("from") || "";
  if (!from) return null;
  const messageId = normaliseMessageId(headers.get("message-id")) || `imap:${uid}`;
  const reference = lastMessageId(headers.get("in-reply-to")) || lastMessageId(headers.get("references"));
  const date = new Date(headers.get("date") || Date.now());
  return {
    id: messageId,
    threadId: reference || messageId,
    from,
    subject: decodeMimeWords(headers.get("subject") || "(Geen onderwerp)"),
    body: extractTextBody(bodyBlock, headers.get("content-type") || "text/plain", headers.get("content-transfer-encoding") || ""),
    receivedAt: Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(),
    uid,
  };
}

async function openImap(settings: ImapMailboxSettings) {
  const socket = connect(
    { hostname: settings.imapHost, port: settings.imapPort },
    { secureTransport: "on" },
  );
  const reader = new ImapReader(socket.readable.getReader());
  const writer = socket.writable.getWriter();
  const greeting = await reader.readLine();
  if (!greeting.startsWith("* OK")) {
    await safeClose(socket, reader, writer);
    throw new Error("De IMAP-server accepteerde de verbinding niet");
  }
  return {
    async command(tag: string, command: string) {
      await writer.write(new TextEncoder().encode(`${tag} ${command}\r\n`));
      const response = await reader.readUntil(tag);
      if (!/\bOK\b/i.test(response.tagged)) {
        throw new Error("De mailboxserver weigerde de aanvraag");
      }
      return response;
    },
    async close() {
      try {
        await writer.write(new TextEncoder().encode("ZZZ LOGOUT\r\n"));
      } catch {
        // The connection may already have been closed by the server.
      }
      await safeClose(socket, reader, writer);
    },
  };
}

class ImapReader {
  private buffer = new Uint8Array();
  private readonly decoder = new TextDecoder();

  constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {}

  async readUntil(tag: string) {
    const lines: string[] = [];
    const literals: string[] = [];
    for (;;) {
      const line = await this.readLine();
      lines.push(line);
      const literal = line.match(/\{(\d+)\}$/);
      if (literal) {
        const length = Number(literal[1]);
        if (!Number.isSafeInteger(length) || length > MAX_MESSAGE_BYTES) {
          throw new Error("Een e-mail is te groot om veilig te verwerken");
        }
        literals.push(this.decoder.decode(await this.readBytes(length)));
      }
      if (line.startsWith(`${tag} `)) return { lines, literals, tagged: line };
    }
  }

  async readLine() {
    for (;;) {
      const index = this.buffer.indexOf(10);
      if (index >= 0) {
        const line = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 1);
        return this.decoder.decode(line).replace(/\r$/, "");
      }
      await this.fill();
    }
  }

  async readBytes(length: number) {
    while (this.buffer.byteLength < length) await this.fill();
    const value = this.buffer.slice(0, length);
    this.buffer = this.buffer.slice(length);
    return value;
  }

  release() {
    this.reader.releaseLock();
  }

  private async fill() {
    const { done, value } = await this.reader.read();
    if (done || !value) throw new Error("De IMAP-server sloot de verbinding");
    const combined = new Uint8Array(this.buffer.byteLength + value.byteLength);
    combined.set(this.buffer);
    combined.set(value, this.buffer.byteLength);
    this.buffer = combined;
  }
}

async function safeClose(
  socket: ReturnType<typeof connect>,
  reader: ImapReader,
  writer: WritableStreamDefaultWriter<Uint8Array>,
) {
  try {
    await writer.close();
  } catch {
    // Ignore a server-initiated close.
  }
  reader.release();
  writer.releaseLock();
  await socket.close().catch(() => undefined);
}

function collectUids(lines: string[]) {
  const search = lines.find((line) => line.startsWith("* SEARCH ")) || "";
  return search
    .slice("* SEARCH ".length)
    .trim()
    .split(/\s+/)
    .filter((value) => /^\d+$/.test(value));
}

function parseHeaders(value: string) {
  const headers = new Map<string, string>();
  let current = "";
  for (const line of value.replace(/\r\n/g, "\n").split("\n")) {
    if (/^[ \t]/.test(line) && current) {
      headers.set(current, `${headers.get(current) || ""} ${line.trim()}`);
      continue;
    }
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    current = line.slice(0, separator).trim().toLowerCase();
    headers.set(current, line.slice(separator + 1).trim());
  }
  return headers;
}

function extractTextBody(value: string, contentType: string, transferEncoding: string) {
  const boundary = contentType.match(/boundary\s*=\s*"?([^";\s]+)"?/i)?.[1];
  if (boundary) {
    const parts = value.split(new RegExp(`(?:^|\\r?\\n)--${escapeRegExp(boundary)}(?:--)?\\r?\\n`, "g"));
    for (const part of parts) {
      const separator = part.search(/\r?\n\r?\n/);
      if (separator < 0) continue;
      const headers = parseHeaders(part.slice(0, separator));
      const type = headers.get("content-type") || "text/plain";
      if (/text\/plain/i.test(type)) {
        return cleanBody(part.slice(separator).replace(/^\r?\n\r?\n/, ""), headers.get("content-transfer-encoding") || "");
      }
    }
    for (const part of parts) {
      if (/text\/html/i.test(part)) return stripHtml(part);
    }
  }
  return /text\/html/i.test(contentType)
    ? stripHtml(cleanBody(value, transferEncoding))
    : cleanBody(value, transferEncoding);
}

function cleanBody(value: string, transferEncoding: string) {
  if (/base64/i.test(transferEncoding)) {
    try {
      return new TextDecoder().decode(fromBase64(value.replace(/\s+/g, ""))).trim();
    } catch {
      return value.trim();
    }
  }
  if (/quoted-printable/i.test(transferEncoding)) {
    return value
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .trim();
  }
  return value.trim();
}

function stripHtml(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?p[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeMimeWords(value: string) {
  return value.replace(/=\?([^?]+)\?B\?([^?]+)\?=/gi, (_, charset, data) => {
    try {
      return new TextDecoder(charset).decode(fromBase64(data));
    } catch {
      return value;
    }
  });
}

function normaliseMessageId(value?: string) {
  const match = value?.match(/<[^>]+>/);
  return match?.[0] || "";
}

function lastMessageId(value?: string) {
  const ids = value?.match(/<[^>]+>/g);
  return ids?.at(-1) || "";
}

function quote(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function isSafeMailHost(value: string) {
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fromBase64(value: string) {
  const padded = value.padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (byte) => byte.charCodeAt(0));
}
