"""Deterministic, session-backed Salary Negotiation turn decisions."""

import json
import re
from dataclasses import asdict, dataclass, field
from typing import Literal


NegotiationStatus = Literal["negotiating", "agreed", "closed"]
INITIAL_OFFER = 35000
AGREEMENT_CLOSING = "You're welcome. We look forward to working with you."
NO_AGREEMENT_CLOSING = "Thank you for your time. Have a good day."


@dataclass
class NegotiationSnapshot:
    status: NegotiationStatus = "negotiating"
    current_offer: int = INITIAL_OFFER
    accepted_salary: int | None = None
    turn_number: int = 0
    messages: list[dict[str, str]] = field(default_factory=list)
    last_response: str = ""


def load_negotiation_snapshot(raw: str | None) -> NegotiationSnapshot:
    if not raw:
        return NegotiationSnapshot()
    try:
        value = json.loads(raw).get("negotiation_state")
        if not isinstance(value, dict):
            return NegotiationSnapshot()
        status = value.get("status")
        offer = value.get("current_offer")
        salary = value.get("accepted_salary")
        turn = value.get("turn_number")
        messages = value.get("messages")
        response = value.get("last_response")
        if (status not in {"negotiating", "agreed", "closed"}
                or type(offer) is not int or not 0 < offer <= 1_000_000
                or (salary is not None and (type(salary) is not int or salary != offer))
                or (status == "agreed" and salary is None)
                or type(turn) is not int or turn < 0
                or not isinstance(messages, list) or not isinstance(response, str)):
            return NegotiationSnapshot()
        if any(not isinstance(item, dict) or item.get("sender") not in {"user", "bot"}
               or not isinstance(item.get("text"), str) for item in messages):
            return NegotiationSnapshot()
        return NegotiationSnapshot(status, offer, salary, turn, messages, response)
    except (TypeError, ValueError, AttributeError):
        return NegotiationSnapshot()


def serialize_negotiation_snapshot(snapshot: NegotiationSnapshot) -> str:
    return json.dumps({"negotiation_state": asdict(snapshot)}, ensure_ascii=False)


def is_clear_acceptance(message: str, current_offer: int) -> bool:
    text = message.casefold().replace("’", "'").strip()
    if not text or "?" in text:
        return False
    if re.search(r"\b(?:don't|do not|not|can't|cannot|won't)\s+(?:want to\s+)?(?:accept|agree|take)\b", text):
        return False
    if re.search(r"\b(?:too low|still low|think about it|more|higher|increase|raise|counter|negotiate|instead)\b", text):
        return False
    if re.search(r"\b(?:can|could|would)\s+you\b|\bwhat about\b|\bbetter benefits\b", text):
        return False
    salary_mentions = [int(number) * 1000 for number in re.findall(r"(?<!\w)(?:₱\s*)?(\d{2,3})(?:\s*k|,?000)\b", text)]
    if any(amount != current_offer for amount in salary_mentions):
        return False
    return bool(
        re.search(r"\b(?:i|we)\s+(?:will\s+|would\s+|can\s+)?accept\b", text)
        or re.search(r"\baccept\s+(?:the\s+|your\s+|this\s+)?(?:offer|salary)\b", text)
        or re.search(r"\b(?:i'll|i will|we'll|we will)\s+take\s+(?:it|the offer)\b", text)
        or re.search(r"\b(?:i|we)\s+agree\b", text)
        or re.search(r"\b(?:that|this|the offer|\d{2,3}\s*k|\d{2,3},?000)\s+works\s+for\s+me\b", text)
        or re.fullmatch(r"(?:okay[,! ]*)?(?:deal|it's a deal|we have a deal)[.!]*", text)
        or re.fullmatch(r"(?:okay[,! ]*)?sounds good[.!]*", text)
    )


def turn_response(snapshot: NegotiationSnapshot) -> dict[str, object]:
    return {
        "response": snapshot.last_response,
        "agreement_reached": snapshot.accepted_salary is not None,
        "new_offer": snapshot.current_offer,
        "accepted_salary": snapshot.accepted_salary,
        "negotiation_state": snapshot.status,
        "is_game_over": snapshot.status != "negotiating",
    }


def advance_negotiation(snapshot: NegotiationSnapshot, user_message: str) -> NegotiationSnapshot:
    if snapshot.status == "closed":
        return snapshot

    message = user_message.strip()
    if snapshot.status == "agreed":
        response = AGREEMENT_CLOSING
        status: NegotiationStatus = "closed"
        offer = snapshot.current_offer
        salary = snapshot.accepted_salary
    elif is_clear_acceptance(message, snapshot.current_offer):
        status = "agreed"
        offer = snapshot.current_offer
        salary = offer
        response = f"Great, we have a deal at ₱{offer:,}. Welcome to the team."
    elif snapshot.turn_number >= 5:
        status = "closed"
        offer = snapshot.current_offer
        salary = None
        response = "This is our final offer. We cannot negotiate further and will have to rescind the offer. Have a good day."
    elif re.search(r"\b(?:goodbye|bye)\b", message, re.IGNORECASE):
        status = "closed"
        offer = snapshot.current_offer
        salary = None
        response = NO_AGREEMENT_CLOSING
    elif re.search(r"\b(?:thank you|thanks)\b", message, re.IGNORECASE):
        status = "negotiating"
        offer = snapshot.current_offer
        salary = None
        response = "You're welcome. Let me know if you would like to discuss the current offer further."
    elif re.search(r"\b(?:benefits|stock|equity|vacation|bonus)\b", message, re.IGNORECASE):
        status = "negotiating"
        offer = snapshot.current_offer
        salary = None
        response = "We can offer 5 extra vacation days and some stock options, but the base salary remains strictly fixed. Does that work for you?"
    elif snapshot.current_offer < 40000:
        status = "negotiating"
        offer = snapshot.current_offer + 2000
        salary = None
        response = f"We can bump it up slightly to ₱{offer}, but that is absolutely our ceiling given our budget constraint. Take it or leave it."
    else:
        status = "negotiating"
        offer = snapshot.current_offer
        salary = None
        response = "That's completely out of our budget given the current market conditions. What else can you offer to justify that rate?"

    return NegotiationSnapshot(
        status=status,
        current_offer=offer,
        accepted_salary=salary,
        turn_number=snapshot.turn_number + 1,
        messages=[*snapshot.messages, {"sender": "user", "text": message}, {"sender": "bot", "text": response}],
        last_response=response,
    )
