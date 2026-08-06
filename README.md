# Orelix Office

Orelix Office is a SaaS platform for teams that handle customer requests. It
starts with the Offerte Assistent and shares the same customer, dossier,
approval and audit foundation with future Inbox, Service, Planning and CRM
assistants.

## Start here

Read [ONBOARDING.md](ONBOARDING.md) first. It explains what is live, how to run
the app locally and the small number of places you normally need to touch.
[web/README.md](web/README.md) covers the web application in more detail.

## Repository map

| Folder | Purpose |
| --- | --- |
| `web/` | The live Orelix Office web application, Gmail integration and Cloudflare Worker relay. |
| `directives/` | Product and automation specifications. |
| `execution/` | Deterministic Python prototypes and their shared domain logic. |
| `.tmp/` | Regenerable local output. Never share or commit it. |

Secrets stay in local `.env` files and must never be committed or shared.
