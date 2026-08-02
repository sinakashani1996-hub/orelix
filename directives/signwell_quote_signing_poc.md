# SignWell Quote Signing POC

Use `execution/signwell_quote_poc.py` after the solar analyzer has produced `next_action=draft_quote_for_manual_review`.

The tool creates a Dutch quote document with signature text tags. It defaults to a local dry-run and keeps quotes as drafts. `--live-create` creates a production SignWell document by default; `--send` is required to create a signing request. Use `--test-mode` only when an explicit test is intended.

Required `.env` values:

```text
SIGNWELL_API_KEY=
SIGNWELL_BASE_URL=https://www.signwell.com/api/v1
```

Dry run:

```powershell
python execution/signwell_quote_poc.py --analysis-file .tmp/solar_quote_poc/quote_request_complete_nl/analysis.json --recipient-email test@example.com --recipient-name "Test Customer"
```

Live draft:

```powershell
python execution/signwell_quote_poc.py --analysis-file .tmp/solar_quote_poc/quote_request_complete_nl/analysis.json --recipient-email customer@example.com --recipient-name "Test Customer" --live-create
```

Live test signing request:

```powershell
python execution/signwell_quote_poc.py --analysis-file .tmp/solar_quote_poc/quote_request_complete_nl/analysis.json --recipient-email customer@example.com --recipient-name "Test Customer" --live-create --send
```

The API response may contain `embedded_signing_url`; the tool copies it to `signing_url` in the result file. Test mode requires the explicit `--test-mode` flag.

SignWell uses `X-Api-Key` authentication, supports Dutch recipient interactions, and supports test mode for non-billable development requests. API creation is rate-limited separately from ordinary requests, so this POC does not retry automatically.
