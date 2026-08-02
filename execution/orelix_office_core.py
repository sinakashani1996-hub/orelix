"""Shared workflow primitives for Orelix Office modules.

The local SQLite store is the deterministic source of truth for the POC. Gmail
labels may mirror state for operator convenience, but they are not used as the
only idempotency or audit mechanism.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Optional


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_STATE_DB = REPO_ROOT / ".tmp" / "orelix_office" / "workflow.db"

MODULE_QUOTE = "quote_assistant"
MODULE_INBOX = "inbox_assistant"
MODULE_SERVICE = "service_assistant"
MODULE_PLANNING = "planning_assistant"
MODULE_CRM = "crm_assistant"

CASE_STATES = {
    "new",
    "waiting_for_customer",
    "ready_for_review",
    "needs_human_review",
    "completed",
}
MESSAGE_STATES = {"processing", "processed", "failed"}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_identity(value: str) -> str:
    return " ".join(value.lower().strip().split())


def content_hash(content: str) -> str:
    normalized = "\n".join(line.rstrip() for line in content.strip().splitlines())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def build_project_key(sender: str, installation_address: Optional[str] = None) -> str:
    """Create a stable key without merging two known, different addresses."""

    identity = normalize_identity(sender)
    address = normalize_identity(installation_address or "address-unknown")
    digest = hashlib.sha256(f"{identity}|{address}".encode("utf-8")).hexdigest()[:20]
    return f"project_{digest}"


@dataclass(frozen=True)
class ApprovalPolicy:
    """Outbound permissions configured per customer/module.

    Safe platform defaults create drafts only. Enabling automatic information
    requests is an explicit tenant decision. Quotes always require approval.
    """

    auto_send_information_requests: bool = False
    auto_send_quotes: bool = False
    max_automatic_information_requests: int = 0

    def __post_init__(self) -> None:
        if self.auto_send_quotes:
            raise ValueError("Orelix Office never permits automatic quote sending")
        if self.max_automatic_information_requests < 0:
            raise ValueError("max_automatic_information_requests cannot be negative")

    def action_for(self, artifact_type: str, automatic_requests_sent: int = 0) -> str:
        if artifact_type == "quote":
            return "create_draft_for_approval"
        if artifact_type != "information_request":
            return "manual_review"
        allowed = (
            self.auto_send_information_requests
            and automatic_requests_sent < self.max_automatic_information_requests
        )
        return "send_automatically" if allowed else "create_draft_for_approval"


class WorkflowStore:
    """Small durable workflow and audit store used by every module."""

    def __init__(self, path: Path = DEFAULT_STATE_DB) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self.connection() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS cases (
                    case_id TEXT PRIMARY KEY,
                    module TEXT NOT NULL,
                    project_key TEXT NOT NULL,
                    sender TEXT NOT NULL,
                    state TEXT NOT NULL,
                    automatic_requests_sent INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(module, project_key)
                );

                CREATE TABLE IF NOT EXISTS messages (
                    message_id TEXT PRIMARY KEY,
                    case_id TEXT NOT NULL,
                    module TEXT NOT NULL,
                    sender TEXT NOT NULL,
                    content_hash TEXT NOT NULL,
                    state TEXT NOT NULL,
                    error TEXT,
                    received_at TEXT NOT NULL,
                    processed_at TEXT,
                    FOREIGN KEY(case_id) REFERENCES cases(case_id)
                );

                CREATE TABLE IF NOT EXISTS events (
                    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    case_id TEXT NOT NULL,
                    message_id TEXT,
                    event_type TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(case_id) REFERENCES cases(case_id)
                );

                CREATE INDEX IF NOT EXISTS idx_cases_sender
                    ON cases(module, sender);
                CREATE INDEX IF NOT EXISTS idx_events_case
                    ON events(case_id, created_at);
                """
            )

    def get_or_create_case(
        self,
        module: str,
        sender: str,
        project_key: str,
    ) -> dict[str, Any]:
        now = utc_now()
        with self.connection() as connection:
            existing = connection.execute(
                "SELECT * FROM cases WHERE module = ? AND project_key = ?",
                (module, project_key),
            ).fetchone()
            if existing:
                return dict(existing)

            case_id = f"case_{uuid.uuid4().hex}"
            connection.execute(
                """
                INSERT INTO cases (
                    case_id, module, project_key, sender, state,
                    automatic_requests_sent, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'new', 0, ?, ?)
                """,
                (case_id, module, project_key, sender, now, now),
            )
            return dict(
                connection.execute(
                    "SELECT * FROM cases WHERE case_id = ?", (case_id,)
                ).fetchone()
            )

    def claim_message(
        self,
        message_id: str,
        case_id: str,
        module: str,
        sender: str,
        content: str,
    ) -> bool:
        """Atomically claim a provider message; false means it was seen before."""

        with self.connection() as connection:
            cursor = connection.execute(
                """
                INSERT OR IGNORE INTO messages (
                    message_id, case_id, module, sender, content_hash,
                    state, received_at
                ) VALUES (?, ?, ?, ?, ?, 'processing', ?)
                """,
                (
                    message_id,
                    case_id,
                    module,
                    sender,
                    content_hash(content),
                    utc_now(),
                ),
            )
            if cursor.rowcount == 1:
                return True
            retry = connection.execute(
                """
                UPDATE messages
                SET state = 'processing', error = NULL, processed_at = NULL,
                    content_hash = ?, received_at = ?
                WHERE message_id = ? AND state = 'failed'
                """,
                (content_hash(content), utc_now(), message_id),
            )
            return retry.rowcount == 1

    def complete_message(
        self,
        message_id: str,
        case_state: str,
        event_type: str,
        payload: dict[str, Any],
    ) -> None:
        if case_state not in CASE_STATES:
            raise ValueError(f"Unsupported case state: {case_state}")
        now = utc_now()
        with self.connection() as connection:
            message = connection.execute(
                "SELECT case_id FROM messages WHERE message_id = ?", (message_id,)
            ).fetchone()
            if not message:
                raise ValueError(f"Message was not claimed: {message_id}")
            case_id = message["case_id"]
            connection.execute(
                """
                UPDATE messages
                SET state = 'processed', processed_at = ?, error = NULL
                WHERE message_id = ?
                """,
                (now, message_id),
            )
            connection.execute(
                "UPDATE cases SET state = ?, updated_at = ? WHERE case_id = ?",
                (case_state, now, case_id),
            )
            connection.execute(
                """
                INSERT INTO events (
                    case_id, message_id, event_type, payload_json, created_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (case_id, message_id, event_type, json.dumps(payload), now),
            )

    def fail_message(self, message_id: str, error: str) -> None:
        with self.connection() as connection:
            connection.execute(
                """
                UPDATE messages
                SET state = 'failed', processed_at = ?, error = ?
                WHERE message_id = ?
                """,
                (utc_now(), error[:2000], message_id),
            )

    def increment_automatic_requests(self, case_id: str) -> None:
        with self.connection() as connection:
            connection.execute(
                """
                UPDATE cases
                SET automatic_requests_sent = automatic_requests_sent + 1,
                    updated_at = ?
                WHERE case_id = ?
                """,
                (utc_now(), case_id),
            )

    def get_case(self, case_id: str) -> Optional[dict[str, Any]]:
        with self.connection() as connection:
            row = connection.execute(
                "SELECT * FROM cases WHERE case_id = ?", (case_id,)
            ).fetchone()
            return dict(row) if row else None

    def list_events(self, case_id: str) -> list[dict[str, Any]]:
        with self.connection() as connection:
            rows = connection.execute(
                "SELECT * FROM events WHERE case_id = ? ORDER BY event_id",
                (case_id,),
            ).fetchall()
            return [dict(row) for row in rows]


def policy_as_dict(policy: ApprovalPolicy) -> dict[str, Any]:
    return asdict(policy)
