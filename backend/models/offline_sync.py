import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String, UniqueConstraint

from database import Base


class OfflineSyncReceipt(Base):
    __tablename__ = "offline_sync_receipts"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "activity_type",
            "client_session_id",
            name="uq_offline_sync_receipt_owner_activity_client",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    activity_type = Column(String(64), nullable=False)
    client_session_id = Column(String(128), nullable=False)
    payload_hash = Column(String(64), nullable=False)
    status = Column(String(16), nullable=False, default="processing")
    processing_token = Column(String(36), nullable=True)
    processing_started_at = Column(DateTime, nullable=True)
    server_session_id = Column(Integer, nullable=True)
    result_json = Column(JSON, nullable=True)
    last_error = Column(String(512), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
