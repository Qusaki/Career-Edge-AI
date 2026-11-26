from sqlalchemy import Column, DateTime, Integer, String
from database import Base
from core.legal_consent import requires_legal_consent


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    hashed_password = Column(String)

    firstname = Column(String, nullable=False, server_default="")
    middlename = Column(String, nullable=True)
    lastname = Column(String, nullable=False, server_default="")
    department = Column(String, nullable=False, server_default="CCIT")
    profile_picture_url = Column(String, nullable=True)
    # NULL required version intentionally exempts existing pre-feature accounts.
    legal_consent_required_version = Column(String(32), nullable=True)
    legal_consent_version = Column(String(32), nullable=True)
    privacy_acknowledged_at = Column(DateTime(timezone=True), nullable=True)
    terms_accepted_at = Column(DateTime(timezone=True), nullable=True)

    @property
    def legal_consent_required(self) -> bool:
        return requires_legal_consent(self)
