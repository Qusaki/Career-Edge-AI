import json
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


OfflineActivityType = Literal[
    "pre_test_intro",
    "pre_test_active_listening",
    "post_test",
    "drill",
    "upcoming",
    "thesis",
]


class OfflineSyncAnswer(BaseModel):
    step: int = Field(ge=1, le=10)
    text: str = Field(min_length=1, max_length=8_000)
    created_at: int | None = Field(default=None, ge=0)


class OfflineSyncConversationTurn(BaseModel):
    sender: Literal["user", "ai"]
    text: str = Field(min_length=1, max_length=8_000)


class OfflineSyncEyeContact(BaseModel):
    score: float | None = Field(default=None, ge=0, le=100)
    samples: int = Field(ge=0, le=1_000_000)


class OfflineSyncAudioManifestItem(BaseModel):
    audio_id: str = Field(min_length=1, max_length=128)
    turn_id: str = Field(min_length=1, max_length=128)
    answer_index: int = Field(ge=1, le=10)
    mime_type: str = Field(min_length=1, max_length=128)
    size_bytes: int = Field(ge=1, le=25 * 1024 * 1024)
    duration_ms: int = Field(ge=0, le=5 * 60 * 1_000)
    transcript_status: Literal["available", "pending", "not_requested"]


class OfflineSyncRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_session_id: str = Field(min_length=1, max_length=128)
    activity_type: OfflineActivityType
    question_pack_version: str = Field(min_length=1, max_length=64)
    server_session_id: int | None = Field(default=None, ge=1)
    answers: list[OfflineSyncAnswer] = Field(min_length=1, max_length=10)
    conversation_log: list[OfflineSyncConversationTurn] = Field(default_factory=list, max_length=20)
    activity_state: dict[str, Any] = Field(default_factory=dict)
    eye_contact_summary: OfflineSyncEyeContact | None = None
    audio_manifest: list[OfflineSyncAudioManifestItem] = Field(default_factory=list, max_length=10)
    local_score: float | None = None
    local_evaluation: dict[str, Any] | None = None
    evaluation_authority: str | None = Field(default=None, max_length=64)

    @model_validator(mode="after")
    def validate_activity_contract(self):
        if any(not answer.text.strip() for answer in self.answers):
            raise ValueError("Answers cannot be empty.")
        if any(not turn.text.strip() for turn in self.conversation_log):
            raise ValueError("Conversation turns cannot be empty.")
        expected = {
            "pre_test_intro": (1, 1),
            "pre_test_active_listening": (1, 10),
            "post_test": (5, 5),
            "drill": (1, 6),
            "upcoming": (5, 5),
            "thesis": (5, 5),
        }[self.activity_type]
        if not expected[0] <= len(self.answers) <= expected[1]:
            raise ValueError("The answer count does not match the activity contract.")
        if [answer.step for answer in self.answers] != list(range(1, len(self.answers) + 1)):
            raise ValueError("Answer steps must be sequential and start at one.")
        user_turns = [turn for turn in self.conversation_log if turn.sender == "user"]
        if self.activity_type in {"post_test", "upcoming", "thesis"} and len(user_turns) != len(self.answers):
            raise ValueError("Conversation user turns must match the submitted answers.")
        if self.activity_type == "thesis":
            context = self.activity_state.get("thesisAbstractContext", "")
            if not isinstance(context, str) or len(context) > 5_000:
                raise ValueError("Thesis abstract context exceeds the supported limit.")
        question_ids = self.activity_state.get("questionIds")
        if question_ids is not None and (
            not isinstance(question_ids, list)
            or len(question_ids) > 10
            or any(not isinstance(item, str) or not item or len(item) > 128 for item in question_ids)
        ):
            raise ValueError("Question identifiers are invalid.")
        if len(json.dumps(self.activity_state, sort_keys=True, default=str).encode("utf-8")) > 32_768:
            raise ValueError("Activity state exceeds the supported limit.")
        return self


class OfflineSyncResponse(BaseModel):
    synchronized: Literal[True] = True
    activity_type: OfflineActivityType
    client_session_id: str
    server_session_id: int
    status: Literal["completed"] = "completed"
    evaluation_authority: Literal["server"] = "server"
    authoritative_result: dict[str, Any]
    completed_at: datetime
    idempotent_replay: bool = False
