import unittest

from fastapi import HTTPException

from core.offline_drill_prompt import (
    InvalidDrillDepartmentError,
    V2_FIELD_POOLS,
    V2_SHARED_POOLS,
    format_offline_drill_prompt,
    get_offline_drill_prompt,
)
from schemas.offline_sync import OfflineSyncRequest
from services.offline_sync import validate_sync_payload


class OfflineDrillPromptTests(unittest.TestCase):
    def test_v2_department_pools_and_frontend_fixture_parity(self):
        # These sample-id values are also asserted against the TypeScript pack.
        expected_fast_words = {"CCIT": "Backend", "CTE": "Pedagogy", "CBAPA": "Budgeting"}
        expected_jobs = {"CCIT": "Data Analyst", "CTE": "Training Facilitator", "CBAPA": "Marketing Associate"}
        for department in expected_fast_words:
            with self.subTest(department=department):
                word = get_offline_drill_prompt("fast_word", "sample-id", version="drills-v2", department=department)["word"]
                job = get_offline_drill_prompt("fake_profile", "sample-id", version="drills-v2", department=department)["job"]
                self.assertEqual(word, expected_fast_words[department])
                self.assertEqual(job, expected_jobs[department])
                self.assertIn(word, V2_FIELD_POOLS["fast_word"][department])
                self.assertIn(job, V2_FIELD_POOLS["fake_profile_jobs"][department])

    def test_v2_field_biased_drills_use_only_shared_or_owned_content(self):
        for department in ("CCIT", "CTE", "CBAPA"):
            for drill_type, field_key, output_key in (
                ("taboo", "taboo", None),
                ("elevator_pitch", "elevator_pitch", "scenario"),
                ("rephrase", "rephrase", "text"),
                ("positive_framing", "positive_framing", "complaint"),
                ("crisis", "crisis_scenarios", "scenario"),
            ):
                with self.subTest(department=department, drill_type=drill_type):
                    allowed = V2_SHARED_POOLS[field_key] + V2_FIELD_POOLS[field_key][department]
                    seen = []
                    for index in range(40):
                        prompt = get_offline_drill_prompt(drill_type, f"sample-{index}", version="drills-v2", department=department)
                        content = prompt if output_key is None else prompt[output_key]
                        self.assertIn(content, allowed)
                        seen.append(content)
                    self.assertIn(V2_FIELD_POOLS[field_key][department][0], seen)

    def test_neutral_v2_drills_and_negotiation_remain_shared(self):
        for drill_type in ("jam", "emotion", "synonym", "emoji_story", "negotiation"):
            prompts = [get_offline_drill_prompt(drill_type, "same-id", version="drills-v2", department=department)
                       for department in ("CCIT", "CTE", "CBAPA")]
            self.assertEqual(prompts, [prompts[0]] * 3)

    def test_v2_determinism_and_legacy_v1_are_distinct(self):
        for department in ("CCIT", "CTE", "CBAPA"):
            prompt = get_offline_drill_prompt("fast_word", "sample-id", version="drills-v2", department=department)
            self.assertEqual(prompt, get_offline_drill_prompt("fast_word", "sample-id", version="drills-v2", department=department))
        self.assertEqual(get_offline_drill_prompt("fast_word", "sample-id", version="drills-v1", department="CTE"), {"word": "Python"})
        self.assertEqual(get_offline_drill_prompt("fast_word", "sample-id"), {"word": "Python"})
        self.assertEqual(
            get_offline_drill_prompt("fast_word", "sample-id", version="drills-v2", department=" cte "),
            get_offline_drill_prompt("fast_word", "sample-id", version="drills-v2", department="CTE"),
        )

    def test_v2_invalid_department_and_cross_department_prompt_are_rejected(self):
        for invalid in (None, "", "unknown"):
            with self.assertRaises(InvalidDrillDepartmentError):
                get_offline_drill_prompt("fast_word", "sample-id", version="drills-v2", department=invalid)
        ccit_prompt = get_offline_drill_prompt("fast_word", "sample-id", version="drills-v2", department="CCIT")
        base = {
            "client_session_id": "sample-id", "activity_type": "drill", "question_pack_version": "drills-v2",
            "answers": [{"step": 1, "text": "I can explain the concept clearly."}],
            "activity_state": {"drillType": "fast_word", "drillLevel": "easy", "prompt": format_offline_drill_prompt(ccit_prompt)},
        }
        with self.assertRaises(HTTPException) as error:
            validate_sync_payload(OfflineSyncRequest.model_validate(base), "CTE")
        self.assertEqual(error.exception.status_code, 409)
        with self.assertRaises(HTTPException) as error:
            validate_sync_payload(OfflineSyncRequest.model_validate(base), "unknown")
        self.assertEqual(error.exception.status_code, 403)

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
