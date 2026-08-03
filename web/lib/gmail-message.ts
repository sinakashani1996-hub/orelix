export type OutboundWorkItemEmail = {
  customerEmail: string;
  customerName: string;
  sourceSubject: string | null;
  draft: string;
  providerThreadId: string | null;
  fromEmail?: string;
  messageId?: string;
  replyToMessageId?: string | null;
  subjectOverride?: string;
  attachment?: {
    filename: string;
    contentType: string;
    bytes: Uint8Array;
  };
};

export function buildGmailRawMessage(workItem: OutboundWorkItemEmail) {
  const subject =
    workItem.subjectOverride ||
    (workItem.sourceSubject?.startsWith("Re:")
      ? workItem.sourceSubject
      : `Re: ${workItem.sourceSubject || "Uw aanvraag"}`);
  const headers = [
    ...(workItem.fromEmail ? [`From: <${workItem.fromEmail}>`] : []),
    `To: ${mimeHeader(workItem.customerName)} <${workItem.customerEmail}>`,
    `Subject: ${mimeHeader(subject)}`,
    ...(workItem.messageId ? [`Message-ID: ${workItem.messageId}`] : []),
    ...(workItem.replyToMessageId
      ? [
          `In-Reply-To: ${workItem.replyToMessageId}`,
          `References: ${workItem.replyToMessageId}`,
        ]
      : []),
    "MIME-Version: 1.0",
  ];

  if (!workItem.attachment) {
    return [
      ...headers,
      "Content-Type: text/plain; charset=utf-8",
      "",
      workItem.draft,
    ].join("\r\n");
  }

  const boundary = `orelix_${crypto.randomUUID().replace(/-/g, "")}`;
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(base64(new TextEncoder().encode(workItem.draft))),
    `--${boundary}`,
    `Content-Type: ${workItem.attachment.contentType}; name="${workItem.attachment.filename}"`,
    `Content-Disposition: attachment; filename="${workItem.attachment.filename}"`,
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(base64(workItem.attachment.bytes)),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

function base64(value: Uint8Array) {
  let binary = "";
  value.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary);
}

function mimeHeader(value: string) {
  return `=?UTF-8?B?${base64(new TextEncoder().encode(value))}?=`;
}

function wrapBase64(value: string) {
  return value.match(/.{1,76}/g)?.join("\r\n") || "";
}
