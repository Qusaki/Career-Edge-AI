from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from database import get_db
from models.user import User
from schemas.user import UserCreate, UserResponse
from core.security import get_password_hash
from core.deps import get_current_user
from core.aws import upload_file_to_s3

router = APIRouter()


@router.post("/", response_model=UserResponse)
def create_user(user: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.email == user.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    hashed_pwd = get_password_hash(user.password)
    new_user = User(
        email=user.email,
        hashed_password=hashed_pwd,
        firstname=user.firstname,
        middlename=user.middlename,
        lastname=user.lastname,
        department=user.department,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user


@router.get("/me", response_model=UserResponse)
def get_user_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.get("/{user_id}", response_model=UserResponse)
def get_user(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_user = db.query(User).filter(User.id == user_id).first()
    if db_user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return db_user


@router.put("/me", response_model=UserResponse)
def update_user_me(
    firstname: str = Form(None),
    middlename: str = Form(None),
    lastname: str = Form(None),
    department: str = Form(None),
    password: str = Form(None),
    file: UploadFile = File(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if file:
        try:
            url = upload_file_to_s3(file)
            current_user.profile_picture_url = url
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to upload profile picture: {str(e)}")
            
    if firstname is not None:
        current_user.firstname = firstname
    if middlename is not None:
        current_user.middlename = middlename
    if lastname is not None:
        current_user.lastname = lastname
    if department is not None:
        current_user.department = department
    if password is not None:
        current_user.hashed_password = get_password_hash(password)
        
    db.commit()
    db.refresh(current_user)
    return current_user
