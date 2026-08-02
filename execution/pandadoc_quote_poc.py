"""Create PandaDoc-ready solar quote documents.

Default mode is a dry-run that generates an RTF document and PandaDoc
request payload locally. Live API calls require PANDADOC_API_KEY and an
explicit --live-create flag.
"""

from __future__ import annotations

import argparse
import json
import os
import time
import uuid
import zipfile
from dataclasses import dataclass
from html import escape as xml_escape
from pathlib import Path
from typing import Any
from urllib import request
from urllib.error import HTTPError


REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = REPO_ROOT / ".tmp" / "pandadoc_quote_poc"
DEFAULT_BASE_URL = "https://api.pandadoc.com/public/v1"


@dataclass
class PandaDocResult:
    document_id: str | None
    status: str | None
    response: dict[str, Any]


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def rtf_escape(value: Any) -> str:
    text = "" if value is None else str(value)
    return (
        text.replace("\\", "\\\\")
        .replace("{", "\\{")
        .replace("}", "\\}")
        .replace("\n", "\\line ")
    )


def euro(value: float | int | None) -> str:
    if value is None:
        return "n.t.b."
    return f"EUR {float(value):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def build_quote_rtf(analysis: dict[str, Any], recipient_name: str) -> str:
    fields = analysis.get("fields", {})
    estimate = analysis.get("estimate") or {}
    quote_number = f"POC-{uuid.uuid4().hex[:8].upper()}"
    lines = [
        r"{\rtf1\ansi\deff0",
        r"{\fonttbl{\f0 Arial;}}",
        r"\fs22",
        r"\b First Client BV - Voorlopige offerte zonnepanelen\b0\par",
        r"\par",
        rf"Offertenummer: {rtf_escape(quote_number)}\par",
        rf"Klant: {rtf_escape(recipient_name or fields.get('contact_name'))}\par",
        rf"Adres: {rtf_escape(fields.get('installation_address'))}\par",
        rf"Type pand: {rtf_escape(fields.get('property_type'))}\par",
        rf"Woning ouder dan 10 jaar: {rtf_escape(fields.get('home_older_than_10_years') or 'onbekend')}\par",
        rf"Energiebasis: {rtf_escape(fields.get('energy_usage'))}\par",
        rf"Dak/montage: {rtf_escape(fields.get('roof_or_mount'))}\par",
        rf"Thuisbatterij: {rtf_escape(fields.get('battery_backup'))}\par",
        rf"Timing: {rtf_escape(fields.get('timeline'))}\par",
        r"\par",
        r"\b Raming\b0\par",
        rf"Aanbevolen systeemgrootte: {rtf_escape(estimate.get('system_size_kw'))} kW\par",
        rf"Zonnepanelen/installatie: {rtf_escape(euro(estimate.get('solar_cost_usd')))}\par",
        rf"Thuisbatterij: {rtf_escape(euro(estimate.get('battery_cost_usd')))}\par",
        rf"Contingentie: {rtf_escape(euro(estimate.get('contingency_usd')))}\par",
        rf"Totaal indicatief: {rtf_escape(euro(estimate.get('estimated_total_usd')))}\par",
        r"\par",
        r"Deze offerte is voorlopig en moet intern worden gecontroleerd voordat ze naar de klant gaat.\par",
        r"\par",
        r"\b Akkoord klant\b0\par",
        r"Naam: [t:client:name________________]\par",
        r"Datum: [d:client:date________]\par",
        r"Handtekening: [s:client:sig________________]\par",
        r"}",
    ]
    return "\n".join(lines)


def build_quote_lines(analysis: dict[str, Any], recipient_name: str) -> list[str]:
    fields = analysis.get("fields", {})
    estimate = analysis.get("estimate") or {}
    quote_number = f"POC-{uuid.uuid4().hex[:8].upper()}"
    return [
        "First Client BV - Voorlopige offerte zonnepanelen",
        "",
        f"Offertenummer: {quote_number}",
        f"Klant: {recipient_name or fields.get('contact_name')}",
        f"Adres: {fields.get('installation_address')}",
        f"Type pand: {fields.get('property_type')}",
        f"Woning ouder dan 10 jaar: {fields.get('home_older_than_10_years') or 'onbekend'}",
        f"Energiebasis: {fields.get('energy_usage')}",
        f"Dak/montage: {fields.get('roof_or_mount')}",
        f"Thuisbatterij: {fields.get('battery_backup')}",
        f"Timing: {fields.get('timeline')}",
        "",
        "Raming",
        f"Aanbevolen systeemgrootte: {estimate.get('system_size_kw')} kW",
        f"Zonnepanelen/installatie: {euro(estimate.get('solar_cost_usd'))}",
        f"Thuisbatterij: {euro(estimate.get('battery_cost_usd'))}",
        f"Contingentie: {euro(estimate.get('contingency_usd'))}",
        f"Totaal indicatief: {euro(estimate.get('estimated_total_usd'))}",
        "",
        "Deze offerte is voorlopig en moet intern worden gecontroleerd voordat ze naar de klant gaat.",
        "",
        "Akkoord klant",
        "Naam: [t:client:name________________]",
        "Datum: [d:client:date________]",
        "Handtekening: [s:client:sig________________]",
    ]


def write_quote_docx(path: Path, lines: list[str]) -> None:
    paragraphs = "\n".join(
        f"<w:p><w:r><w:t xml:space=\"preserve\">{xml_escape(line)}</w:t></w:r></w:p>"
        for line in lines
    )
    document_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    {paragraphs}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>
"""
    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
"""
    rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
"""
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as docx:
        docx.writestr("[Content_Types].xml", content_types)
        docx.writestr("_rels/.rels", rels)
        docx.writestr("word/document.xml", document_xml)


def build_pandadoc_data(document_name: str, recipient_email: str, recipient_name: str) -> dict[str, Any]:
    first_name, _, last_name = recipient_name.partition(" ")
    return {
        "name": document_name,
        "recipients": [
            {
                "email": recipient_email,
                "first_name": first_name or recipient_name,
                "last_name": last_name,
                "role": "client",
            }
        ],
        "fields": {
            "name": {"value": recipient_name, "role": "client"},
            "date": {"value": "", "role": "client"},
            "sig": {"value": "", "role": "client"},
        },
        "tags": ["solar-poc", "first-client"],
        "metadata": {"source": "Orelix Office Offerte Assistent"},
    }


def build_template_data(document_name: str, recipient_email: str, recipient_name: str, template_id: str, analysis: dict[str, Any]) -> dict[str, Any]:
    first_name, _, last_name = recipient_name.partition(" ")
    fields = analysis.get("fields", {})
    estimate = analysis.get("estimate") or {}
    tokens = [
        {"name": "client.name", "value": recipient_name},
        {"name": "client.email", "value": recipient_email},
        {"name": "client.address", "value": fields.get("installation_address") or ""},
        {"name": "quote.system_size_kw", "value": str(estimate.get("system_size_kw") or "")},
        {"name": "quote.solar_cost", "value": euro(estimate.get("solar_cost_usd"))},
        {"name": "quote.battery_cost", "value": euro(estimate.get("battery_cost_usd"))},
        {"name": "quote.total", "value": euro(estimate.get("estimated_total_usd"))},
        {"name": "project.property_type", "value": fields.get("property_type") or ""},
        {"name": "project.roof_or_mount", "value": fields.get("roof_or_mount") or ""},
        {"name": "project.battery_backup", "value": fields.get("battery_backup") or ""},
        {"name": "project.timeline", "value": fields.get("timeline") or ""},
    ]
    return {
        "name": document_name,
        "template_uuid": template_id,
        "recipients": [
            {
                "email": recipient_email,
                "first_name": first_name or recipient_name,
                "last_name": last_name,
                "role": "client",
            }
        ],
        "tokens": tokens,
        "tags": ["solar-poc", "first-client"],
        "metadata": {"source": "Orelix Office Offerte Assistent", "mode": "template"},
    }


def api_request(method: str, url: str, api_key: str, body: bytes | None = None, content_type: str | None = None) -> dict[str, Any]:
    headers = {
        "Authorization": f"API-Key {api_key}",
        "Accept": "application/json",
    }
    if content_type:
        headers["Content-Type"] = content_type
    req = request.Request(url, data=body, headers=headers, method=method)
    try:
        with request.urlopen(req, timeout=60) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"PandaDoc API error {exc.code}: {detail}") from exc


def multipart_body(file_path: Path, data: dict[str, Any]) -> tuple[bytes, str]:
    boundary = f"----pandadoc-poc-{uuid.uuid4().hex}"
    file_bytes = file_path.read_bytes()
    content_type_for_file = {
        ".rtf": "application/rtf",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".pdf": "application/pdf",
    }.get(file_path.suffix.lower(), "application/octet-stream")
    parts = [
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="data"\r\n'
        "Content-Type: application/json\r\n\r\n"
        f"{json.dumps(data)}\r\n",
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{file_path.name}"\r\n'
        f"Content-Type: {content_type_for_file}\r\n\r\n",
    ]
    body = "".join(parts).encode("utf-8") + file_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")
    return body, f"multipart/form-data; boundary={boundary}"


def create_document(api_key: str, base_url: str, file_path: Path, data: dict[str, Any]) -> PandaDocResult:
    body, content_type = multipart_body(file_path, data)
    response = api_request("POST", f"{base_url}/documents?upload", api_key, body, content_type)
    document_id = response.get("id") or response.get("uuid")
    return PandaDocResult(document_id=document_id, status=response.get("status"), response=response)


def create_document_from_template(api_key: str, base_url: str, data: dict[str, Any]) -> PandaDocResult:
    body = json.dumps(data).encode("utf-8")
    response = api_request("POST", f"{base_url}/documents", api_key, body, "application/json")
    document_id = response.get("id") or response.get("uuid")
    return PandaDocResult(document_id=document_id, status=response.get("status"), response=response)


def wait_for_draft(api_key: str, base_url: str, document_id: str, timeout_seconds: int) -> str:
    deadline = time.time() + timeout_seconds
    last_status = "unknown"
    while time.time() < deadline:
        response = api_request("GET", f"{base_url}/documents/{document_id}", api_key)
        last_status = response.get("status") or response.get("state") or "unknown"
        if last_status == "document.draft":
            return last_status
        time.sleep(3)
    raise TimeoutError(f"Document {document_id} did not reach document.draft. Last status: {last_status}")


def send_document(api_key: str, base_url: str, document_id: str, silent: bool) -> dict[str, Any]:
    body = json.dumps({"silent": silent}).encode("utf-8")
    return api_request("POST", f"{base_url}/documents/{document_id}/send", api_key, body, "application/json")


def create_session(api_key: str, base_url: str, document_id: str, recipient_email: str, lifetime: int) -> dict[str, Any]:
    body = json.dumps({"recipient": recipient_email, "lifetime": lifetime}).encode("utf-8")
    return api_request("POST", f"{base_url}/documents/{document_id}/session", api_key, body, "application/json")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="PandaDoc solar quote signing POC")
    parser.add_argument("--analysis-file", type=Path, required=True)
    parser.add_argument("--recipient-email", required=True)
    parser.add_argument("--recipient-name", required=True)
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR)
    parser.add_argument("--live-create", action="store_true", help="Actually create the PandaDoc document")
    parser.add_argument("--template-id", help="PandaDoc template UUID. Preferred for reliable signing fields.")
    parser.add_argument("--send", action="store_true", help="Send via PandaDoc after draft status")
    parser.add_argument("--silent-send", action="store_true", help="Send silently, useful before embedded session creation")
    parser.add_argument("--create-session", action="store_true", help="Create an embedded signing session after sending")
    parser.add_argument("--session-lifetime", type=int, default=90000)
    parser.add_argument("--wait-timeout", type=int, default=60)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    load_dotenv(REPO_ROOT / ".env")
    analysis = json.loads(args.analysis_file.read_text(encoding="utf-8"))
    if analysis.get("next_action") != "draft_quote_for_manual_review":
        raise SystemExit("Analysis is not ready for a quote document. Expected next_action=draft_quote_for_manual_review.")

    args.out_dir.mkdir(parents=True, exist_ok=True)
    safe_name = "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in args.recipient_name).strip("_")
    document_name = f"Solar quote - {args.recipient_name}"
    rtf_path = args.out_dir / f"{safe_name or 'customer'}_solar_quote.rtf"
    docx_path = args.out_dir / f"{safe_name or 'customer'}_solar_quote.docx"
    data_path = args.out_dir / f"{safe_name or 'customer'}_pandadoc_payload.json"
    result_path = args.out_dir / f"{safe_name or 'customer'}_pandadoc_result.json"

    rtf_path.write_text(build_quote_rtf(analysis, args.recipient_name), encoding="utf-8")
    write_quote_docx(docx_path, build_quote_lines(analysis, args.recipient_name))
    data = (
        build_template_data(document_name, args.recipient_email, args.recipient_name, args.template_id, analysis)
        if args.template_id
        else build_pandadoc_data(document_name, args.recipient_email, args.recipient_name)
    )
    data_path.write_text(json.dumps(data, indent=2), encoding="utf-8")

    result: dict[str, Any] = {
        "mode": "dry-run",
        "rtf_path": str(rtf_path),
        "docx_path": str(docx_path),
        "payload_path": str(data_path),
        "document_name": document_name,
        "creation_mode": "template" if args.template_id else "upload",
        "recipient_email": args.recipient_email,
    }

    if args.live_create:
        api_key = os.environ.get("PANDADOC_API_KEY")
        if not api_key:
            raise SystemExit("PANDADOC_API_KEY is missing. Add it to .env or environment before --live-create.")
        base_url = os.environ.get("PANDADOC_BASE_URL", DEFAULT_BASE_URL).rstrip("/")
        created = (
            create_document_from_template(api_key, base_url, data)
            if args.template_id
            else create_document(api_key, base_url, docx_path, data)
        )
        if not created.document_id:
            raise SystemExit(f"PandaDoc create response did not include a document id: {created.response}")
        result.update({"mode": "live", "create_response": created.response, "document_id": created.document_id})
        status = wait_for_draft(api_key, base_url, created.document_id, args.wait_timeout)
        result["status"] = status
        if args.send or args.create_session:
            send_response = send_document(api_key, base_url, created.document_id, args.silent_send or args.create_session)
            result["send_response"] = send_response
        if args.create_session:
            session_response = create_session(api_key, base_url, created.document_id, args.recipient_email, args.session_lifetime)
            result["session_response"] = session_response

    result_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
