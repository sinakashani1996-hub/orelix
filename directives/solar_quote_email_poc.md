# Offerte Assistent - Solar POC

## Goal

The solar workflow is the first Offerte Assistent configuration inside Orelix
Office. It identifies new solar installation requests, collects missing project
information, and prepares an internal quote draft.

It is not a separate product. Shared cases, idempotency, approvals, audit state,
and future customer configuration come from `execution/orelix_office_core.py`
and `directives/orelix_office_platform.md`.

## Execution Tool

Use `execution/solar_quote_poc.py`.

Local analysis without durable provider state:

```powershell
python execution/solar_quote_poc.py --email-file samples/quote_request_complete.txt
```

Integration execution with idempotency and audit state:

```powershell
python execution/solar_quote_poc.py `
  --email-file .tmp/solar_quote_poc/gmail_MESSAGE_ID/email.txt `
  --out-dir .tmp/solar_quote_poc/gmail_MESSAGE_ID `
  --message-id GMAIL_MESSAGE_ID `
  --sender customer@example.com
```

The tool writes:

- `analysis.json`: routing, fields, missing fields, approval action, case ID,
  project key, and next action.
- `draft_reply.txt`: clean missing-information text when required.
- `draft_quote.txt`: internal quote draft when the intake is complete.

## Routing

Route to Offerte Assistent when the customer expresses new installation,
purchase, quote, or pricing intent related to solar.

Route maintenance, repair, defect, and failure messages to Service Assistent.
Route unclear messages to Inbox Assistent for manual triage.

Supported intent must include natural Dutch wording such as `ik wil
zonnepanelen`, `kunnen jullie mij contacteren`, `prijsindicatie`, and `graag een
offerte`; the literal word `offerte` is not mandatory.

## Required Intake Information

- Contact name.
- Full installation address, including postal code and municipality.
- Property type.
- For Dutch/Belgian residential cases: whether the home is older than 10 years.
- Annual electricity usage or desired panel count.
- Roof type or ground-mount preference.
- Battery preference: with, without, or both variants.
- Desired timeline.

A complete first message proceeds directly to a quote draft. Never send a
generic questionnaire when the customer already supplied all required fields.
When data is missing, ask only for the missing fields.

## Approval and Sending

Default policy:

- Missing-information output is a Gmail draft for approval.
- Quote output is always a Gmail draft for approval.
- Quotes are never sent automatically.
- Automatic missing-information messages are permitted only after an explicit
  customer-level configuration change with a maximum-send limit.
- Uncertain routing or extraction produces manual review, not an automatic send.

The deterministic script reports `outbound_action`; the Gmail integration must
obey it. Terminal output must never be used as an email body. Read the artifact
file directly.

## Project and Message State

Use Gmail message ID as `--message-id`. The local workflow database atomically
prevents a second processing attempt from creating another draft.

Use sender plus installation address as the default project identity. If a
known CRM or case ID is available, pass it as `--project-key`.

Different confirmed installation addresses are different projects. Unknown
addresses must not be used to merge unrelated long-running conversations
without human review.

Gmail labels may be used for visibility:

- `Orelix Processed`
- `Orelix Needs Review`
- `Orelix Waiting for Customer`

They mirror the database and are not the only duplicate-prevention mechanism.

## Email Hygiene

- Analyze customer-authored inbound content only.
- Strip quoted history beginning with `On ... wrote:`, `Op ... schreef:`, or
  lines prefixed by `>`.
- Never include old outgoing replies in extracted customer fields.
- Prefer a normal threaded draft. Do not create a separate conversation merely
  to avoid Gmail quoting; build a clean body instead.
- Never archive or delete customer mail automatically.

## Extraction Edge Cases

- Belgian addresses without a street suffix, such as `Meir 10, 2000
  Antwerpen`, are valid.
- Street and house number without postal code and municipality is partial.
- Dutch thousands notation such as `4.500 kWh` means 4500 kWh.
- Explicit `per maand` usage is annualized; explicit `per jaar` usage is not.
- Desired panel count satisfies the energy requirement.
- A supplied build year answers the older-than-10-years question.
- `Met thuisbatterij en zonder` means both variants.
- Do not infer roof type from quoted questionnaire text.

## Pricing Scope

Current quote amounts remain preliminary POC placeholders and are outside the
present platform-hardening scope. Human review remains mandatory.

## Gmail Recovery Monitor

The existing Codex automation remains paused. It is a temporary recovery poller,
not the production architecture.

When deliberately enabled for a controlled POC, it must:

1. Work in the Orelix Office project directory.
2. Process at most 10 unprocessed candidate messages.
3. Clean inbound content.
4. Call the deterministic script with message ID and sender.
5. Skip `duplicate: true`.
6. Create only the artifact allowed by `outbound_action`.
7. Mirror the persisted state with Gmail labels.
8. Never send quotes, archive mail, or delete mail.
