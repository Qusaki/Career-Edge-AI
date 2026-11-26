"""Account-scoped legal acceptance and protected-route regression tests."""

import importlib.util
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Column, Integer, MetaData, Table, create_engine, inspect
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from alembic.migration import MigrationContext
from alembic.operations import Operations

from core.legal_consent import LEGAL_BUNDLE_VERSION, requires_legal_consent
from database import Base, get_db
from models.user import User
from routers import auth, drills, pre_test_active_listening, user


class LegalConsentTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)
        app = FastAPI()
        app.include_router(auth.router, prefix="/auth")
        app.include_router(user.router, prefix="/users")
        app.include_router(drills.router, prefix="/drills")
        app.include_router(pre_test_active_listening.router, prefix="/pre-test-active-listening")

        def override_db():
            with self.SessionLocal() as db:
                yield db

        app.dependency_overrides[get_db] = override_db
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    def create(self, email):
        response = self.client.post("/users/", json={
            "email": email, "password": "Validpass1!", "firstname": "New", "middlename": None,
            "lastname": "User", "department": "CCIT",
        })
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def headers(self, email):
        response = self.client.post("/auth/login", data={"username": email, "password": "Validpass1!"})
        self.assertEqual(response.status_code, 200)
        return {"Authorization": f"Bearer {response.json()['access_token']}"}

    def test_new_account_requires_consent_before_rest_and_websocket_features(self):
        created = self.create("new@example.test")
        self.assertEqual(created["legal_consent_required_version"], LEGAL_BUNDLE_VERSION)
        self.assertTrue(created["legal_consent_required"])
        headers = self.headers("new@example.test")
        self.assertEqual(self.client.get("/users/me", headers=headers).status_code, 200)
        blocked = self.client.get("/drills/", headers=headers)
        self.assertEqual(blocked.status_code, 403)
        self.assertEqual(self.client.get("/drills/generate/jam", headers=headers).status_code, 403)
        token = headers["Authorization"].split(" ", 1)[1]
        with self.assertRaises(Exception) as failure:
            with self.client.websocket_connect(f"/pre-test-active-listening/1/chat?token={token}"):
                pass
        self.assertEqual(getattr(failure.exception, "code", None), 1008)

    def test_acceptance_is_atomic_account_scoped_and_idempotent(self):
        first = self.create("first@example.test")
        second = self.create("second@example.test")
        headers = self.headers("first@example.test")
        payload = {"version": LEGAL_BUNDLE_VERSION, "privacy_acknowledged": True, "terms_agreed": True}
        self.assertEqual(self.client.post("/users/me/legal-consent", headers=headers,
                                          json={**payload, "terms_agreed": False}).status_code, 422)
        self.assertEqual(self.client.post("/users/me/legal-consent", headers=headers,
                                          json={**payload, "version": "wrong"}).status_code, 409)
        self.assertEqual(self.client.get("/drills/", headers=headers).status_code, 403)
        accepted = self.client.post("/users/me/legal-consent", headers=headers, json=payload)
        self.assertEqual(accepted.status_code, 200, accepted.text)
        body = accepted.json()
        self.assertEqual(body["id"], first["id"])
        self.assertFalse(body["legal_consent_required"])
        self.assertEqual(body["legal_consent_version"], LEGAL_BUNDLE_VERSION)
        self.assertIsNotNone(body["privacy_acknowledged_at"])
        self.assertEqual(body["privacy_acknowledged_at"], body["terms_accepted_at"])
        repeated = self.client.post("/users/me/legal-consent", headers=headers, json=payload)
        self.assertEqual(repeated.status_code, 200)
        self.assertEqual(repeated.json()["privacy_acknowledged_at"], body["privacy_acknowledged_at"])
        self.assertEqual(self.client.get("/drills/", headers=headers).status_code, 200)
        self.assertEqual(self.client.get("/drills/generate/jam", headers=headers).status_code, 200)
        self.assertFalse(self.client.get("/users/me", headers=headers).json()["legal_consent_required"])
        # A fresh login/token reads the same durable account-scoped acceptance.
        renewed_headers = self.headers("first@example.test")
        self.assertFalse(self.client.get("/users/me", headers=renewed_headers).json()["legal_consent_required"])
        with self.SessionLocal() as db:
            other = db.get(User, second["id"])
            self.assertTrue(requires_legal_consent(other))

    def test_existing_account_with_null_required_version_remains_usable(self):
        from core.security import get_password_hash
        with self.SessionLocal() as db:
            db.add(User(email="legacy@example.test", hashed_password=get_password_hash("Validpass1!"),
                        firstname="Legacy", lastname="User", department="CCIT"))
            db.commit()
        headers = self.headers("legacy@example.test")
        response = self.client.get("/users/me", headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["legal_consent_required_version"])
        self.assertFalse(response.json()["legal_consent_required"])
        self.assertEqual(self.client.get("/drills/", headers=headers).status_code, 200)
        with self.SessionLocal() as db:
            legacy = db.query(User).filter(User.email == "legacy@example.test").one()
            legacy.legal_consent_required_version = LEGAL_BUNDLE_VERSION
            db.commit()
        self.assertTrue(self.client.get("/users/me", headers=headers).json()["legal_consent_required"])
        self.assertEqual(self.client.get("/drills/", headers=headers).status_code, 403)

    def test_migration_adds_nullable_fields_and_downgrades_cleanly(self):
        path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "a1c9e3f7b2d4_add_legal_consent.py"
        spec = importlib.util.spec_from_file_location("legal_consent_migration", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        engine = create_engine("sqlite://")
        metadata = MetaData()
        Table("users", metadata, Column("id", Integer, primary_key=True))
        metadata.create_all(engine)
        with engine.begin() as connection:
            connection.execute(metadata.tables["users"].insert().values(id=1))
            module.op = Operations(MigrationContext.configure(connection))
            module.upgrade()
            fields = {column["name"] for column in inspect(connection).get_columns("users")}
            self.assertIn("legal_consent_required_version", fields)
            self.assertIsNone(connection.exec_driver_sql("SELECT legal_consent_required_version FROM users WHERE id=1").scalar())
            module.downgrade()
            fields = {column["name"] for column in inspect(connection).get_columns("users")}
            self.assertNotIn("legal_consent_required_version", fields)
        engine.dispose()
