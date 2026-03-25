from pydantic import BaseModel
from typing import Optional, Literal

class UserBase(BaseModel):
    email: str
    firstname: str
    middlename: Optional[str] = None
    lastname: str
    department: Literal["CBAPA", "CCIT", "CTE"]

class UserCreate(UserBase):
    password: str

class UserResponse(UserBase):
    id: int

    class Config:
        from_attributes = True
