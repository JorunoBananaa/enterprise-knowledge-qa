from __future__ import annotations

from io import BytesIO
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from pydantic import ValidationError
from starlette.datastructures import Headers, UploadFile

from app.core.config import Settings, settings
from app.core.url_security import validate_model_base_url
from app.schemas.chat import CitationOut
from app.schemas.document import DocumentResponse
from app.schemas.user import PasswordResetRequest, UserCreate
from app.services.ocr import _validate_result_url, recognize_text
from app.services.storage import UploadRejectedError, save_upload


class ProductionSettingsTests(unittest.TestCase):
    def test_production_rejects_development_jwt_secret(self) -> None:
        with self.assertRaises(ValidationError):
            Settings(
                environment="production",
                jwt_secret="local-dev-secret",
                auth_cookie_secure=True,
            )

    def test_production_requires_secure_cookie(self) -> None:
        with self.assertRaises(ValidationError):
            Settings(
                environment="production",
                jwt_secret="x" * 32,
                auth_cookie_secure=False,
            )

    def test_production_rejects_development_user_seed(self) -> None:
        with self.assertRaises(ValidationError):
            Settings(
                environment="production",
                jwt_secret="x" * 32,
                auth_cookie_secure=True,
                seed_development_users=True,
                development_seed_password="a-secure-dev-password",
            )

    def test_valid_production_security_settings_are_accepted(self) -> None:
        production = Settings(
            environment="production",
            jwt_secret="x" * 32,
            auth_cookie_secure=True,
        )
        self.assertEqual(production.environment, "production")


class OutboundUrlTests(unittest.TestCase):
    def test_known_provider_endpoint_is_allowed(self) -> None:
        self.assertEqual(
            validate_model_base_url("deepseek", "https://api.deepseek.com/v1"),
            "https://api.deepseek.com/v1",
        )

    def test_unlisted_endpoint_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            validate_model_base_url("openai", "http://127.0.0.1:8080/v1")

    def test_lookalike_provider_host_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            validate_model_base_url(
                "deepseek",
                "https://api.deepseek.com.attacker.example/v1",
            )

    def test_explicit_allowlist_can_enable_local_endpoint(self) -> None:
        with patch.object(
            settings,
            "model_base_url_allowlist",
            "http://ollama:11434/v1",
        ):
            self.assertEqual(
                validate_model_base_url("openai", "http://ollama:11434/v1"),
                "http://ollama:11434/v1",
            )


class OcrSecretTests(unittest.TestCase):
    def test_ocr_requires_explicit_token(self) -> None:
        with patch.object(settings, "paddleocr_token", None):
            with self.assertRaisesRegex(RuntimeError, "PADDLEOCR_TOKEN"):
                recognize_text("unused.pdf")

    def test_ocr_result_host_must_be_allowlisted(self) -> None:
        with patch.object(
            settings,
            "paddleocr_result_host_allowlist",
            "results.example.com",
        ):
            with self.assertRaisesRegex(RuntimeError, "allowlisted"):
                _validate_result_url("https://attacker.example/result.jsonl")


class UploadSecurityTests(unittest.TestCase):
    @staticmethod
    def _upload(filename: str, content_type: str, content: bytes) -> UploadFile:
        return UploadFile(
            file=BytesIO(content),
            filename=filename,
            headers=Headers({"content-type": content_type}),
        )

    def test_valid_pdf_is_saved_under_generated_name(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(settings, "upload_dir", temp_dir):
                stored = save_upload(
                    self._upload("policy.pdf", "application/pdf", b"%PDF-1.7\n%%EOF")
                )

            path = Path(stored)
            self.assertEqual(path.parent, Path(temp_dir))
            self.assertEqual(path.suffix, ".pdf")
            self.assertNotEqual(path.name, "policy.pdf")
            self.assertEqual(path.read_bytes(), b"%PDF-1.7\n%%EOF")

    def test_executable_extension_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(settings, "upload_dir", temp_dir):
                with self.assertRaises(UploadRejectedError) as raised:
                    save_upload(
                        self._upload(
                            "payload.exe",
                            "application/octet-stream",
                            b"MZ-not-allowed",
                        )
                    )

            self.assertEqual(raised.exception.status_code, 415)
            self.assertEqual(list(Path(temp_dir).iterdir()), [])

    def test_oversized_file_is_rejected_and_removed(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            with (
                patch.object(settings, "upload_dir", temp_dir),
                patch.object(settings, "upload_max_file_size_bytes", 8),
            ):
                with self.assertRaises(UploadRejectedError) as raised:
                    save_upload(
                        self._upload("large.txt", "text/plain", b"0123456789")
                    )

            self.assertEqual(raised.exception.status_code, 413)
            self.assertEqual(list(Path(temp_dir).iterdir()), [])

    def test_extension_and_file_signature_must_match(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(settings, "upload_dir", temp_dir):
                with self.assertRaises(UploadRejectedError):
                    save_upload(
                        self._upload("fake.pdf", "application/pdf", b"not a pdf")
                    )

    def test_utf8_character_can_cross_copy_chunk_boundary(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            with (
                patch.object(settings, "upload_dir", temp_dir),
                patch("app.services.storage._COPY_CHUNK_SIZE", 3),
            ):
                stored = save_upload(
                    self._upload("note.txt", "text/plain", "ab中文".encode())
                )

            self.assertEqual(Path(stored).read_text(encoding="utf-8"), "ab中文")


class PublicSchemaTests(unittest.TestCase):
    def test_document_response_does_not_expose_storage_path(self) -> None:
        self.assertNotIn("storage_path", DocumentResponse.model_fields)

    def test_citation_response_does_not_expose_storage_path(self) -> None:
        self.assertNotIn("document_storage_path", CitationOut.model_fields)


class PasswordSchemaTests(unittest.TestCase):
    def test_new_user_rejects_short_password(self) -> None:
        with self.assertRaises(ValidationError):
            UserCreate(
                username="new-user",
                display_name="New User",
                password="short",
            )

    def test_password_reset_rejects_short_password(self) -> None:
        with self.assertRaises(ValidationError):
            PasswordResetRequest(new_password="short")


if __name__ == "__main__":
    unittest.main()
