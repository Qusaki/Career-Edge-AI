"""One-time password recovery without persisting or logging raw tokens."""

import hashlib
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlsplit

from sqlalchemy import update
from sqlalchemy.orm import Session

from core.config import settings
from core.password_policy import validate_new_password
from core.security import get_password_hash
from database import SessionLocal
from models.password_reset_token import PasswordResetToken
from models.user import User
from services.email_service import send_password_reset_email, smtp_configuration


logger = logging.getLogger(__name__)
RESET_TTL = timedelta(minutes=20)
REQUEST_COOLDOWN = timedelta(seconds=60)
GENERIC_REQUEST_MESSAGE = "If an account exists for that email, you’ll receive a password reset link."
INVALID_LINK_MESSAGE = "This password reset link is invalid or has expired. Request a new link."
_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_-]{43}\Z")


class InvalidResetToken(Exception):
    pass


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _frontend_url() -> str:
    configured = settings.FRONTEND_PUBLIC_URL
    parsed = urlsplit(configured)
    local_http = settings.ENVIRONMENT in {"development", "dev", "local"} and parsed.hostname in {"localhost", "127.0.0.1"}
    if (parsed.scheme != "https" and not (parsed.scheme == "http" and local_http)) or not parsed.hostname \
            or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
        raise ValueError("Password recovery frontend URL is not configured.")
    return configured.rstrip("/")


def recovery_configuration_ready() -> str:
    frontend_url = _frontend_url()
    smtp_configuration()
    return frontend_url


def issue_password_reset(db: Session, email: str, frontend_url: str) -> tuple[int, str, str] | None:
    """Serialize per-user issuance, enforce cooldown, and commit only a token hash."""
    user = db.query(User).filter(User.email == email).with_for_update().first()
    if user is None:
        return None
    now = datetime.now(timezone.utc)
    previous = (db.query(PasswordResetToken)
                .filter(PasswordResetToken.user_id == user.id)
                .order_by(PasswordResetToken.created_at.desc()).first())
    if previous is not None and _utc(previous.created_at) > now - REQUEST_COOLDOWN:
        return None
    raw_token = secrets.token_urlsafe(32)
    reset_url = f"{frontend_url}/#/reset-password?token={quote(raw_token, safe='')}"
    try:
        db.query(PasswordResetToken).filter(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.revoked_at.is_(None),
            PasswordResetToken.expires_at > now,
        ).update({"revoked_at": now}, synchronize_session=False)
        token = PasswordResetToken(
            user_id=user.id,
            token_hash=hashlib.sha256(raw_token.encode("ascii")).hexdigest(),
            created_at=now,
            expires_at=now + RESET_TTL,
        )
        db.add(token)
        db.flush()
        token_id = token.id
        db.commit()
    except Exception:
        db.rollback()
        raise
    return token_id, user.email, reset_url


def deliver_password_reset(token_id: int, recipient: str, reset_url: str) -> None:
    """FastAPI runs synchronous background tasks in a worker thread, not the event loop."""
    try:
        send_password_reset_email(recipient, reset_url)
    except Exception as error:
        logger.warning("Password recovery delivery failed (%s)", type(error).__name__)
        try:
            with SessionLocal() as db:
                db.query(PasswordResetToken).filter(
                    PasswordResetToken.id == token_id,
                    PasswordResetToken.used_at.is_(None),
                    PasswordResetToken.revoked_at.is_(None),
                ).update({"revoked_at": datetime.now(timezone.utc)}, synchronize_session=False)
                db.commit()
        except Exception as revoke_error:
            logger.error("Password recovery token revocation failed (%s)", type(revoke_error).__name__)


def reset_password(db: Session, raw_token: str, new_password: str) -> None:
    if not _TOKEN_PATTERN.fullmatch(raw_token):
        raise InvalidResetToken()
    now = datetime.now(timezone.utc)
    token_hash = hashlib.sha256(raw_token.encode("ascii")).hexdigest()
    try:
        # Match issuance's user-then-token lock order to avoid a reset/request deadlock.
        owner = db.query(PasswordResetToken.user_id).filter(PasswordResetToken.token_hash == token_hash).first()
        if owner is None:
            raise InvalidResetToken()
        user = db.query(User).filter(User.id == owner.user_id).with_for_update().first()
        if user is None:
            raise InvalidResetToken()
        # Conditional UPDATE acquires the token row lock and atomically claims one use.
        # A concurrent replay waits on the user lock, then claims no row.
        claim = db.execute(
            update(PasswordResetToken)
            .where(
                PasswordResetToken.token_hash == token_hash,
                PasswordResetToken.used_at.is_(None),
                PasswordResetToken.revoked_at.is_(None),
                PasswordResetToken.expires_at > now,
            )
            .values(used_at=now)
            .returning(PasswordResetToken.user_id)
        ).first()
        if claim is None:
            raise InvalidResetToken()
        validate_new_password(new_password)
        user.hashed_password = get_password_hash(new_password)
        db.query(PasswordResetToken).filter(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.revoked_at.is_(None),
            PasswordResetToken.expires_at > now,
        ).update({"revoked_at": now}, synchronize_session=False)
        db.commit()
    except Exception:
        db.rollback()
        raise
