import unittest

from core.response_quality import (
    cap_rubric,
    intro_quality_cap,
    listening_quality_cap,
    post_test_quality_cap,
    repetition_dominated,
    validate_five_point_scores,
)
from routers.pre_test_active_listening import ACTIVE_LISTENING_PROMPTS


class ResponseQualityTests(unittest.TestCase):
    def test_legitimate_repeated_words_are_preserved(self):
        self.assertFalse(repetition_dominated("This is very very important because the workshop schedule changed and each group needs a laptop."))

    def test_repeated_fragments_cannot_receive_a_high_intro_score(self):
        answer = "hello my name is Juan " * 15
        cap, reason = intro_quality_cap(answer)
        self.assertEqual(cap, 1)
        adjusted = cap_rubric({"score_clarity": 3, "score_completeness": 3, "feedback_summary": "Excellent."}, ("score_clarity", "score_completeness"), cap, reason)
        self.assertEqual(adjusted["score_clarity"], 1)
        self.assertNotIn("Excellent", adjusted["feedback_summary"])

    def test_substantive_introduction_can_keep_full_rubric_range(self):
        answer = (
            "My name is Juan. I am a computer science student in the technology department. "
            "I enjoy building useful software and learning how teams solve difficult problems. "
            "My strength is explaining technical ideas clearly to classmates. I am preparing for interviews "
            "because my career goal is to develop reliable tools for students and local communities."
        )
        self.assertEqual(intro_quality_cap(answer), (None, None))

    def test_listening_coverage_is_derived_from_the_actual_story(self):
        story = ACTIVE_LISTENING_PROMPTS[1]
        incomplete = "The workshop starts at eight thirty."
        complete = (
            "The student leadership workshop begins at eight thirty in the multimedia hall, with arrival by "
            "eight fifteen for attendance and seats. Each group needs one laptop, two printed action plans "
            "and a backup on a flash drive. The morning covers problem identification, lunch is from twelve "
            "to one, and the afternoon is for presentation practice. If the projector fails, they move to "
            "Room 204 but registration stays near the lobby. Group leaders submit the attendance sheet and "
            "revised plan to Ms. Reyes after the final presentation."
        )
        self.assertEqual(listening_quality_cap(story, incomplete)[0], 2)
        self.assertIsNone(listening_quality_cap(story, complete)[0])
        self.assertEqual(listening_quality_cap(story, "unrelated banana clouds " * 20)[0], 2)

    def test_post_test_repeated_or_sparse_answers_lose_top_marks(self):
        self.assertEqual(post_test_quality_cap(["I can do it."] * 5)[0], 2)
        self.assertEqual(post_test_quality_cap([f"Answer {index}." for index in range(5)])[0], 3)
        complete = [
            "I improved my communication skill by explaining complex ideas to classmates during group work.",
            "I taught a teammate a technical concept using a diagram and checked their understanding afterward.",
            "When a project failed, I isolated the cause, tested alternatives, and documented what I learned.",
            "I would listen to my teammate's concern, explain my evidence respectfully, and agree on a plan.",
            "I want to improve public speaking by practicing weekly and asking for specific feedback.",
        ]
        self.assertIsNone(post_test_quality_cap(complete)[0])

    def test_malformed_ai_rubric_is_rejected_instead_of_defaulting_high(self):
        keys = ("score_clarity",)
        for value in (float("nan"), float("inf"), 6, 0, True, "5"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_five_point_scores({"score_clarity": value}, keys)
        validate_five_point_scores({"score_clarity": 5}, keys)


if __name__ == "__main__":
    unittest.main()
