# PandaDoc Quote Signing POC

## Goal

Turn an approved solar quote draft into a PandaDoc document that the customer can review and sign online.

The POC supports:

- Generating a local RTF quote document with a PandaDoc signature field tag.
- Creating a PandaDoc document from the generated file.
- Creating a PandaDoc document from a PandaDoc template. This is preferred for reliable signing fields.
- Waiting until the document reaches `document.draft`.
- Optionally sending it through PandaDoc or creating an embedded signing session.

## Inputs

- Solar quote analysis JSON from `execution/solar_quote_poc.py`.
- Customer email address.
- Customer name.
- PandaDoc API key in `.env`.

## Execution Tool

Use `execution/pandadoc_quote_poc.py`.

Dry-run example:

```powershell
python execution/pandadoc_quote_poc.py --analysis-file .tmp/solar_quote_poc/quote_request_complete/analysis.json --recipient-email test@example.com --recipient-name "Alex Johnson"
```

Live create example:

```powershell
python execution/pandadoc_quote_poc.py --analysis-file .tmp/solar_quote_poc/quote_request_complete/analysis.json --recipient-email customer@example.com --recipient-name "Alex Johnson" --live-create
```

Preferred live create from template:

```powershell
python execution/pandadoc_quote_poc.py --analysis-file .tmp/solar_quote_poc/quote_request_complete/analysis.json --recipient-email customer@example.com --recipient-name "Alex Johnson" --template-id YOUR_TEMPLATE_UUID --live-create
```

Live create and send via PandaDoc:

```powershell
python execution/pandadoc_quote_poc.py --analysis-file .tmp/solar_quote_poc/quote_request_complete/analysis.json --recipient-email customer@example.com --recipient-name "Alex Johnson" --live-create --send
```

## PandaDoc Notes

- Authentication uses `Authorization: API-Key <key>`.
- Reliable signing requires a PandaDoc template with recipient role `client` and at least one signature field assigned to that role.
- For uploaded files, use `POST /documents?upload` with multipart form data containing:
  - `file`: PDF, DOCX, or RTF file.
  - `data`: JSON metadata, recipients, fields, and tags.
- Document creation is asynchronous. Poll `GET /documents/{id}` until the status is `document.draft`.
- Only documents in `document.draft` can be sent.
- Sandbox keys are for testing and may watermark documents or limit recipient domains.
- Upload-mode field tags may not be recognized in every sandbox/workspace. If recipients come back as `CC`, use template mode.

## Safety

- Do not send a PandaDoc document automatically unless the operator passes `--send`.
- Do not use PandaDoc production keys for testing.
- Quotes remain manual-review artifacts until explicitly sent.
- Keep generated files in `.tmp/pandadoc_quote_poc/`.

## Sources

- PandaDoc API authentication: https://developers.pandadoc.com/reference/api-key-authentication-process
- Create document from file upload: https://developers.pandadoc.com/reference/create-document-from-upload
- Send document: https://developers.pandadoc.com/docs/send-document
- Embedded signing: https://developers.pandadoc.com/docs/embedded-signing
