from fastapi import Depends, HTTPException, status, Query, WebSocketException
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from sqlalchemy.orm import Session
from core.config import settings
from core.security import ALGORITHM
from database import get_db
from models.user import User
from core.legal_consent import requires_legal_consent

# This enables the "Authorize" button in Swagger UI
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

def get_authenticated_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
        
    user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise credentials_exception
    return user


def get_current_user(user: User = Depends(get_authenticated_user)):
    if requires_legal_consent(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Privacy and Terms acceptance is required.")
    return user

def get_current_user_ws(token: str = Query(...), db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Could not validate credentials")
    except JWTError:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Could not validate credentials")
        
    user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Could not validate credentials")
    if requires_legal_consent(user):
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Privacy and Terms acceptance is required")
    return user
