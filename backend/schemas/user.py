from datetime import datetime
from pydantic import BaseModel
from typing import Optional, Literal


class UserBase(BaseModel):
    email: str
    firstname: str
    middlename: Optional[str] = None
    lastname: str
    department: Literal["CBAPA", "CCIT", "CTE"]
    profile_picture_url: Optional[str] = None


class UserCreate(UserBase):
    password: str


class UserLogin(BaseModel):
    email: str
    password: str


class UserResponse(UserBase):
    id: int
    legal_consent_required: bool
    legal_consent_required_version: Optional[str] = None
    legal_consent_version: Optional[str] = None
    privacy_acknowledged_at: Optional[datetime] = None
    terms_accepted_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class LegalConsentRequest(BaseModel):
    version: str
    privacy_acknowledged: Literal[True]
    terms_agreed: Literal[True]
