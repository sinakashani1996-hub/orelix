import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from execution.pandadoc_quote_poc import build_pandadoc_data, build_quote_lines, build_quote_rtf, build_template_data, write_quote_docx


ROOT = Path(__file__).resolve().parents[1]


class PandaDocQuotePocTests(unittest.TestCase):
    def test_build_quote_rtf_contains_signature_field_tags(self) -> None:
        analysis = json.loads((ROOT / ".tmp" / "solar_quote_poc" / "quote_request_complete_nl" / "analysis.json").read_text(encoding="utf-8"))

        rtf = build_quote_rtf(analysis, "Sina Kashani")

        self.assertIn("[s:client:sig", rtf)
        self.assertIn("[t:client:name", rtf)
        self.assertIn("First Client BV", rtf)
        self.assertIn("Sina Kashani", rtf)

    def test_build_pandadoc_data_assigns_client_role(self) -> None:
        data = build_pandadoc_data("Solar quote - Test", "test@example.com", "Test Customer")

        self.assertEqual(data["recipients"][0]["role"], "client")
        self.assertEqual(data["recipients"][0]["email"], "test@example.com")
        self.assertEqual(data["fields"]["sig"]["role"], "client")
        self.assertIn("solar-poc", data["tags"])

    def test_build_template_data_assigns_client_role_and_tokens(self) -> None:
        analysis = json.loads((ROOT / ".tmp" / "solar_quote_poc" / "quote_request_complete_nl" / "analysis.json").read_text(encoding="utf-8"))

        data = build_template_data("Solar quote - Test", "test@example.com", "Test Customer", "template-123", analysis)

        self.assertEqual(data["template_uuid"], "template-123")
        self.assertEqual(data["recipients"][0]["role"], "client")
        self.assertIn({"name": "client.name", "value": "Test Customer"}, data["tokens"])

    def test_build_quote_docx_contains_plain_field_tags(self) -> None:
        analysis = json.loads((ROOT / ".tmp" / "solar_quote_poc" / "quote_request_complete_nl" / "analysis.json").read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "quote.docx"
            write_quote_docx(path, build_quote_lines(analysis, "Sina Kashani"))
            with zipfile.ZipFile(path) as docx:
                document_xml = docx.read("word/document.xml").decode("utf-8")

        self.assertIn("[s:client:sig", document_xml)
        self.assertIn("[t:client:name", document_xml)


if __name__ == "__main__":
    unittest.main()
