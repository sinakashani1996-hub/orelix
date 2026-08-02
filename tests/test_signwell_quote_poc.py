import json
import tempfile
import unittest
from pathlib import Path

from execution.signwell_quote_poc import build_signwell_payload


class SignWellQuotePocTests(unittest.TestCase):
    def test_payload_is_dutch_draft_and_embedded(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "quote.docx"
            path.write_bytes(b"test document")
            payload = build_signwell_payload("Solar quote", path, "test@example.com", "Test Customer")

        self.assertTrue(payload["draft"])
        self.assertTrue(payload["test_mode"])
        self.assertTrue(payload["embedded_signing"])
        self.assertTrue(payload["text_tags"])
        self.assertEqual(payload["language"], "nl")
        self.assertEqual(payload["recipients"][0]["email"], "test@example.com")
        self.assertIn("uw offerte", payload["message"])
        json.dumps(payload)


if __name__ == "__main__":
    unittest.main()
