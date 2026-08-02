import tempfile
import unittest
from pathlib import Path

from execution.orelix_office_core import MODULE_QUOTE, MODULE_SERVICE
from execution.solar_quote_poc import run


ROOT = Path(__file__).resolve().parents[1]


class SolarQuotePocTests(unittest.TestCase):
    def run_sample(self, name: str) -> dict:
        email = (ROOT / "samples" / name).read_text(encoding="utf-8")
        with tempfile.TemporaryDirectory() as tmp:
            return run(email, Path(tmp))

    def test_complete_quote_request_creates_draft_quote(self) -> None:
        analysis = self.run_sample("quote_request_complete.txt")

        self.assertTrue(analysis["is_quote_request"])
        self.assertEqual(analysis["next_action"], "draft_quote_for_manual_review")
        self.assertEqual(analysis["fields"]["contact_name"], "Alex Johnson")
        self.assertEqual(analysis["missing_fields"], [])
        self.assertGreater(analysis["estimate"]["estimated_total_usd"], 0)

    def test_missing_info_request_creates_question_reply(self) -> None:
        analysis = self.run_sample("quote_request_missing_info.txt")

        self.assertTrue(analysis["is_quote_request"])
        self.assertEqual(analysis["next_action"], "draft_missing_info_reply")
        self.assertEqual(analysis["fields"]["contact_name"], "Maria")
        self.assertIn("installation_address", analysis["missing_fields"])

    def test_non_quote_email_is_manual_review_or_ignore(self) -> None:
        analysis = self.run_sample("not_a_quote_request.txt")

        self.assertFalse(analysis["is_quote_request"])
        self.assertEqual(analysis["next_action"], "ignore_or_manual_review")

    def test_dutch_missing_info_request_creates_dutch_reply(self) -> None:
        email = (ROOT / "samples" / "quote_request_missing_info_nl.txt").read_text(encoding="utf-8")
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            analysis = run(email, out_dir)
            draft = (out_dir / "draft_reply.txt").read_text(encoding="utf-8")

        self.assertTrue(analysis["is_quote_request"])
        self.assertEqual(analysis["language"], "nl")
        self.assertEqual(analysis["next_action"], "draft_missing_info_reply")
        self.assertIn("volledige installatieadres", draft)
        self.assertIn("bedrijfspand", draft)
        self.assertIn("woning ouder is dan 10 jaar", draft)
        self.assertIn("thuisbatterij", draft)

    def test_dutch_complete_quote_request_creates_draft_quote(self) -> None:
        analysis = self.run_sample("quote_request_complete_nl.txt")

        self.assertTrue(analysis["is_quote_request"])
        self.assertEqual(analysis["language"], "nl")
        self.assertEqual(analysis["next_action"], "draft_quote_for_manual_review")
        self.assertEqual(analysis["fields"]["contact_name"], "Sina Kashani")
        self.assertEqual(analysis["fields"]["installation_address"], "Kerkstraat 12, 2000 Antwerpen")
        self.assertEqual(analysis["fields"]["roof_or_mount"], "pannendak")
        self.assertEqual(analysis["missing_fields"], [])

    def test_dutch_partial_reply_only_asks_for_truly_missing_fields(self) -> None:
        email = (ROOT / "samples" / "reply_partial_info_nl.txt").read_text(encoding="utf-8")
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            analysis = run(email, out_dir)
            draft = (out_dir / "draft_reply.txt").read_text(encoding="utf-8")

        self.assertTrue(analysis["is_quote_request"])
        self.assertEqual(analysis["fields"]["contact_name"], "Tommy")
        self.assertEqual(analysis["fields"]["installation_address"], "oude mechelsebaan 2")
        self.assertEqual(analysis["fields"]["installation_address_status"], "partial")
        self.assertEqual(analysis["fields"]["property_type"], "apartment")
        self.assertEqual(analysis["fields"]["home_older_than_10_years"], "yes")
        self.assertEqual(analysis["fields"]["desired_panel_count"], 27)
        self.assertEqual(analysis["fields"]["battery_backup"], "both")
        self.assertIn("installation_address", analysis["missing_fields"])
        self.assertIn("roof_or_mount", analysis["missing_fields"])
        self.assertIn("timeline", analysis["missing_fields"])
        self.assertNotIn("energy_usage", analysis["missing_fields"])
        self.assertNotIn("battery_backup", analysis["missing_fields"])
        self.assertNotIn("property_type", analysis["missing_fields"])
        self.assertIn("gedeelte van het adres", draft)
        self.assertIn("postcode en gemeente", draft)
        self.assertIn("type dak", draft)
        self.assertNotIn("jaarlijks elektriciteitsverbruik", draft)
        self.assertNotIn("thuisbatterij", draft)
        self.assertNotIn("ouder is dan 10 jaar", draft)

    def test_direct_purchase_intent_without_word_offerte_is_routed_to_quote(self) -> None:
        email = (
            "Hallo, ik wil 12 zonnepanelen op mijn woning. "
            "Kunnen jullie mij contacteren?"
        )
        with tempfile.TemporaryDirectory() as tmp:
            analysis = run(email, Path(tmp))

        self.assertTrue(analysis["is_quote_request"])
        self.assertEqual(analysis["suggested_module"], MODULE_QUOTE)
        self.assertEqual(analysis["outbound_action"], "create_draft_for_approval")

    def test_maintenance_question_is_routed_to_service(self) -> None:
        email = "Wat kost onderhoud aan mijn zonnepanelen?"
        with tempfile.TemporaryDirectory() as tmp:
            analysis = run(email, Path(tmp))

        self.assertFalse(analysis["is_quote_request"])
        self.assertEqual(analysis["suggested_module"], MODULE_SERVICE)

    def test_generic_belgian_address_and_localized_annual_usage(self) -> None:
        email = (
            "Mijn naam is Jan Peeters. Graag een offerte voor zonnepanelen. "
            "Installatieadres Meir 10, 2000 Antwerpen. Het is een woning ouder "
            "dan 10 jaar: ja, met plat dak en zonder batterij. Jaarverbruik "
            "4.500 kWh per jaar. Installatie binnen 3 maanden."
        )
        with tempfile.TemporaryDirectory() as tmp:
            analysis = run(email, Path(tmp))

        self.assertEqual(
            analysis["fields"]["installation_address"], "Meir 10, 2000 Antwerpen"
        )
        self.assertEqual(analysis["fields"]["annual_usage_kwh"], 4500.0)
        self.assertEqual(analysis["next_action"], "draft_quote_for_manual_review")

    def test_three_thousand_kwh_is_not_multiplied_by_twelve(self) -> None:
        email = (
            "Mijn naam is Jan Peeters. Graag een offerte zonnepanelen voor mijn "
            "woning ouder dan 10 jaar: ja. Kerkstraat 12, 2000 Antwerpen. "
            "Jaarverbruik 3000 kWh. Pannendak, geen batterij, binnen 2 maanden."
        )
        with tempfile.TemporaryDirectory() as tmp:
            analysis = run(email, Path(tmp))

        self.assertEqual(analysis["fields"]["annual_usage_kwh"], 3000.0)
        self.assertNotIn("energy_usage", analysis["missing_fields"])

    def test_quoted_outgoing_questionnaire_is_not_extracted_as_customer_data(self) -> None:
        email = (
            "Beste, ik wil graag een offerte voor zonnepanelen.\n\n"
            "Op 20 juli 2026 schreef First Client BV:\n"
            "> Welk type dak heeft u, bijvoorbeeld pannendak?\n"
            "> Wilt u een thuisbatterij?"
        )
        with tempfile.TemporaryDirectory() as tmp:
            analysis = run(email, Path(tmp))

        self.assertIsNone(analysis["fields"]["roof_or_mount"])
        self.assertIsNone(analysis["fields"]["battery_backup"])
        self.assertIn("roof_or_mount", analysis["missing_fields"])
        self.assertIn("battery_backup", analysis["missing_fields"])


if __name__ == "__main__":
    unittest.main()
