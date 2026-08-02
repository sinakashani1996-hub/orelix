import tempfile
import unittest
from pathlib import Path

from execution.orelix_office_core import (
    MODULE_QUOTE,
    ApprovalPolicy,
    WorkflowStore,
    build_project_key,
)
from execution.solar_quote_poc import run_with_workflow


class ApprovalPolicyTests(unittest.TestCase):
    def test_safe_defaults_always_create_drafts(self) -> None:
        policy = ApprovalPolicy()

        self.assertEqual(
            policy.action_for("information_request"), "create_draft_for_approval"
        )
        self.assertEqual(policy.action_for("quote"), "create_draft_for_approval")

    def test_automatic_information_requests_require_explicit_limit(self) -> None:
        policy = ApprovalPolicy(
            auto_send_information_requests=True,
            max_automatic_information_requests=1,
        )

        self.assertEqual(
            policy.action_for("information_request", 0), "send_automatically"
        )
        self.assertEqual(
            policy.action_for("information_request", 1),
            "create_draft_for_approval",
        )

    def test_automatic_quote_sending_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            ApprovalPolicy(auto_send_quotes=True)


class WorkflowStoreTests(unittest.TestCase):
    def test_message_claim_is_idempotent_and_audited(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = WorkflowStore(Path(tmp) / "state.db")
            project_key = build_project_key(
                "customer@example.com", "Meir 10, 2000 Antwerpen"
            )
            case = store.get_or_create_case(
                MODULE_QUOTE, "customer@example.com", project_key
            )

            self.assertTrue(
                store.claim_message(
                    "gmail-123",
                    case["case_id"],
                    MODULE_QUOTE,
                    "customer@example.com",
                    "Graag een offerte",
                )
            )
            self.assertFalse(
                store.claim_message(
                    "gmail-123",
                    case["case_id"],
                    MODULE_QUOTE,
                    "customer@example.com",
                    "Graag een offerte",
                )
            )
            store.complete_message(
                "gmail-123",
                "ready_for_review",
                "quote_drafted",
                {"result": "ok"},
            )

            self.assertEqual(store.get_case(case["case_id"])["state"], "ready_for_review")
            self.assertEqual(store.list_events(case["case_id"])[0]["event_type"], "quote_drafted")

    def test_workflow_skips_same_provider_message_on_second_run(self) -> None:
        email = (
            "Beste, ik wil zonnepanelen voor mijn woning en ontvang graag een "
            "offerte. Groeten, Jan"
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            first = run_with_workflow(
                email,
                root / "artifacts",
                message_id="gmail-456",
                sender="jan@example.com",
                state_db=root / "state.db",
            )
            second = run_with_workflow(
                email,
                root / "artifacts",
                message_id="gmail-456",
                sender="jan@example.com",
                state_db=root / "state.db",
            )

        self.assertFalse(first["duplicate"])
        self.assertTrue(second["duplicate"])
        self.assertEqual(second["next_action"], "skip_already_processed")

    def test_failed_message_can_be_claimed_for_retry(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = WorkflowStore(Path(tmp) / "state.db")
            case = store.get_or_create_case(
                MODULE_QUOTE, "customer@example.com", "project-retry"
            )
            self.assertTrue(
                store.claim_message(
                    "gmail-retry",
                    case["case_id"],
                    MODULE_QUOTE,
                    "customer@example.com",
                    "Graag een offerte",
                )
            )
            store.fail_message("gmail-retry", "temporary failure")

            self.assertTrue(
                store.claim_message(
                    "gmail-retry",
                    case["case_id"],
                    MODULE_QUOTE,
                    "customer@example.com",
                    "Graag een offerte",
                )
            )


if __name__ == "__main__":
    unittest.main()
