import unittest

from fastapi import HTTPException

from core.offline_drill_prompt import format_offline_drill_prompt, get_offline_drill_prompt
from schemas.offline_sync import OfflineSyncRequest
from services.offline_sync import validate_sync_payload


class OfflineDrillPromptTests(unittest.TestCase):
    def test_versioned_frontend_pack_parity_for_all_twelve_drills(self):
        # Fixture generated from getOfflineDrillPrompt(type, 'sample-id') in questionPacks.ts.
        expected = {
            "jam": {"topic": "Smartphones"},
            "fast_word": {"word": "Python"},
            "emotion": {"sentence": "It's time to go home.", "emotion": "Joyful"},
            "synonym": {"word": "Happy"},
            "fake_profile": {"name": "Casey", "age": 41, "job": "Chef", "hobby": "Reading"},
            "emoji_story": {"emojis": ["👻", "🌮", "🎸"]},
            "positive_framing": {"complaint": "I have been waiting on hold for an hour, your customer service is terrible and incompetent."},
            "taboo": {"topic": "How to cook rice", "banned_words": ["Rice", "Water", "Cooker", "Eat"]},
            "elevator_pitch": {"scenario": "Pitch your app idea to a billionaire in an elevator."},
            "rephrase": {"text": "The utilization of heterogeneous data structures facilitates the optimization of algorithmic complexity, thereby ameliorating the latency inherent in synchronous processing paradigms."},
            "negotiation": {"scenario": "You are negotiating a starting salary. The employer opens with ₱35,000 and is strict about the budget.", "instruction": "Reply professionally. You can accept, negotiate salary, or ask about benefits."},
            "crisis": {"scenario": "Your new product launch caught on fire during a live demonstration.", "questions": ["Who is taking responsibility for this disaster?", "What are you doing to fix this right now?", "How can users ever trust you again?", "Why did you hide this from the public?!"]},
        }
        for drill_type, prompt in expected.items():
            with self.subTest(drill_type=drill_type):
                self.assertEqual(get_offline_drill_prompt(drill_type, "sample-id"), prompt)

    def test_submitted_offline_prompt_cannot_replace_pack_prompt(self):
        prompt = get_offline_drill_prompt("jam", "sample-id")
        base = {
            "client_session_id": "sample-id", "activity_type": "drill", "question_pack_version": "drills-v1",
            "answers": [{"step": 1, "text": "I can discuss the assigned topic clearly."}],
            "activity_state": {"drillType": "jam", "drillLevel": "easy", "prompt": format_offline_drill_prompt(prompt)},
        }
        validate_sync_payload(OfflineSyncRequest.model_validate(base), "CCIT")
        base["activity_state"]["prompt"] = "Topic: A completely different subject"
        with self.assertRaises(HTTPException) as error:
            validate_sync_payload(OfflineSyncRequest.model_validate(base), "CCIT")
        self.assertEqual(error.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
