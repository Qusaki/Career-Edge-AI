import datetime
import hashlib
import json
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.config import settings
from core.deps import get_current_user
from core.drill_progression import (
    get_completed_drill_types,
    get_drill_lock_message,
    is_drill_level_unlocked,
)
from database import get_db
from models.offline_sync import OfflineSyncReceipt
from models.user import User
from schemas.offline_sync import OfflineSyncRequest, OfflineSyncResponse
from services.offline_sync import (
    evaluate_payload,
    get_owned_native_session,
    get_owned_existing_session,
    persist_authoritative_result,
    serialize_session,
    validate_sync_payload,
)


router = APIRouter()
logger = logging.getLogger(__name__)
MAX_SYNC_PAYLOAD_BYTES = 256 * 1024
# The lease is never shorter than 15 minutes and is at least twice the
# configured provider timeout. That prevents a live configured AI request from
# being stolen while still recovering receipts left by a crashed Render worker.
PROCESSING_STALE_AFTER = datetime.timedelta(
    seconds=max(15 * 60, settings.AI_TIMEOUT_SECONDS * 2),
)
PROCESSING_RETRY_AFTER_SECONDS = 30


def sync_error(
    status_code: int,
    code: str,
    message: str,
    *,
    retryable: bool,
    retry_after: int | None = None,
) -> HTTPException:
    headers = {"Retry-After": str(retry_after)} if retry_after is not None else None
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message, "retryable": retryable},
        headers=headers,
    )


def canonical_payload(payload: OfflineSyncRequest) -> dict:
    return payload.model_dump(
        mode="json",
        exclude={"local_score", "local_evaluation", "evaluation_authority"},
    )


def payload_digest(payload: OfflineSyncRequest) -> str:
    encoded = json.dumps(
        canonical_payload(payload),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    if len(encoded) > MAX_SYNC_PAYLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Offline synchronization payload is too large.")
    return hashlib.sha256(encoded).hexdigest()


def response_from_receipt(
    db: Session,
    current_user: User,
    receipt: OfflineSyncReceipt,
    replay: bool,
) -> OfflineSyncResponse:
    if not receipt.result_json or not receipt.server_session_id or not receipt.completed_at:
        raise sync_error(
            409,
            "receipt_result_missing",
            "The synchronization receipt is complete, but its authoritative result cannot be verified. Please contact support.",
            retryable=False,
        )
    native_session = get_owned_native_session(
        db,
        current_user,
        receipt.activity_type,
        receipt.server_session_id,
    )
    if (
        native_session is None
        or getattr(native_session, "status", None) != "completed"
        or receipt.result_json.get("id") != receipt.server_session_id
    ):
        logger.error(
            "Offline sync receipt integrity failure (activity=%s, receipt=%s)",
            receipt.activity_type,
            receipt.id,
        )
        raise sync_error(
            409,
            "receipt_result_missing",
            "The authoritative server result could not be verified. Your local session has been preserved for support.",
            retryable=False,
        )
    return OfflineSyncResponse(
        activity_type=receipt.activity_type,
        client_session_id=receipt.client_session_id,
        server_session_id=receipt.server_session_id,
        authoritative_result=receipt.result_json,
        completed_at=receipt.completed_at,
        idempotent_replay=replay,
    )


@router.post("", response_model=OfflineSyncResponse)
async def sync_offline_session(
    payload: OfflineSyncRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > MAX_SYNC_PAYLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Offline synchronization payload is too large.")
    validate_sync_payload(payload, current_user.department)
    digest = payload_digest(payload)
    now = datetime.datetime.utcnow()
    attempt_token = str(uuid.uuid4())
    key_filters = (
        OfflineSyncReceipt.user_id == current_user.id,
        OfflineSyncReceipt.activity_type == payload.activity_type,
        OfflineSyncReceipt.client_session_id == payload.client_session_id,
    )
    receipt = db.query(OfflineSyncReceipt).filter(*key_filters).with_for_update().first()
    if receipt:
        if receipt.payload_hash != digest:
            raise sync_error(
                409,
                "payload_conflict",
                "This synchronization key was already used with different session data.",
                retryable=False,
            )
        if receipt.status == "completed":
            return response_from_receipt(db, current_user, receipt, replay=True)
        if receipt.status == "processing":
            lease_started_at = receipt.processing_started_at or receipt.updated_at or receipt.created_at
            if lease_started_at and now - lease_started_at < PROCESSING_STALE_AFTER:
                raise sync_error(
                    409,
                    "sync_in_progress",
                    "This offline session is already being synchronized.",
                    retryable=True,
                    retry_after=PROCESSING_RETRY_AFTER_SECONDS,
                )
        receipt.status = "processing"
        receipt.processing_token = attempt_token
        receipt.processing_started_at = now
        receipt.last_error = None
        receipt.updated_at = now
        db.commit()
    else:
        receipt = OfflineSyncReceipt(
            user_id=current_user.id,
            activity_type=payload.activity_type,
            client_session_id=payload.client_session_id,
            payload_hash=digest,
            status="processing",
            processing_token=attempt_token,
            processing_started_at=now,
        )
        db.add(receipt)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            concurrent = db.query(OfflineSyncReceipt).filter(*key_filters).first()
            if concurrent and concurrent.payload_hash != digest:
                raise sync_error(
                    409,
                    "payload_conflict",
                    "This synchronization key was already used with different session data.",
                    retryable=False,
                )
            if concurrent and concurrent.status == "completed":
                return response_from_receipt(db, current_user, concurrent, replay=True)
            raise sync_error(
                409,
                "sync_in_progress",
                "This offline session is already being synchronized.",
                retryable=True,
                retry_after=PROCESSING_RETRY_AFTER_SECONDS,
            )

    try:
        existing_session = get_owned_existing_session(db, current_user, payload)
        if payload.activity_type == "drill" and existing_session is None:
            drill_level = str(payload.activity_state["drillLevel"])
            completed_types = get_completed_drill_types(db, current_user.id)
            if not is_drill_level_unlocked(drill_level, completed_types):
                raise sync_error(
                    403,
                    "drill_level_locked",
                    get_drill_lock_message(drill_level),
                    retryable=False,
                )
        if existing_session is not None and existing_session.status == "completed":
            result = serialize_session(existing_session)
        else:
            evaluation = await evaluate_payload(payload, current_user)
            native_session = persist_authoritative_result(
                db, payload, current_user, evaluation, existing_session,
            )
            result = serialize_session(native_session)

        receipt = db.query(OfflineSyncReceipt).filter(*key_filters).with_for_update().one()
        if receipt.status != "processing" or receipt.processing_token != attempt_token:
            db.rollback()
            raise sync_error(
                409,
                "sync_lease_lost",
                "This synchronization attempt was superseded by a recovery attempt.",
                retryable=True,
                retry_after=PROCESSING_RETRY_AFTER_SECONDS,
            )
        receipt.status = "completed"
        receipt.processing_token = None
        receipt.server_session_id = int(result["id"])
        receipt.result_json = result
        receipt.last_error = None
        receipt.completed_at = datetime.datetime.utcnow()
        receipt.updated_at = receipt.completed_at
        db.commit()
        db.refresh(receipt)
        return response_from_receipt(db, current_user, receipt, replay=False)
    except HTTPException:
        db.rollback()
        receipt = db.query(OfflineSyncReceipt).filter(*key_filters).first()
        if (
            receipt
            and receipt.status == "processing"
            and receipt.processing_token == attempt_token
        ):
            receipt.status = "failed"
            receipt.processing_token = None
            receipt.last_error = "The offline session could not be reconciled safely."
            receipt.updated_at = datetime.datetime.utcnow()
            db.commit()
        raise
    except Exception as error:
        db.rollback()
        receipt = db.query(OfflineSyncReceipt).filter(*key_filters).first()
        if (
            receipt
            and receipt.status == "processing"
            and receipt.processing_token == attempt_token
        ):
            receipt.status = "failed"
            receipt.processing_token = None
            receipt.last_error = "Authoritative evaluation is temporarily unavailable."
            receipt.updated_at = datetime.datetime.utcnow()
            db.commit()
        logger.warning(
            "Offline synchronization failed (activity=%s, receipt=%s, error=%s)",
            payload.activity_type,
            receipt.id if receipt else None,
            type(error).__name__,
        )
        raise sync_error(
            503,
            "provider_unavailable",
            "Authoritative evaluation is temporarily unavailable. Please retry later.",
            retryable=True,
        ) from error
