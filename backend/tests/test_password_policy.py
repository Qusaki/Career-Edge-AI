import unittest

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from core.deps import get_current_user
from core.password_policy import validate_new_password
from core.security import get_password_hash, verify_password
from database import Base, get_db
from models.user import User
from routers import auth, user


VALID_PASSWORD = "a" * 15


class PasswordPolicyTests(unittest.TestCase):
    def test_length_whitespace_and_exact_value(self) -> None:
        for value in ("short", "", " " * 15):
            with self.subTest(value_length=len(value)), self.assertRaises(ValueError):
                validate_new_password(value)
        self.assertEqual(validate_new_password(VALID_PASSWORD), VALID_PASSWORD)
        self.assertEqual(validate_new_password("four words make a passphrase"), "four words make a passphrase")
        spaced = "  fifteen letters  "
        self.assertIs(validate_new_password(spaced), spaced)

    def test_utf8_byte_boundary_and_unicode(self) -> None:
        self.assertEqual(validate_new_password("a" * 72), "a" * 72)
        self.assertEqual(validate_new_password("🙂" * 18), "🙂" * 18)
        with self.assertRaisesRegex(ValueError, "too long"):
            validate_new_password("a" * 73)
        with self.assertRaisesRegex(ValueError, "too long"):
            validate_new_password("🙂" * 19)
        with self.assertRaises(ValueError):
            validate_new_password(123)  # type: ignore[arg-type]

class PasswordWriteEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)
        with self.SessionLocal() as db:
            db.add(User(id=1, email="existing@example.test", hashed_password=get_password_hash("old-pass"),
                        firstname="Existing", lastname="User", department="CCIT"))
            db.commit()

        self.app = FastAPI()
        self.app.include_router(user.router, prefix="/users")
        self.app.include_router(auth.router, prefix="/auth")

        def override_db():
            with self.SessionLocal() as db:
                yield db

        def override_user(db: Session = Depends(get_db)):
            return db.get(User, 1)

        self.app.dependency_overrides[get_db] = override_db
        self.app.dependency_overrides[get_current_user] = override_user
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.client.close()
        self.engine.dispose()

    def test_registration_rejects_direct_weak_request_and_accepts_valid_password(self) -> None:
        payload = {"email": "new@example.test", "firstname": "New", "lastname": "User", "department": "CCIT"}
        for password in ("weak", " " * 15, "🙂" * 19):
            with self.subTest(password_length=len(password)):
                response = self.client.post("/users/", json={**payload, "password": password})
                self.assertEqual(response.status_code, 422)
                self.assertIsInstance(response.json()["detail"], str)
                self.assertNotIn(password, response.json()["detail"])
        with self.SessionLocal() as db:
            self.assertIsNone(db.query(User).filter(User.email == payload["email"]).first())

        response = self.client.post("/users/", json={**payload, "password": "  valid passphrase  "})
        self.assertEqual(response.status_code, 200, response.text)
        with self.SessionLocal() as db:
            created = db.query(User).filter(User.email == payload["email"]).one()
            self.assertTrue(verify_password("  valid passphrase  ", created.hashed_password))

    def test_profile_omission_preserves_hash_and_invalid_password_preserves_other_fields(self) -> None:
        with self.SessionLocal() as db:
            original_hash = db.get(User, 1).hashed_password
        response = self.client.put("/users/me", data={"firstname": "Updated"})
        self.assertEqual(response.status_code, 200, response.text)
        with self.SessionLocal() as db:
            saved = db.get(User, 1)
            self.assertEqual(saved.hashed_password, original_hash)
            self.assertEqual(saved.firstname, "Updated")

        empty_response = self.client.put("/users/me", data={"password": ""})
        self.assertEqual(empty_response.status_code, 200, empty_response.text)
        for password in ("weak", " " * 15, "🙂" * 19):
            with self.subTest(password_length=len(password)):
                response = self.client.put("/users/me", data={"firstname": "ShouldNotSave", "password": password})
                self.assertEqual(response.status_code, 422)
        with self.SessionLocal() as db:
            saved = db.get(User, 1)
            self.assertEqual(saved.hashed_password, original_hash)
            self.assertEqual(saved.firstname, "Updated")

    def test_profile_valid_password_updates_hash_and_existing_weak_login_still_works(self) -> None:
        login = self.client.post("/auth/login", data={"username": "existing@example.test", "password": "old-pass"})
        self.assertEqual(login.status_code, 200, login.text)
        response = self.client.put("/users/me", data={"password": "new passphrase works"})
        self.assertEqual(response.status_code, 200, response.text)
        with self.SessionLocal() as db:
            saved = db.get(User, 1)
            self.assertTrue(verify_password("new passphrase works", saved.hashed_password))
            self.assertFalse(verify_password("old-pass", saved.hashed_password))


if __name__ == "__main__":
    unittest.main()
