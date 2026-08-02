# Orelix Office SaaS

Private alpha and customer-pilot surface for Orelix Office.

The application contains:

- WorkOS AuthKit-ready customer login.
- Organization-scoped workspaces and roles.
- Gmail OAuth with encrypted refresh-token storage.
- Gmail push-notification ingestion and provider-message deduplication.
- Organization-scoped work items and explicit approval before sending.
- D1-backed workflow and audit data.

Copy `.env.example` to `.env.local` for local integration testing. Hosted values
must be configured through Sites and never committed.

## Local development

```bash
npm install
npm run dev
npm run test
```

The production build targets the Sites Cloudflare Worker runtime through
vinext. Logical D1 bindings live in `.openai/hosting.json`.
