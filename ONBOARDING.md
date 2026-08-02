# Orelix Office — onboarding

This guide is the single starting point for contributors.

## What is live?

`web/` is the active SaaS product. It contains the dashboard, login,
Gmail connection, inbound-email processing, approval flow and quote builder.

The root-level `execution/` scripts are useful Python prototypes. They are not
the hosted product; do not change them when you mean to change the website.

## Day-to-day development

```powershell
cd web
npm install
npm run dev
```

Run the application tests before sharing changes:

```powershell
cd web
npm test
```

## Where to find things

| Need | Location |
| --- | --- |
| Dashboard UI | `web/app/Dashboard.tsx` |
| Login and workspace context | `web/app/auth/`, `web/lib/auth.ts`, `web/lib/context.ts` |
| Gmail OAuth and inbound mail | `web/app/api/integrations/gmail/`, `web/app/api/webhooks/gmail/`, `web/lib/gmail*.ts` |
| AI drafts and quote logic | `web/lib/ai-assistant.ts`, `web/lib/quote-*.ts` |
| Database schema and migrations | `web/db/`, `web/drizzle/` |
| Cloudflare Gmail relay | `web/gmail-relay/` |
| Configuration variables | `web/.env.example` (never commit real values) |

## Files you can ignore

Do not open, edit or share these unless you are debugging the build:

- `.tmp/` — local experiments, old exports and generated test files.
- `web/node_modules/` — downloaded packages; recreate with `npm install`.
- `web/dist/`, `web/.vinext/`, `web/.wrangler/` — generated build and deploy files.
- `.env`, `.env.local`, `credentials.json`, `token.json` — private credentials.

## Working together

1. Pull the latest Git changes.
2. Work from `web/` for product changes.
3. Keep changes small and test them with `npm test`.
4. Never send a `.env` file, API key, OAuth JSON file or `node_modules` folder.

## Useful documentation

- [Web application notes](web/README.md)
- [Product/platform directive](directives/orelix_office_platform.md)
- [Python execution tools](execution/README.md)
