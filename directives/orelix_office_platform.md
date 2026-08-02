# Orelix Office Platform

## Goal

Provide one modular office-automation platform. A customer buys Orelix Office
and activates only the required modules:

- Offerte Assistent
- Inbox Assistent
- Service Assistent
- Planning Assistent
- CRM Assistent

Modules must share customer identity, cases, inbound messages, approval rules,
audit events, and integrations. Do not implement each module as an isolated
product.

## Shared Execution Layer

Use `execution/orelix_office_core.py` for:

- Stable project and case identifiers.
- Atomic provider-message claims to prevent duplicate processing.
- Case workflow state.
- Audit events.
- Per-customer outbound approval policy.

The local POC state is stored in `.tmp/orelix_office/workflow.db`. Gmail labels
may mirror workflow state for operators, but labels are not the source of truth.
A hosted deployment should replace the local database with a managed database
while preserving the same state transitions and uniqueness constraints.

## Module Routing

Every inbound message is first routed to a module:

- New installation, purchase, pricing, or quote intent -> Offerte Assistent.
- Maintenance, failure, defect, or repair intent -> Service Assistent.
- General or uncertain messages -> Inbox Assistent for human triage.
- Confirmed appointments and resource allocation -> Planning Assistent.
- Customer/contact enrichment and follow-up state -> CRM Assistent.

Uncertain routing must not cause an automatic outbound message.

## Approval Policy

Safe defaults:

- Quotes are always drafts and always require human approval.
- Missing-information questions are drafts by default.
- Automatic information requests require an explicit per-customer setting and
  a configured maximum number.
- Unknown, conflicting, or low-confidence cases require human review.
- No module may archive or delete customer messages automatically.

## Processing Contract

An integration must provide at least:

- Provider message ID.
- Sender identity.
- Clean inbound message content.
- Optional explicit project key when the project is already known.

The processor must:

1. Claim the provider message ID atomically.
2. Skip it when it has already been claimed.
3. Route and analyze the message.
4. Create an artifact or manual-review result.
5. Persist the case transition and audit event.
6. Mark failures explicitly so operators can retry them safely.

## Scheduling

The production target is event-driven processing with a queue. Periodic polling
is a recovery mechanism, not the primary workflow.

For the local POC:

- Keep the Gmail monitor paused until Gmail access and customer approval policy
  are explicitly configured.
- When used, process at most 10 messages per run.
- Pass Gmail message ID and sender to the deterministic script.
- Do not rely only on Gmail labels for duplicate prevention.
- A slower recovery interval is preferred over continuous five-minute full-agent
  polling.

## Module Activation

Module activation is customer-specific configuration. A disabled module may
classify and route a message to Inbox Assistent, but it must not perform its
module action.

Activation, automatic-send permission, sender identities, templates, and
integration credentials must eventually live in tenant configuration rather
than hardcoded scripts or automation prompts.

## SaaS Customer Pilot

The `web/` application is the customer-facing Orelix Office control room. It
uses a persistent D1 database for module and work-item state and exposes
approval actions through an authenticated API route.

Current pilot scope:

- WorkOS AuthKit customer login with organization membership checks.
- Organization-scoped records, integrations, module activation, and audit data.
- Central worklist and dossier detail drawer.
- Module overview for Offerte, Inbox, Service, Planning, and CRM.
- Gmail OAuth with encrypted refresh-token storage.
- Event-driven Gmail ingestion through a Google Pub/Sub webhook.
- Provider message deduplication and deterministic module routing.
- Explicit approval followed by Gmail delivery and an audit event.

Until WorkOS and Google Cloud credentials are configured, the private Sites
identity gate and demo organization remain available for validation. They are
not the final customer identity model.

## Customer Pilot Setup

Required hosted secrets are listed in `web/.env.example`. Store them in the
hosting environment; never commit or paste secret values into source files.

Before inviting a pilot customer:

1. Configure a WorkOS application, redirect URI, cookie password, and client
   credentials.
2. Configure a Google OAuth web client and add the Gmail callback URI.
3. Create the Google Pub/Sub topic allowed by Gmail and point its push
   subscription at `/api/webhooks/gmail`.
4. Configure OIDC verification for the push subscription, or use the static
   webhook secret only as a temporary fallback.
5. Set `GMAIL_TOKEN_ENCRYPTION_KEY` to a random 32-byte base64 key.
6. Run a test with a dedicated pilot mailbox: connect, receive one request,
   review the generated dossier, approve it, and verify the sent message.
7. Only after that test, switch site access from private to public so customers
   reach the WorkOS login instead of the Sites access gate.

Gmail push notifications are the primary trigger. A scheduled recovery job may
repair missed history, but must not run a full AI workflow every five minutes.
