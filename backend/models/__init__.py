"""Central SQLAlchemy model registry for application metadata discovery."""

from models.user import Base

# Import every concrete model module so its tables are registered on Base.metadata.
from models import custom_skills
from models import drills
from models import offline_sync
from models import post_test_interview
from models import pre_test_active_listening
from models import pre_test_intro
from models import thesis_interview
from models import upcoming_student_interview

__all__ = ["Base"]
