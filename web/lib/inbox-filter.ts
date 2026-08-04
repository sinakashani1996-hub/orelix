export type MailboxFilterInput = {
  from: string;
  subject: string;
  body: string;
  autoSubmitted?: string;
  listUnsubscribe?: string;
  precedence?: string;
};

export type MailboxFilterResult =
  | { action: "keep" }
  | { action: "ignore"; reason: string };

/**
 * Keep the working inbox for messages that need a person or an assistant.
 * This is intentionally deterministic: marketing and machine-generated mail
 * should never consume AI capacity or become an open task.
 */
export function filterInboundMailboxMessage(
  input: MailboxFilterInput,
): MailboxFilterResult {
  const from = input.from.toLowerCase();
  const subject = input.subject.toLowerCase().replace(/\s+/g, " ").trim();
  const body = input.body.toLowerCase();
  const headers = `${input.autoSubmitted || ""} ${input.precedence || ""}`.toLowerCase();

  if (
    input.listUnsubscribe ||
    /\b(?:list|bulk|junk)\b/.test(headers) ||
    /(?:uitschrijven|unsubscribe|manage (?:your )?preferences)/i.test(body)
  ) {
    return { action: "ignore", reason: "nieuwsbrief of mailing" };
  }

  if (
    /\b(?:auto-?submitted|auto-replied)\b/.test(headers) ||
    /^(?:automatisch antwoord|automatic reply|auto(?:matic)? response|out of office|afwezig|verlof|vacation|ooo)\b/i.test(subject) ||
    /\b(?:out of office|afwezig(?:heidsmelding)?|ben .* verlof|automatic reply)\b/i.test(body)
  ) {
    return { action: "ignore", reason: "automatisch antwoord of afwezigheidsmelding" };
  }

  if (
    /(?:mailer-daemon|postmaster|mail delivery subsystem)/i.test(from) ||
    /^(?:delivery status notification|undeliverable|failure notice|returned mail|onbestelbaar|niet afgeleverd)\b/i.test(subject)
  ) {
    return { action: "ignore", reason: "bezorg- of foutmelding" };
  }

  if (
    /^(?:beveiligingsmelding|security alert|login notification|verificatiecode|verification code|confirm your email)\b/i.test(subject) ||
    /\b(?:google|microsoft)\b.{0,70}\b(?:verification code|beveiligingsmelding|security alert)\b/i.test(body)
  ) {
    return { action: "ignore", reason: "account- of beveiligingsmelding" };
  }

  return { action: "keep" };
}
