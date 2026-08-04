import { connect } from "cloudflare:sockets";
import { buildGmailRawMessage, type OutboundWorkItemEmail } from "./gmail-message";
import { parseImapMailboxSettings } from "./imap";
import { decryptMailboxCredentials } from "./mail-credentials";
import { integrations } from "../db/schema";

type Integration = typeof integrations.$inferSelect;

/**
 * Checks the outbound half of an IMAP/SMTP connection before Orelix stores
 * anything. Without this check a mailbox could look connected yet fail only
 * when a customer reply is approved.
 */
export async function verifySmtpMailbox(
  settings: ReturnType<typeof parseImapMailboxSettings>,
) {
  const client = await openSmtp(settings.smtpHost, settings.smtpPort);
  try {
    await client.expect("220");
    await client.command("EHLO orelix-office.local", "250");
    if (settings.smtpPort === 587) {
      await client.command("STARTTLS", "220");
      await client.startTls();
      await client.command("EHLO orelix-office.local", "250");
    }
    await client.command("AUTH LOGIN", "334");
    await client.command(base64(settings.email), "334");
    await client.command(base64(settings.password), "235");
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "";
    if (/SMTP-server weigerde de verzending|SMTP-server sloot/i.test(message)) {
      throw new Error(
        "Aanmelden bij de uitgaande mailserver is geweigerd. Controleer SMTP-server, poort en mailboxwachtwoord.",
      );
    }
    throw caught;
  } finally {
    await client.close();
  }
}

/** Sends an approved draft from a standard SMTP mailbox over implicit TLS (465)
 * or STARTTLS (587). The mailbox password is decrypted only for this request. */
export async function sendSmtpWorkItemEmail(
  integration: Integration,
  workItem: OutboundWorkItemEmail,
) {
  if (!integration.encryptedCredentials) {
    throw new Error("De mailboxgegevens ontbreken. Koppel de mailbox opnieuw.");
  }
  const stored = await decryptMailboxCredentials<Record<string, unknown>>(
    integration.encryptedCredentials,
  );
  const settings = parseImapMailboxSettings(stored);
  const messageId = `<orelix.${crypto.randomUUID()}@${settings.email.split("@")[1]}>`;
  const raw = buildGmailRawMessage({
    ...workItem,
    fromEmail: settings.email,
    messageId,
    replyToMessageId: messageIdForReply(workItem.providerThreadId),
  });
  const client = await openSmtp(settings.smtpHost, settings.smtpPort);
  try {
    await client.expect("220");
    await client.command("EHLO orelix-office.local", "250");
    if (settings.smtpPort === 587) {
      await client.command("STARTTLS", "220");
      await client.startTls();
      await client.command("EHLO orelix-office.local", "250");
    }
    await client.command("AUTH LOGIN", "334");
    await client.command(base64(settings.email), "334");
    await client.command(base64(settings.password), "235");
    await client.command(`MAIL FROM:<${settings.email}>`, "250");
    await client.command(`RCPT TO:<${workItem.customerEmail}>`, ["250", "251"]);
    await client.command("DATA", "354");
    await client.command(`${dotStuff(raw)}\r\n.`, "250");
    return { id: messageId, threadId: messageId };
  } finally {
    await client.close();
  }
}

async function openSmtp(hostname: string, port: number) {
  let socket = connect(
    { hostname, port },
    { secureTransport: port === 465 ? "on" : "starttls" },
  );
  let reader = new SmtpReader(socket.readable.getReader());
  let writer = socket.writable.getWriter();
  return {
    expect: (code: string) => reader.expect(code),
    async command(value: string, expected: string | string[]) {
      await writer.write(new TextEncoder().encode(`${value}\r\n`));
      await reader.expect(expected);
    },
    async startTls() {
      reader.release();
      writer.releaseLock();
      socket = socket.startTls();
      reader = new SmtpReader(socket.readable.getReader());
      writer = socket.writable.getWriter();
    },
    async close() {
      try {
        await writer.write(new TextEncoder().encode("QUIT\r\n"));
        await reader.expect("221");
      } catch {
        // A failed authentication or a server close still needs local cleanup.
      }
      try {
        await writer.close();
      } catch {
        // Ignore an already closed socket.
      }
      reader.release();
      writer.releaseLock();
      await socket.close().catch(() => undefined);
    },
  };
}

class SmtpReader {
  private buffer = "";
  private readonly decoder = new TextDecoder();

  constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {}

  async expect(expected: string | string[]) {
    const expectedCodes = Array.isArray(expected) ? expected : [expected];
    let final = "";
    for (;;) {
      const line = await this.readLine();
      const match = line.match(/^(\d{3})([ -])/);
      if (!match) continue;
      if (!expectedCodes.includes(match[1])) {
        throw new Error("De SMTP-server weigerde de verzending");
      }
      final = line;
      if (match[2] === " ") return final;
    }
  }

  release() {
    this.reader.releaseLock();
  }

  private async readLine() {
    while (!this.buffer.includes("\n")) {
      const { done, value } = await this.reader.read();
      if (done) throw new Error("De SMTP-server sloot de verbinding");
      this.buffer += this.decoder.decode(value, { stream: true });
    }
    const index = this.buffer.indexOf("\n");
    const line = this.buffer.slice(0, index).replace(/\r$/, "");
    this.buffer = this.buffer.slice(index + 1);
    return line;
  }
}

function messageIdForReply(value: string | null) {
  return value && /^<[^>]+>$/.test(value) ? value : null;
}

function dotStuff(value: string) {
  return value.replace(/(^|\n)\./g, "$1..");
}

function base64(value: string) {
  return btoa(new TextEncoder().encode(value).reduce((text, byte) => text + String.fromCharCode(byte), ""));
}
