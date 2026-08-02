"""POC email triage and draft quote generator for a solar company."""

from __future__ import annotations

import argparse
import json
import math
import re
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path
from typing import Optional

try:
    from execution.orelix_office_core import (
        DEFAULT_STATE_DB,
        MODULE_INBOX,
        MODULE_QUOTE,
        MODULE_SERVICE,
        ApprovalPolicy,
        WorkflowStore,
        build_project_key,
        policy_as_dict,
    )
except ModuleNotFoundError:
    from orelix_office_core import (
        DEFAULT_STATE_DB,
        MODULE_INBOX,
        MODULE_QUOTE,
        MODULE_SERVICE,
        ApprovalPolicy,
        WorkflowStore,
        build_project_key,
        policy_as_dict,
    )


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT_DIR = REPO_ROOT / ".tmp" / "solar_quote_poc"

QUOTE_TERMS = ("quote", "estimate", "pricing", "price", "cost", "bid", "proposal")
NL_QUOTE_TERMS = ("offerte", "prijsofferte", "prijs", "kosten", "raming")
SOLAR_TERMS = (
    "solar",
    "panel",
    "pv",
    "photovoltaic",
    "battery",
    "inverter",
    "roof",
    "zonnepanelen",
    "zonenpanelen",
    "zonnepanele",
    "zonnepaneel",
    "zonne-energie",
    "thuisbatterij",
    "batterij",
    "omvormer",
    "dak",
)
NL_LANGUAGE_MARKERS = (
    "beste",
    "hartelijk dank",
    "uw",
    "woning",
    "offerte",
    "prijsofferte",
    "zonnepanelen",
    "thuisbatterij",
    "met vriendelijke groeten",
    "mvg",
)
QUOTE_INTENT_PHRASES = (
    "how much",
    "can you quote",
    "could you quote",
    "would like",
    "interested in",
    "price indication",
    "ik wil",
    "ik wens",
    "interesse in",
    "graag een",
    "kunt u",
    "kan u",
    "kunnen jullie",
    "prijsindicatie",
    "aanvraag",
)
INSTALLATION_TERMS = (
    "install",
    "purchase",
    "buy",
    "new system",
    "plaatsen",
    "installeren",
    "aanschaffen",
    "leggen",
    "nieuwe installatie",
)
SERVICE_TERMS = (
    "maintenance",
    "repair",
    "fault",
    "broken",
    "service",
    "onderhoud",
    "reparatie",
    "storing",
    "defect",
    "werkt niet",
)

REQUIRED_FIELDS = (
    "contact_name",
    "installation_address",
    "property_type",
    "energy_usage",
    "roof_or_mount",
    "battery_backup",
    "timeline",
)


@dataclass
class ExtractedFields:
    contact_name: Optional[str] = None
    installation_address: Optional[str] = None
    installation_address_status: Optional[str] = None
    property_type: Optional[str] = None
    home_older_than_10_years: Optional[str] = None
    energy_usage: Optional[str] = None
    desired_panel_count: Optional[int] = None
    monthly_bill_usd: Optional[float] = None
    annual_usage_kwh: Optional[float] = None
    roof_or_mount: Optional[str] = None
    battery_backup: Optional[str] = None
    timeline: Optional[str] = None


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def strip_quoted_history(text: str) -> str:
    """Remove common email quote blocks before routing or field extraction."""

    clean_lines: list[str] = []
    quote_header = re.compile(
        r"^\s*(?:on\s+.+\s+wrote:|op\s+.+\s+schreef:|from:\s+|van:\s+)",
        flags=re.IGNORECASE,
    )
    for line in text.splitlines():
        if quote_header.match(line):
            break
        if line.lstrip().startswith(">"):
            continue
        clean_lines.append(line)
    return "\n".join(clean_lines).strip()


def detect_language(text: str) -> str:
    lowered = text.lower()
    return "nl" if any(marker in lowered for marker in NL_LANGUAGE_MARKERS) else "en"


def is_quote_request(text: str) -> bool:
    lowered = text.lower()
    has_quote_intent = any(term in lowered for term in QUOTE_TERMS + NL_QUOTE_TERMS)
    has_solar_context = any(term in lowered for term in SOLAR_TERMS)
    has_purchase_intent = any(phrase in lowered for phrase in QUOTE_INTENT_PHRASES)
    has_installation_context = any(term in lowered for term in INSTALLATION_TERMS)
    service_only = any(term in lowered for term in SERVICE_TERMS) and not has_installation_context
    return has_solar_context and (has_quote_intent or has_purchase_intent) and not service_only


def suggested_module(text: str, quote_request: Optional[bool] = None) -> str:
    lowered = text.lower()
    if quote_request if quote_request is not None else is_quote_request(text):
        return MODULE_QUOTE
    if any(term in lowered for term in SERVICE_TERMS) and any(
        term in lowered for term in SOLAR_TERMS
    ):
        return MODULE_SERVICE
    return MODULE_INBOX


def extract_contact_name(text: str) -> Optional[str]:
    name_part = r"[^\W\d_][^\W\d_'-]*(?:['-][^\W\d_]+)?"
    full_name = rf"({name_part}(?:[ \t]+{name_part}){{0,3}})"
    patterns = [
        rf"(?:mijn naam is)\s+{full_name}",
        rf"(?:my name is)\s+{full_name}",
        rf"(?:thanks|thank you|regards|best),?\s*\n\s*{full_name}",
        rf"(?:met vriendelijke groeten|vriendelijke groeten|mvg|groetn|groeten|dankje),?\s*\n\s*{full_name}",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            candidate = match.group(1).strip()
            if candidate.lower() in {"groetn", "groeten", "dankje", "mvg", "vriendelijke groeten", "ja", "nee", "yes", "no", "pannendak", "plat dak"}:
                continue
            return candidate
    lines = [line.strip(" ,") for line in text.splitlines() if line.strip(" ,")]
    for candidate in reversed(lines[-5:]):
        lowered = candidate.lower()
        if lowered in {"groetn", "groeten", "dankje", "mvg", "vriendelijke groeten", "ja", "nee", "yes", "no", "pannendak", "plat dak"}:
            continue
        if "@" in candidate or candidate.startswith(">"):
            continue
        if re.fullmatch(full_name, candidate, flags=re.IGNORECASE):
            return candidate
    for candidate in lines[:3]:
        lowered = candidate.lower()
        if lowered in {"ja", "nee", "yes", "no", "pannendak", "plat dak", "rijhuis", "rijwoning"} or re.search(r"\d{4}", candidate):
            continue
        if re.fullmatch(full_name, candidate, flags=re.IGNORECASE):
            return candidate
    return None


def extract_address(text: str) -> tuple[Optional[str], Optional[str]]:
    english_pattern = (
        r"\b\d{1,6}\s+[A-Za-z0-9 .'-]+"
        r"\s+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|"
        r"boulevard|blvd|way|place|pl)\b(?:[^\n,]*)(?:,\s*[A-Za-z .'-]+)?"
        r"(?:,\s*[A-Z]{2})?(?:\s+\d{5})?"
    )
    candidates: list[tuple[str, str]] = []
    for match in re.finditer(english_pattern, text, flags=re.IGNORECASE):
        address = normalize(match.group(0))
        status = "complete" if re.search(r"\b\d{5}\b", address) else "partial"
        candidates.append((address, status))

    word = r"A-Za-zÀ-ÖØ-öø-ÿ"
    locality = rf"\d{{4}}\s+[{word}][{word} '-]*"
    street_name = rf"[{word}][{word} .'-]{{1,60}}?"
    street_suffix = r"(?:straat|laan|steenweg|baan|weg|lei|plein|dreef|kaai|markt)"
    belgian_patterns = (
        rf"\b(?:mijn\s+adres\s+is|adres(?:\s+is)?|installatieadres)\s+(?:de\s+)?"
        rf"({street_name}\s+\d{{1,5}}[A-Za-z]?(?:(?:,\s*|\s+){locality})?)",
        rf"\b(({street_name}{street_suffix})\s+\d{{1,5}}[A-Za-z]?"
        rf"(?:(?:,\s*|\s+){locality})?)",
        rf"\b({street_name}\s+\d{{1,5}}[A-Za-z]?\s*,\s*{locality})",
    )
    for pattern in belgian_patterns:
        for match in re.finditer(pattern, text, flags=re.IGNORECASE):
            address = normalize(match.group(1).rstrip(". ,"))
            address = re.sub(
                r"^.*?\b(?:mijn\s+adres\s+is|adres\s+is|installatieadres)\s+",
                "",
                address,
                flags=re.IGNORECASE,
            )
            address = re.sub(
                r"^(?:in\s+de|in|de)\s+",
                "",
                address,
                flags=re.IGNORECASE,
            )
            status = "complete" if re.search(rf"\b{locality}$", address, flags=re.IGNORECASE) else "partial"
            candidates.append((address, status))

    if not candidates:
        return None, None
    complete = [candidate for candidate in candidates if candidate[1] == "complete"]
    return complete[-1] if complete else candidates[-1]


def extract_property_type(text: str) -> Optional[str]:
    lowered = text.lower()
    if re.search(r"\b(commercial|warehouse|office|retail|business|bedrijfspand|kantoor|magazijn|winkel)\b", lowered):
        return "commercial"
    if re.search(r"\b(appartement|flat)\b", lowered):
        return "apartment"
    if re.search(r"\b(home|house|residential|single-family|single family|woning|huis|rijhuis|rijwoning|residentieel|particulier)\b", lowered):
        return "residential"
    if re.search(r"\b(farm|agricultural)\b", lowered):
        return "agricultural"
    return None


def extract_home_age(text: str) -> Optional[str]:
    lowered = text.lower()
    built_match = re.search(r"\b(?:gebouwd|bouwjaar)\D{0,20}((?:19|20)\d{2})\b", lowered)
    if built_match:
        built_year = int(built_match.group(1))
        return "yes" if date.today().year - built_year >= 10 else "no"
    if not re.search(r"(ouder dan|meer dan)\s+10\s+jaar", lowered):
        return None
    age_context = re.search(r"(ouder dan|meer dan)\s+10\s+jaar.{0,20}\b(ja|nee|neen|yes|no)\b", lowered)
    if age_context:
        return "yes" if age_context.group(2) in ("ja", "yes") else "no"
    return "unknown"


def parse_localized_number(raw: str) -> float:
    value = raw.replace(" ", "")
    if "." in value and "," in value:
        if value.rfind(",") > value.rfind("."):
            value = value.replace(".", "").replace(",", ".")
        else:
            value = value.replace(",", "")
    elif re.fullmatch(r"\d{1,3}(?:[.,]\d{3})+", value):
        value = value.replace(".", "").replace(",", "")
    else:
        value = value.replace(",", ".")
    return float(value)


def extract_energy_usage(text: str) -> tuple[Optional[str], Optional[int], Optional[float], Optional[float]]:
    kwh_match = re.search(r"([\d][\d., ]*)\s*(?:kwh|kw h)", text, flags=re.IGNORECASE)
    if kwh_match:
        usage = parse_localized_number(kwh_match.group(1))
        context = text[max(0, kwh_match.start() - 40) : kwh_match.end() + 40].lower()
        monthly_markers = ("per maand", "maandelijks", "monthly", "per month")
        annual_markers = ("per jaar", "jaarlijks", "jaarverbruik", "annual", "yearly", "per year")
        if any(marker in context for marker in monthly_markers):
            annual = usage * 12
        elif any(marker in context for marker in annual_markers):
            annual = usage
        else:
            annual = usage if usage >= 1000 else usage * 12
        return f"{usage:g} kWh mentioned", None, None, annual

    panel_match = re.search(r"\b(\d{1,3})\s*(?:zonnepanelen|zonenpanelen|zonnepanele|panelen|solar panels|panels)\b", text, flags=re.IGNORECASE)
    if panel_match:
        panel_count = int(panel_match.group(1))
        return f"{panel_count} zonnepanelen gewenst", panel_count, None, None

    bill_match = re.search(
        r"(?:electric(?:ity)?\s+bill|utility\s+bill|bill).*?\$?\s*([\d,]+(?:\.\d+)?)|"
        r"\$\s*([\d,]+(?:\.\d+)?).*?(?:electric(?:ity)?\s+bill|utility\s+bill|bill)",
        text,
        flags=re.IGNORECASE,
    )
    if bill_match:
        raw_value = bill_match.group(1) or bill_match.group(2)
        monthly_bill = float(raw_value.replace(",", ""))
        annual_kwh = (monthly_bill / 0.18) * 12
        return f"${monthly_bill:g} monthly electricity bill", None, monthly_bill, annual_kwh

    return None, None, None, None


def extract_roof_or_mount(text: str) -> Optional[str]:
    lowered = text.lower()
    # Ignore our own question template examples if old thread text is accidentally included.
    if "bijvoorbeeld pannendak" in lowered or "type dak" in lowered:
        return None
    if "ground mount" in lowered or "ground-mounted" in lowered or "grondopstelling" in lowered or "grond montage" in lowered:
        return "ground mount"
    for roof_type in ("pannendak", "plat dak", "leien", "golfplaten", "hellend dak"):
        if roof_type in lowered:
            return roof_type
    for roof_type in ("metal roof", "tile roof", "shingle roof", "flat roof"):
        if roof_type in lowered:
            return roof_type
    if "roof" in lowered:
        return "roof mount"
    return None


def extract_battery(text: str) -> Optional[str]:
    lowered = text.lower()
    if re.search(r"\bmet\b.{0,40}\b(thuisbatterij|batterij)\b.{0,40}\bzonder\b", lowered) or re.search(
        r"\bmet\b.{0,40}\bzonder\b.{0,40}\b(thuisbatterij|batterij)\b", lowered
    ) or re.search(
        r"\b(thuisbatterij|batterij)\b.{0,40}\bmet\b.{0,40}\bzonder\b", lowered
    ):
        return "both"
    if any(phrase in lowered for phrase in ("no battery", "without battery", "not need battery", "geen batterij", "zonder batterij", "geen thuisbatterij")):
        return "no"
    if re.search(r"\b(eventueel|misschien|mogelijk)\b.{0,40}\b(thuisbatterij|batterij)\b", lowered):
        return None
    if any(term in lowered for term in ("battery", "backup", "storage", "powerwall", "batterij", "thuisbatterij")):
        return "yes"
    return None


def extract_timeline(text: str) -> Optional[str]:
    patterns = [
        r"(?:timeline|install|installation|start|begin).*?\b(ASAP|as soon as possible|this month|next month|spring|summer|fall|winter|\d+\s*(?:weeks|months))\b",
        r"\b(ASAP|as soon as possible|within\s+\d+\s*(?:weeks|months)|next month|this month)\b",
        r"\b(zo snel mogelijk|deze maand|volgende maand|binnen\s+\d+\s*(?:weken|maanden))\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return normalize(match.group(1))
    return None


def extract_fields(text: str) -> ExtractedFields:
    address, address_status = extract_address(text)
    energy_usage, desired_panel_count, monthly_bill, annual_kwh = extract_energy_usage(text)
    return ExtractedFields(
        contact_name=extract_contact_name(text),
        installation_address=address,
        installation_address_status=address_status,
        property_type=extract_property_type(text),
        home_older_than_10_years=extract_home_age(text),
        energy_usage=energy_usage,
        desired_panel_count=desired_panel_count,
        monthly_bill_usd=monthly_bill,
        annual_usage_kwh=annual_kwh,
        roof_or_mount=extract_roof_or_mount(text),
        battery_backup=extract_battery(text),
        timeline=extract_timeline(text),
    )


def missing_fields(fields: ExtractedFields, language: str = "en") -> list[str]:
    values = asdict(fields)
    missing = [field for field in REQUIRED_FIELDS if not values.get(field)]
    if (
        language == "nl"
        and fields.property_type == "residential"
        and not fields.home_older_than_10_years
    ):
        missing.insert(3, "home_older_than_10_years")
    if fields.installation_address and fields.installation_address_status == "partial" and "installation_address" not in missing:
        missing.insert(0, "installation_address")
    return missing


def human_label(field: str) -> str:
    return {
        "contact_name": "your full name",
        "installation_address": "the full installation address, including city/postal code",
        "property_type": "whether this is residential, commercial, apartment, or another property type",
        "energy_usage": "your average monthly electricity bill, annual kWh usage, or desired panel count",
        "roof_or_mount": "your roof type or whether you prefer a ground mount",
        "battery_backup": "whether you want battery backup",
        "timeline": "your ideal installation timeline",
        "home_older_than_10_years": "whether the home is older than 10 years",
    }[field]


def dutch_label(field: str) -> str:
    return {
        "contact_name": "Uw volledige naam",
        "installation_address": "Het volledige installatieadres, inclusief postcode en gemeente",
        "property_type": "Het type pand, bijvoorbeeld woning, appartement of bedrijfspand",
        "energy_usage": "Uw jaarlijks elektriciteitsverbruik in kWh, of het aantal zonnepanelen dat u ongeveer wenst",
        "roof_or_mount": "Het type dak, bijvoorbeeld pannendak, plat dak, leien of golfplaten",
        "battery_backup": (
            "Wilt u bij de zonnepanelen ook een thuisbatterij? Kies gerust voor "
            "een voorstel met thuisbatterij, zonder thuisbatterij, of twee "
            "prijsvoorstellen zodat u beide opties kunt vergelijken"
        ),
        "timeline": "Wanneer u de installatie ongeveer zou willen laten uitvoeren",
        "home_older_than_10_years": "Of de woning ouder is dan 10 jaar",
    }[field]


def dutch_question_for_field(field: str, fields: ExtractedFields) -> str:
    if field == "installation_address" and fields.installation_address:
        return (
            f"We ontvingen al een gedeelte van het adres: {fields.installation_address}. "
            "Kunt u ook de postcode en gemeente doorgeven?"
        )
    return dutch_label(field)


def draft_missing_info_reply(fields: ExtractedFields, missing: list[str], language: str = "en") -> str:
    if language == "nl":
        greeting = f"Beste {fields.contact_name}," if fields.contact_name else "Beste,"
        question_fields = list(missing)
        if not fields.home_older_than_10_years and "home_older_than_10_years" not in question_fields:
            question_fields.insert(min(2, len(question_fields)), "home_older_than_10_years")
        labels = {field: dutch_question_for_field(field, fields) for field in missing}
        labels["home_older_than_10_years"] = "Of de woning ouder is dan 10 jaar"
        questions = "\n".join(f"- {labels[field]}" for field in question_fields)
        return (
            f"{greeting}\n\n"
            "Bedankt voor uw bijkomende informatie. We kunnen uw aanvraag verder bekijken, "
            "maar hebben nog enkele gegevens nodig om de offerte correct op te maken:\n\n"
            f"{questions}\n\n"
            "Zodra we deze informatie ontvangen hebben, kunnen we uw aanvraag verder verwerken "
            "en een passende offerte voorbereiden.\n\n"
            "Met vriendelijke groeten,\n"
            "First Client BV"
        )

    greeting = f"Hi {fields.contact_name}," if fields.contact_name else "Hi,"
    questions = "\n".join(f"- {human_label(field)}" for field in missing)
    return (
        f"{greeting}\n\n"
        "Thanks for the details. To prepare an accurate preliminary estimate, could you reply with:\n\n"
        f"{questions}\n\n"
        "Once we have those, our team can prepare a draft quote for review.\n\n"
        "Best,\n"
        "Solar Team"
    )


def estimate_quote(fields: ExtractedFields) -> dict[str, float]:
    if fields.desired_panel_count:
        system_kw = fields.desired_panel_count * 0.43
    else:
        annual_usage = fields.annual_usage_kwh or 9600.0
        system_kw = max(4.0, min(25.0, annual_usage / 1200.0))
    system_kw = math.ceil(system_kw * 10) / 10
    solar_cost = system_kw * 1000 * 2.75
    battery_cost = 11000.0 if fields.battery_backup in ("yes", "both") else 0.0
    subtotal = solar_cost + battery_cost
    contingency = subtotal * 0.10
    total = subtotal + contingency
    return {
        "system_size_kw": round(system_kw, 1),
        "solar_cost_usd": round(solar_cost, 2),
        "battery_cost_usd": round(battery_cost, 2),
        "contingency_usd": round(contingency, 2),
        "estimated_total_usd": round(total, 2),
    }


def draft_quote(fields: ExtractedFields, estimate: dict[str, float]) -> str:
    return (
        "PRELIMINARY INTERNAL DRAFT - MANUAL REVIEW REQUIRED\n\n"
        f"Client: {fields.contact_name}\n"
        f"Address: {fields.installation_address}\n"
        f"Address status: {fields.installation_address_status}\n"
        f"Property type: {fields.property_type}\n"
        f"Home older than 10 years: {fields.home_older_than_10_years or 'unknown'}\n"
        f"Energy basis: {fields.energy_usage}\n"
        f"Mounting: {fields.roof_or_mount}\n"
        f"Battery backup: {fields.battery_backup}\n"
        f"Timeline: {fields.timeline}\n\n"
        "Draft estimate:\n"
        f"- Recommended system size: {estimate['system_size_kw']} kW\n"
        f"- Solar system estimate: ${estimate['solar_cost_usd']:,.2f}\n"
        f"- Battery estimate: ${estimate['battery_cost_usd']:,.2f}\n"
        f"- Contingency: ${estimate['contingency_usd']:,.2f}\n"
        f"- Preliminary total: ${estimate['estimated_total_usd']:,.2f}\n\n"
        "Notes for reviewer:\n"
        "- Confirm roof type, roof condition, available roof area, shading, layout, and interconnection requirements.\n"
        "- Confirm incentives, permitting, taxes, financing, and site-specific labor before sending to client.\n"
    )


def run(
    email_text: str,
    out_dir: Path,
    approval_policy: Optional[ApprovalPolicy] = None,
) -> dict:
    approval_policy = approval_policy or ApprovalPolicy()
    email_text = strip_quoted_history(email_text)
    language = detect_language(email_text)
    quote_request = is_quote_request(email_text)
    routed_module = suggested_module(email_text, quote_request)
    fields = extract_fields(email_text)
    missing = missing_fields(fields, language) if quote_request else []
    next_action = "ignore_or_manual_review"
    outbound_action = "manual_review"
    estimate = None

    out_dir.mkdir(parents=True, exist_ok=True)
    for artifact in ("analysis.json", "draft_reply.txt", "draft_quote.txt"):
        path = out_dir / artifact
        if path.exists():
            path.unlink()

    if quote_request and missing:
        next_action = "draft_missing_info_reply"
        outbound_action = approval_policy.action_for("information_request")
        (out_dir / "draft_reply.txt").write_text(draft_missing_info_reply(fields, missing, language), encoding="utf-8")
    elif quote_request:
        next_action = "draft_quote_for_manual_review"
        outbound_action = approval_policy.action_for("quote")
        estimate = estimate_quote(fields)
        (out_dir / "draft_quote.txt").write_text(draft_quote(fields, estimate), encoding="utf-8")

    analysis = {
        "is_quote_request": quote_request,
        "suggested_module": routed_module,
        "language": language,
        "next_action": next_action,
        "outbound_action": outbound_action,
        "approval_policy": policy_as_dict(approval_policy),
        "fields": asdict(fields),
        "missing_fields": missing,
        "estimate": estimate,
    }
    (out_dir / "analysis.json").write_text(json.dumps(analysis, indent=2), encoding="utf-8")
    return analysis


def run_with_workflow(
    email_text: str,
    out_dir: Path,
    message_id: str,
    sender: str,
    state_db: Path = DEFAULT_STATE_DB,
    project_key: Optional[str] = None,
    approval_policy: Optional[ApprovalPolicy] = None,
) -> dict:
    """Analyze once and durably record the case transition and audit event."""

    policy = approval_policy or ApprovalPolicy()
    preliminary_fields = extract_fields(email_text)
    resolved_project_key = project_key or build_project_key(
        sender, preliminary_fields.installation_address or f"message:{message_id}"
    )
    store = WorkflowStore(state_db)
    case = store.get_or_create_case(MODULE_QUOTE, sender, resolved_project_key)
    if not store.claim_message(message_id, case["case_id"], MODULE_QUOTE, sender, email_text):
        return {
            "duplicate": True,
            "message_id": message_id,
            "case_id": case["case_id"],
            "project_key": resolved_project_key,
            "next_action": "skip_already_processed",
        }

    try:
        analysis = run(email_text, out_dir, policy)
        if analysis["next_action"] == "draft_missing_info_reply":
            case_state = "waiting_for_customer"
            event_type = "information_request_drafted"
        elif analysis["next_action"] == "draft_quote_for_manual_review":
            case_state = "ready_for_review"
            event_type = "quote_drafted"
        else:
            case_state = "needs_human_review"
            event_type = "message_routed"
        analysis.update(
            {
                "duplicate": False,
                "message_id": message_id,
                "case_id": case["case_id"],
                "project_key": resolved_project_key,
            }
        )
        store.complete_message(
            message_id,
            case_state=case_state,
            event_type=event_type,
            payload=analysis,
        )
        (out_dir / "analysis.json").write_text(
            json.dumps(analysis, indent=2), encoding="utf-8"
        )
        return analysis
    except Exception as exc:
        store.fail_message(message_id, str(exc))
        raise


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Solar quote email POC")
    parser.add_argument("--email-file", type=Path, help="Plain-text email file to analyze")
    parser.add_argument("--text", help="Email text to analyze")
    parser.add_argument("--out-dir", type=Path, help="Directory for generated artifacts")
    parser.add_argument("--message-id", help="Provider message id for durable idempotency")
    parser.add_argument("--sender", help="Sender identity used for case matching")
    parser.add_argument("--project-key", help="Explicit project key when already known")
    parser.add_argument("--state-db", type=Path, default=DEFAULT_STATE_DB)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.email_file:
        email_text = args.email_file.read_text(encoding="utf-8")
        default_run_name = args.email_file.stem
    elif args.text:
        email_text = args.text
        default_run_name = "manual_input"
    else:
        raise SystemExit("Provide --email-file or --text")

    out_dir = args.out_dir or DEFAULT_OUT_DIR / default_run_name
    if bool(args.message_id) != bool(args.sender):
        raise SystemExit("--message-id and --sender must be provided together")
    if args.message_id:
        analysis = run_with_workflow(
            email_text,
            out_dir,
            message_id=args.message_id,
            sender=args.sender,
            state_db=args.state_db,
            project_key=args.project_key,
        )
    else:
        analysis = run(email_text, out_dir)
    print(json.dumps(analysis, indent=2))
    print(f"\nArtifacts written to: {out_dir}")


if __name__ == "__main__":
    main()
