from sqlalchemy import Column, Integer, String
from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    hashed_password = Column(String)

    firstname = Column(String, nullable=False, server_default="")
    middlename = Column(String, nullable=True)
    lastname = Column(String, nullable=False, server_default="")
    department = Column(String, nullable=False, server_default="CCIT")
