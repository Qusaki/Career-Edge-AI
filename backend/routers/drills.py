import json
import random
import datetime
from typing import List
# pyrefly: ignore [missing-import]
from fastapi import APIRouter, HTTPException, Depends
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import Session

from database import get_db
from core.deps import get_current_user
from models.user import User
from models.drills import DrillSession
from schemas.drills import DrillSessionResponse, DrillStartRequest, DrillCompleteRequest, NegotiationTurnRequest

router = APIRouter()

# --- Generator Endpoints ---

@router.get("/generate/jam")
def generate_jam_topic():
    topics = ["Coffee", "Smartphones", "The Future of AI", "My Favorite Book", "Why Sleep is Important", "Traveling", "The Ocean", "Social Media"]
    return {"topic": random.choice(topics)}

@router.get("/generate/fast-word")
def generate_fast_word():
    words = ["Database", "Cloud", "Network", "Algorithm", "Security", "Frontend", "Backend", "Python", "Server"]
    return {"word": random.choice(words)}

@router.get("/generate/emotion")
def generate_emotion_sentence():
    sentences = ["The food is here.", "I can't believe this is happening.", "Look at what you've done.", "It's time to go home.", "Are you sure about that?"]
    emotions = ["Angry", "Excited", "Sad", "Confused", "Nervous", "Joyful"]
    return {"sentence": random.choice(sentences), "emotion": random.choice(emotions)}

@router.get("/generate/synonym")
def generate_synonym_word():
    words = ["Good", "Fast", "Big", "Small", "Happy", "Sad", "Hard", "Easy"]
    return {"word": random.choice(words)}

@router.get("/generate/fake-profile")
def generate_fake_profile():
    names = ["Alex", "Jordan", "Taylor", "Casey", "Morgan", "Riley"]
    ages = [22, 28, 35, 41, 19, 50]
    jobs = ["Astronaut", "Chef", "Software Engineer", "Teacher", "Pilot", "Artist"]
    hobbies = ["Cooking", "Skydiving", "Reading", "Gaming", "Gardening", "Photography"]
    
    return {
        "name": random.choice(names),
        "age": random.choice(ages),
        "job": random.choice(jobs),
        "hobby": random.choice(hobbies)
    }

@router.get("/generate/emojis")
def generate_emojis():
    emojis_pool = ["🚀", "🍕", "🐱", "🎸", "⛰️", "📱", "🎈", "👻", "🌮", "🐉"]
    return {"emojis": random.sample(emojis_pool, 3)}

@router.get("/generate/taboo")
def generate_taboo_words():
    scenarios = [
        {"topic": "How to cook rice", "banned_words": ["Rice", "Water", "Cooker", "Eat"]},
        {"topic": "How to ride a bike", "banned_words": ["Pedal", "Wheels", "Balance", "Ride"]},
        {"topic": "Explain what a database is", "banned_words": ["Data", "Store", "SQL", "Table"]},
        {"topic": "How to make a sandwich", "banned_words": ["Bread", "Meat", "Eat", "Cheese"]}
    ]
    return random.choice(scenarios)

@router.get("/generate/elevator-pitch")
def generate_elevator_pitch():
    scenarios = [
        {"scenario": "Pitch your app idea to a billionaire in an elevator."},
        {"scenario": "Pitch yourself for your dream job to the CEO in 30 seconds."},
        {"scenario": "Convince a busy investor why your startup will change the world."},
        {"scenario": "Pitch your thesis topic to a skeptical professor."}
    ]
    return random.choice(scenarios)

@router.get("/generate/rephrase")
def generate_rephrase():
    paragraphs = [
        "In the event of an unforeseen exigency, it is imperative that personnel evacuate the premises expeditiously using the designated egress routes to ensure maximal survivability.",
        "The utilization of heterogeneous data structures facilitates the optimization of algorithmic complexity, thereby ameliorating the latency inherent in synchronous processing paradigms.",
        "Notwithstanding the aforementioned stipulations, the contractual obligations remain binding in perpetuity unless mutually abrogated by all signatory parties involved in the agreement."
    ]
    return {"text": random.choice(paragraphs)}

@router.get("/generate/positive-framing")
def generate_positive_framing():
    complaints = [
        "Your app is slow, full of bugs, and completely ruined my project!",
        "I have been waiting on hold for an hour, your customer service is terrible and incompetent.",
        "The product arrived broken and it's cheaply made. I demand a refund right now.",
        "You completely ignored my email and missed the deadline, you are highly unprofessional."
    ]
    return {"complaint": random.choice(complaints)}

# --- Generator Endpoints (Hard) ---

@router.get("/generate/hard/crisis")
def generate_crisis():
    scenarios = [
        "Your system got hacked and user data leaked!",
        "A critical bug caused your company's main app to crash globally for 24 hours.",
        "Your new product launch caught on fire during a live demonstration.",
        "A top executive was caught embezzling funds from the charity division."
    ]
    reporter_questions = [
        "Why did you hide this from the public?!",
        "Who is taking responsibility for this disaster?",
        "What are you doing to fix this right now?",
        "Are you going to resign over this?",
        "How can users ever trust you again?",
        "Is it true you knew about this for weeks?"
    ]
    return {
        "scenario": random.choice(scenarios),
        "questions": random.sample(reporter_questions, 4)
    }

@router.post("/hard/negotiation/turn")
def negotiation_turn(request: NegotiationTurnRequest):
    """Simple logic tree to simulate a negotiation bot."""
    msg = request.user_message.lower()
    
    if request.turn_number >= 5:
        return {
            "response": "This is our final offer. We cannot negotiate further and will have to rescind the offer. Have a good day.", 
            "agreement_reached": False, 
            "new_offer": request.current_offer, 
            "is_game_over": True
        }
        
    if "agree" in msg or "accept" in msg or "deal" in msg or "sounds good" in msg:
        return {
            "response": "Great, we have a deal! Welcome to the team.", 
            "agreement_reached": True, 
            "new_offer": request.current_offer, 
            "is_game_over": True
        }
        
    if "benefits" in msg or "stock" in msg or "equity" in msg or "vacation" in msg or "bonus" in msg:
        return {
            "response": "We can offer 5 extra vacation days and some stock options, but the base salary remains strictly fixed. Does that work for you?", 
            "agreement_reached": False, 
            "new_offer": request.current_offer,
            "is_game_over": False
        }
        
    if request.current_offer < 40000:
        new_offer = request.current_offer + 2000
        return {
            "response": f"We can bump it up slightly to ₱{new_offer}, but that is absolutely our ceiling given our budget constraint. Take it or leave it.", 
            "agreement_reached": False, 
            "new_offer": new_offer,
            "is_game_over": False
        }
        
    return {
        "response": "That's completely out of our budget given the current market conditions. What else can you offer to justify that rate?", 
        "agreement_reached": False, 
        "new_offer": request.current_offer,
        "is_game_over": False
    }


# --- Session Endpoints ---

@router.post("/start", response_model=DrillSessionResponse)
def start_drill_session(request: DrillStartRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Initializes a new drill session."""
    session = DrillSession(
        user_id=current_user.id,
        drill_level=request.drill_level,
        drill_type=request.drill_type
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session

@router.get("/", response_model=List[DrillSessionResponse])
def get_user_drill_sessions(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Fetches all past drill sessions for the user."""
    sessions = db.query(DrillSession).filter(DrillSession.user_id == current_user.id).order_by(DrillSession.start_time.desc()).all()
    return sessions

@router.post("/{session_id}/complete", response_model=DrillSessionResponse)
def complete_drill_session(session_id: int, request: DrillCompleteRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Completes the drill session and saves evaluation data."""
    session = db.query(DrillSession).filter(DrillSession.id == session_id, DrillSession.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Drill session not found.")
        
    if session.status == "completed":
        return session
        
    try:
        session.score = request.score
        session.passed = request.passed
        session.feedback_summary = request.feedback_summary
        
        if request.evaluation_data:
            session.evaluation_data = json.dumps(request.evaluation_data)
            
        session.status = "completed"
        session.end_time = datetime.datetime.utcnow()
        
        db.commit()
        db.refresh(session)
        
        return session
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save drill evaluation: {e}")

@router.get("/{session_id}", response_model=DrillSessionResponse)
def get_drill_session(session_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Gets details of a specific drill session."""
    session = db.query(DrillSession).filter(DrillSession.id == session_id, DrillSession.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Drill session not found.")
    return session
