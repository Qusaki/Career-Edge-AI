import hashlib
import logging
import secrets
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Barrier
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from core.config import settings
from core.security import get_password_hash, verify_password
from database import Base, get_db
from models.password_reset_token import PasswordResetToken
from models.user import User
from routers import auth, user
from services import email_service, password_recovery


class PasswordRecoveryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)
        self.old_password = "old password works"
        with self.SessionLocal() as db:
            db.add(User(email="existing@example.test", hashed_password=get_password_hash(self.old_password),
                        firstname="Existing", lastname="User", department="CCIT"))
            db.commit()
        app = FastAPI()
        app.include_router(auth.router, prefix="/auth")
        app.include_router(user.router, prefix="/users")

        def override_db():
            with self.SessionLocal() as db:
                yield db

        app.dependency_overrides[get_db] = override_db
        self.client = TestClient(app)
        for name, value in {
            "FRONTEND_PUBLIC_URL": "https://career.example",
            "SMTP_HOST": "smtp.example.test",
            "SMTP_PORT": "587",
            "SMTP_USERNAME": "mailer",
            "SMTP_PASSWORD": "test-only-placeholder",
            "SMTP_FROM_EMAIL": "mail@example.test",
            "SMTP_FROM_NAME": "Career Edge AI",
            "SMTP_SECURITY": "starttls",
        }.items():
            setting_patch = patch.object(settings, name, value)
            setting_patch.start()
            self.addCleanup(setting_patch.stop)
        session_patch = patch.object(password_recovery, "SessionLocal", self.SessionLocal)
        session_patch.start()
        self.addCleanup(session_patch.stop)
        mail_patch = patch.object(password_recovery, "send_password_reset_email")
        self.mail = mail_patch.start()
        self.addCleanup(mail_patch.stop)

    def tearDown(self) -> None:
        self.client.close()
        self.engine.dispose()

    def request_link(self, email: str = "existing@example.test"):
        return self.client.post("/auth/forgot-password", json={"email": email})

    def raw_token(self) -> str:
        url = self.mail.call_args.args[1]
        self.assertEqual(urlsplit(url).query, "")
        self.assertTrue(urlsplit(url).fragment.startswith("/reset-password?token="))
        return parse_qs(urlsplit(url).fragment.split("?", 1)[1])["token"][0]

    def reset(self, token: str, password: str = "new password works"):
        return self.client.post("/auth/reset-password", json={"token": token, "new_password": password})

    def test_known_unknown_and_unconfigured_requests_are_publicly_identical(self) -> None:
        known = self.request_link()
        unknown = self.request_link("unknown@example.test")
        self.assertEqual((known.status_code, known.json()), (unknown.status_code, unknown.json()))
        self.assertEqual(known.status_code, 200)
        self.assertEqual(self.mail.call_count, 1)
        with patch.object(settings, "SMTP_HOST", ""):
            unavailable = self.request_link("unknown@example.test")
        self.assertEqual((known.status_code, known.json()), (unavailable.status_code, unavailable.json()))

    def test_token_is_random_hash_only_and_expires_after_twenty_minutes(self) -> None:
        self.request_link()
        raw = self.raw_token()
        self.assertEqual(len(raw), 43)
        with self.SessionLocal() as db:
            record = db.query(PasswordResetToken).one()
            self.assertEqual(record.token_hash, hashlib.sha256(raw.encode("ascii")).hexdigest())
            self.assertNotEqual(record.token_hash, raw)
            self.assertEqual(len(record.token_hash), 64)
            self.assertEqual(password_recovery._utc(record.expires_at) - password_recovery._utc(record.created_at), timedelta(minutes=20))
        self.assertEqual(self.mail.call_args.args[0], "existing@example.test")

    def test_cooldown_and_new_request_revokes_previous_active_link(self) -> None:
        self.request_link()
        old = self.raw_token()
        cooldown = self.request_link()
        self.assertEqual(cooldown.status_code, 200)
        self.assertEqual(self.mail.call_count, 1)
        with self.SessionLocal() as db:
            record = db.query(PasswordResetToken).one()
            record.created_at = datetime.now(timezone.utc) - timedelta(seconds=61)
            db.commit()
        self.request_link()
        self.assertEqual(self.mail.call_count, 2)
        new = self.raw_token()
        self.assertNotEqual(old, new)
        with self.SessionLocal() as db:
            old_record = db.query(PasswordResetToken).filter_by(token_hash=hashlib.sha256(old.encode()).hexdigest()).one()
            self.assertIsNotNone(old_record.revoked_at)
        self.assertEqual(self.reset(old).status_code, 400)
        self.assertEqual(self.reset(new).status_code, 200)

    def test_invalid_expired_revoked_and_reused_links_share_safe_error(self) -> None:
        self.request_link()
        valid = self.raw_token()
        malformed = self.reset("invalid!")
        unknown = self.reset("A" * 43)
        with self.SessionLocal() as db:
            db.query(PasswordResetToken).one().expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
            db.commit()
        expired = self.reset(valid)
        self.assertEqual((malformed.status_code, malformed.json()), (unknown.status_code, unknown.json()))
        self.assertEqual((unknown.status_code, unknown.json()), (expired.status_code, expired.json()))
        with self.SessionLocal() as db:
            record = db.query(PasswordResetToken).one()
            record.expires_at = datetime.now(timezone.utc) + timedelta(minutes=20)
            record.revoked_at = datetime.now(timezone.utc)
            db.commit()
        self.assertEqual(self.reset(valid).json(), expired.json())
        with self.SessionLocal() as db:
            db.query(PasswordResetToken).one().revoked_at = None
            db.commit()
        self.assertEqual(self.reset(valid).status_code, 200)
        self.assertEqual(self.reset(valid).json(), expired.json())

    def test_policy_rejects_bad_values_and_preserves_exact_valid_spaces(self) -> None:
        self.request_link()
        raw = self.raw_token()
        for candidate in ("short", "a" * 73, " " * 15):
            with self.subTest(candidate_length=len(candidate)):
                self.assertEqual(self.reset(raw, candidate).status_code, 422)
        spaced = "  valid passphrase  "
        self.assertEqual(self.reset(raw, spaced).status_code, 200)
        with self.SessionLocal() as db:
            saved = db.query(User).one()
            self.assertTrue(verify_password(spaced, saved.hashed_password))
            self.assertFalse(verify_password(spaced.strip(), saved.hashed_password))
            self.assertIsNotNone(db.query(PasswordResetToken).one().used_at)

    def test_old_login_fails_new_login_works_and_registration_unchanged(self) -> None:
        self.request_link()
        self.assertEqual(self.reset(self.raw_token()).status_code, 200)
        self.assertEqual(self.client.post("/auth/login", data={"username": "existing@example.test", "password": self.old_password}).status_code, 401)
        self.assertEqual(self.client.post("/auth/login", data={"username": "existing@example.test", "password": "new password works"}).status_code, 200)
        signup = self.client.post("/users/", json={"email": "new@example.test", "firstname": "New", "lastname": "User", "department": "CCIT", "password": "fifteen characters"})
        self.assertEqual(signup.status_code, 200, signup.text)
        self.assertEqual(self.client.post("/auth/login", data={"username": "new@example.test", "password": "fifteen characters"}).status_code, 200)

    def test_failed_password_hash_rolls_back_claim_and_password_change(self) -> None:
        self.request_link()
        raw = self.raw_token()
        with patch.object(password_recovery, "get_password_hash", side_effect=RuntimeError("synthetic failure")):
            with self.assertRaises(RuntimeError):
                self.reset(raw)
        with self.SessionLocal() as db:
            self.assertIsNone(db.query(PasswordResetToken).one().used_at)
            self.assertTrue(verify_password(self.old_password, db.query(User).one().hashed_password))
        self.assertEqual(self.reset(raw).status_code, 200)

    def test_email_failure_keeps_generic_response_and_revokes_unsent_link(self) -> None:
        self.mail.side_effect = RuntimeError("synthetic delivery failure")
        with self.assertLogs(password_recovery.logger, level=logging.WARNING) as logs:
            response = self.request_link()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["message"], password_recovery.GENERIC_REQUEST_MESSAGE)
        with self.SessionLocal() as db:
            self.assertIsNotNone(db.query(PasswordResetToken).one().revoked_at)
        self.assertNotIn(self.raw_token(), " ".join(logs.output))

    def test_smtp_starttls_is_mocked_and_never_uses_plaintext_delivery(self) -> None:
        with patch.object(email_service.smtplib, "SMTP") as smtp:
            email_service.send_password_reset_email("existing@example.test", "https://career.example/#/reset-password?token=test")
        client = smtp.return_value.__enter__.return_value
        client.starttls.assert_called_once()
        client.login.assert_called_once()
        client.send_message.assert_called_once()

    def test_smtp_ssl_is_mocked_and_uses_tls(self) -> None:
        with patch.object(settings, "SMTP_SECURITY", "ssl"), patch.object(email_service.smtplib, "SMTP_SSL") as smtp:
            email_service.send_password_reset_email("existing@example.test", "https://career.example/#/reset-password?token=test")
        smtp.assert_called_once()
        smtp.return_value.__enter__.return_value.send_message.assert_called_once()

    def test_public_url_rejects_untrusted_or_insecure_hosts(self) -> None:
        for candidate in ("http://career.example", "https://evil.example/path", "https://evil.example/?next=x",
                          "https://user:pass@career.example", "//career.example"):
            with self.subTest(candidate=candidate), patch.object(settings, "FRONTEND_PUBLIC_URL", candidate):
                self.assertEqual(self.request_link().status_code, 200)
                self.assertEqual(self.mail.call_count, 0)
        with patch.object(settings, "FRONTEND_PUBLIC_URL", "http://localhost:3000"):
            self.assertEqual(self.request_link().status_code, 200)
            self.assertEqual(self.mail.call_count, 1)

    def test_concurrent_claims_cannot_both_reset_password(self) -> None:
        # Separate SQLite connections exercise the conditional UPDATE claim; PostgreSQL
        # uses the same UPDATE as a row-level lock in production.
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "password_recovery_race.sqlite"
            engine = create_engine(f"sqlite:///{database_path.as_posix()}", connect_args={"timeout": 15})
            Base.metadata.create_all(engine)
            session_factory = sessionmaker(bind=engine, autocommit=False, autoflush=False)
            raw = secrets.token_urlsafe(32)
            now = datetime.now(timezone.utc)
            with session_factory() as db:
                account = User(email="race@example.test", hashed_password=get_password_hash(self.old_password),
                               firstname="Race", lastname="User", department="CCIT")
                db.add(account)
                db.flush()
                db.add(PasswordResetToken(user_id=account.id, token_hash=hashlib.sha256(raw.encode()).hexdigest(),
                                          created_at=now, expires_at=now + timedelta(minutes=20)))
                db.commit()
            barrier = Barrier(2)

            def attempt(candidate: str) -> bool:
                barrier.wait()
                with session_factory() as db:
                    try:
                        password_recovery.reset_password(db, raw, candidate)
                        return True
                    except password_recovery.InvalidResetToken:
                        return False

            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(attempt, ("first password works", "second password works")))
            self.assertEqual(sorted(results), [False, True])
            with session_factory() as db:
                self.assertIsNotNone(db.query(PasswordResetToken).one().used_at)
            engine.dispose()


if __name__ == "__main__":
    unittest.main()
