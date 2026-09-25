import json
import unittest

from core.response_quality import intro_quality_cap, repetition_dominated
from services.ai_provider import AIProviderUnavailableError
from services.assessment_scoring import (
    COMMUNICATION_KEYS, DRILL_KEYS, DRILL_TASKS, INTRO_KEYS, score_drill, score_intro,
    score_listening, score_post_test, validate_assessment_response,
)


class FakeProvider:
    model = "test-model"

    def __init__(self, result):
        self.result = result
        self.messages = None
        self.calls = 0

    async def stream_chat(self, messages, workload=None):
        self.messages = messages
        self.calls += 1
        yield json.dumps(self.result)


class FailingProvider:
    model = "test-model"

    async def stream_chat(self, messages, workload=None):
        raise AIProviderUnavailableError("offline")
        yield ""  # pragma: no cover


def high(keys, maximum, **extra):
    return {
        **{key: maximum for key in keys}, "task_alignment": maximum,
        "total_score": len(keys) * maximum, "feedback_summary": "Relevant and coherent response.",
        **({"score_vocabulary": 5, "score_grammar": 5} if keys == INTRO_KEYS else {}),
        **extra,
    }


STORY = (
    "The workshop begins at eight thirty in the multimedia hall. Arrive by eight fifteen. "
    "Bring one laptop, two printed action plans, and a flash drive. If the projector fails, "
    "move to Room 204. Submit the attendance sheet and revised action plan to Ms. Reyes."
)
POST_ANSWERS = [
    "I improved my presentation skill by practicing short explanations with classmates and asking them which points were unclear.",
    "When I taught a database concept, I used a library analogy and checked understanding with a small example.",
    "Our project failed during a demonstration, so I isolated the error, tested a correction, and documented the lesson.",
    "I would listen to my teammate's concern, explain the evidence respectfully, and propose a decision we can both support.",
    "I still want to improve public speaking, so I will rehearse weekly, record myself, and request constructive feedback.",
]
INTRO = (
    "My name is John. I am a Computer Science student. I enjoy building automation tools "
    "and my strength is explaining technical ideas clearly. I am preparing for interviews "
    "because my career goal is to develop useful software with a collaborative team."
)


class AssessmentScoringTests(unittest.IsolatedAsyncioTestCase):
    async def test_strong_intro_can_score_high(self):
        result = await score_intro(INTRO, FakeProvider(high(INTRO_KEYS, 3)))
        self.assertEqual(result["total_score"], 15)

    async def test_repetitive_intro_cannot_score_near_perfect(self):
        result = await score_intro("hello my name is " * 15, FakeProvider(high(INTRO_KEYS, 3)))
        self.assertEqual(result["total_score"], 5)

    async def test_fluent_off_topic_intro_is_capped_by_semantic_alignment(self):
        provider = FakeProvider(high(INTRO_KEYS, 3, task_alignment=1))
        answer = (
            "My name appears in a novel about a student studying interest rates at a university. "
            "The book describes a strength of its fictional hero, and its career goal is to teach readers "
            "about the history of banking. I am describing the novel rather than myself."
        )
        self.assertIsNone(intro_quality_cap(answer)[0])
        result = await score_intro(answer, provider)
        self.assertEqual(result["total_score"], 5)
        self.assertIn("self-introduction", result["feedback_summary"])

    async def test_complete_listening_story_can_score_high(self):
        result = await score_listening(STORY, STORY, FakeProvider(high(COMMUNICATION_KEYS, 5)))
        self.assertEqual(result["total_score"], 25)

    async def test_partial_listening_summary_loses_coverage(self):
        provider = FakeProvider(high(COMMUNICATION_KEYS, 5, task_alignment=3))
        result = await score_listening(STORY, "The workshop starts at eight thirty in the multimedia hall.", provider)
        self.assertLessEqual(result["total_score"], 15)

    async def test_almost_no_listening_facts_cannot_score_near_perfect(self):
        result = await score_listening(STORY, "I think it was a nice story.", FakeProvider(high(COMMUNICATION_KEYS, 5)))
        self.assertLessEqual(result["total_score"], 10)

    async def test_unrelated_fluent_listening_response_is_penalized(self):
        result = await score_listening(STORY, "My favorite computer has sixteen gigabytes of RAM and I use it for coding every day.", FakeProvider(high(COMMUNICATION_KEYS, 5)))
        self.assertLessEqual(result["total_score"], 10)

    async def test_jam_relevant_answer_can_score_high(self):
        answer = "The ocean supports many ecosystems. Coral reefs shelter fish, while currents carry nutrients across distant habitats. Protecting marine life helps coastal communities and future generations."
        result = await score_drill("jam", {"prompt": {"topic": "The Ocean"}, "spoken_response": answer}, FakeProvider(high(DRILL_KEYS, 5)))
        self.assertEqual(result["scoring"]["raw_score"], 30)

    async def test_jam_fluent_off_topic_answer_cannot_score_high(self):
        answer = "My favorite computer has sixteen gigabytes of RAM and I use it for coding. Its keyboard feels nice, and the software compiles my programs quickly."
        result = await score_drill("jam", {"prompt": {"topic": "The Ocean"}, "spoken_response": answer}, FakeProvider(high(DRILL_KEYS, 5, task_alignment=1)))
        self.assertLessEqual(result["scoring"]["raw_score"], 12)

    async def test_nonsensical_drill_answer_cannot_score_high(self):
        answer = "Purple calendars quietly negotiate with clouds while invisible chairs calculate happiness in a spinning room."
        result = await score_drill("crisis", {"prompt": {"scenario": "User data leaked."}, "spoken_response": answer}, FakeProvider(high(DRILL_KEYS, 5, task_alignment=1)))
        self.assertLessEqual(result["score"], 40)

    async def test_incorrect_synonym_is_penalized(self):
        result = await score_drill("synonym", {"prompt": {"word": "Happy"}, "spoken_response": "Sad"}, FakeProvider(high(DRILL_KEYS, 5, task_alignment=1)))
        self.assertLessEqual(result["scoring"]["criteria"]["task_completion"], 2)

    async def test_taboo_violation_is_objectively_capped(self):
        result = await score_drill("taboo", {"prompt": {"topic": "How to cook rice", "banned_words": ["Rice", "Water"]}, "spoken_response": "First put rice in a pot, then add a measured amount of liquid and heat it carefully."}, FakeProvider(high(DRILL_KEYS, 5)))
        self.assertEqual(result["scoring"]["criteria"]["task_completion"], 1)
        self.assertLessEqual(result["scoring"]["raw_score"], 11)

    async def test_rephrase_copy_is_objectively_capped(self):
        source = "Please evacuate the building immediately using the marked exits."
        result = await score_drill("rephrase", {"prompt": {"text": source}, "spoken_response": source}, FakeProvider(high(DRILL_KEYS, 5)))
        self.assertEqual(result["scoring"]["criteria"]["task_completion"], 1)

    async def test_fake_profile_missing_assigned_details_is_capped(self):
        result = await score_drill("fake_profile", {
            "prompt": {"name": "Alex", "age": 22, "job": "Pilot", "hobby": "Reading"},
            "spoken_response": "I am a friendly person who likes traveling and meeting new people at different places during the year.",
        }, FakeProvider(high(DRILL_KEYS, 5)))
        self.assertEqual(result["scoring"]["criteria"]["task_completion"], 1)

    async def test_negotiation_irrelevance_is_penalized(self):
        result = await score_drill("negotiation", {"prompt": {"scenario": "Negotiate a starting salary."}, "negotiation_messages": [{"sender": "user", "text": "My computer has lots of RAM and a large screen."}]}, FakeProvider(high(DRILL_KEYS, 5, task_alignment=1)))
        self.assertLessEqual(result["score"], 40)

    async def test_crisis_irrelevance_is_penalized(self):
        result = await score_drill("crisis", {"prompt": {"scenario": "User data leaked."}, "spoken_response": "I really enjoy cooking vegetables, making soup for dinner, and visiting the local market with my family on weekends."}, FakeProvider(high(DRILL_KEYS, 5, task_alignment=1)))
        self.assertLessEqual(result["score"], 40)

    async def test_all_twelve_drills_have_distinct_task_specific_instructions(self):
        for drill_type, instruction in DRILL_TASKS.items():
            with self.subTest(drill_type=drill_type):
                provider = FakeProvider(high(DRILL_KEYS, 5))
                answer = "I would explain the assigned situation clearly, identify the main concern, and give a relevant practical response."
                data = {"prompt": {"scenario": "A specific exercise"}, "spoken_response": answer}
                if drill_type == "negotiation":
                    data["negotiation_messages"] = [{"sender": "user", "text": answer}]
                result = await score_drill(drill_type, data, provider)
                self.assertIn(instruction, provider.messages[0]["content"])
                self.assertEqual(result["scoring"]["rubric_version"], "drill-hybrid-v1")

    async def test_post_test_five_answers_alone_do_not_create_high_score(self):
        questions = [f"Question {index}" for index in range(5)]
        answers = [f"Answer {index}" for index in range(5)]
        result = await score_post_test(questions, answers, FakeProvider(high(COMMUNICATION_KEYS, 5, answer_relevance=[1] * 5)))
        self.assertLessEqual(result["total_score"], 10)

    async def test_post_test_relevant_five_answers_can_score_high(self):
        questions = [f"Question {index}" for index in range(5)]
        answers = POST_ANSWERS
        result = await score_post_test(questions, answers, FakeProvider(high(COMMUNICATION_KEYS, 5, answer_relevance=[5] * 5)))
        self.assertEqual(result["total_score"], 25)

    async def test_one_irrelevant_post_test_answer_loses_rubric_points(self):
        questions = [f"Question {index}" for index in range(5)]
        answers = POST_ANSWERS
        result = await score_post_test(questions, answers, FakeProvider(high(COMMUNICATION_KEYS, 5, answer_relevance=[5, 5, 1, 5, 5])))
        self.assertEqual(result["total_score"], 20)

    async def test_repetition_is_conservative(self):
        self.assertTrue(repetition_dominated("hello my name is " * 15))
        self.assertFalse(repetition_dominated("This is very, very important because the deadline is tomorrow and our team needs time to prepare."))

    async def test_malformed_missing_out_of_range_and_total_are_rejected(self):
        base = high(INTRO_KEYS, 3)
        for raw in ("not-json", json.dumps({key: value for key, value in base.items() if key != "score_clarity"}),
                    json.dumps({**base, "score_clarity": 4}), json.dumps({**base, "score_clarity": "3"}),
                    json.dumps({**base, "total_score": 14}), json.dumps({**base, "score_clarity": float("nan")}),
                    json.dumps({**base, "unexpected": 1}),
                    json.dumps({**base, "feedback_summary": "Most details were missing and the response was largely off-topic."})):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                validate_assessment_response(raw, INTRO_KEYS, 3)

    async def test_provider_failure_is_identifiable_conservative_fallback(self):
        result = await score_intro(INTRO, FailingProvider())
        self.assertEqual(result["total_score"], 9)
        self.assertEqual(result["scoring_authority"], "deterministic_fallback")

    async def test_long_response_does_not_raise_fallback_score(self):
        result = await score_drill("jam", {"prompt": {"topic": "The Ocean"}, "spoken_response": "Computer processors enable software applications to run efficiently. " * 20}, FailingProvider())
        self.assertLessEqual(result["score"], 40)

    async def test_only_canonical_argument_is_sent_to_provider(self):
        provider = FakeProvider(high(INTRO_KEYS, 3))
        await score_intro(INTRO, provider)
        submitted = json.loads(provider.messages[1]["content"])
        self.assertEqual(submitted["committed_answer"], INTRO)
        self.assertNotIn("interimTranscript", provider.messages[1]["content"])


if __name__ == "__main__":
    unittest.main()
