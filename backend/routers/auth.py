from datetime import timedelta
# pyrefly: ignore [missing-import]
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import Session

from database import get_db
from models.user import User
from core.security import (
    verify_password,
    create_access_token,
    ACCESS_TOKEN_EXPIRE_MINUTES,
)
# pyrefly: ignore [missing-import]
from fastapi.security import OAuth2PasswordRequestForm

from schemas.token import Token
from schemas.password_recovery import (
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    ResetPasswordRequest,
    ResetPasswordResponse,
)
from services.password_recovery import (
    GENERIC_REQUEST_MESSAGE,
    INVALID_LINK_MESSAGE,
    InvalidResetToken,
    deliver_password_reset,
    issue_password_reset,
    recovery_configuration_ready,
    reset_password,
)
from services.password_recovery import logger as recovery_logger

router = APIRouter()


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
def forgot_password(request: ForgotPasswordRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    response = ForgotPasswordResponse(message=GENERIC_REQUEST_MESSAGE)
    try:
        frontend_url = recovery_configuration_ready()
    except ValueError:
        recovery_logger.warning("Password recovery is not configured.")
        return response
    try:
        issued = issue_password_reset(db, request.email.strip(), frontend_url)
    except Exception as error:
        recovery_logger.error("Password recovery request failed (%s)", type(error).__name__)
        return response
    if issued is not None:
        background_tasks.add_task(deliver_password_reset, *issued)
    return response


@router.post("/reset-password", response_model=ResetPasswordResponse)
def reset_password_route(request: ResetPasswordRequest, db: Session = Depends(get_db)):
    try:
        reset_password(db, request.token, request.new_password)
    except InvalidResetToken as error:
        raise HTTPException(status_code=400, detail=INVALID_LINK_MESSAGE) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return ResetPasswordResponse(message="Your password has been reset successfully.")


@router.post("/login", response_model=Token)
def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    # form_data.username will contain the email when used via Swagger
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}
