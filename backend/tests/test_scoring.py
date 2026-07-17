import math
import unittest

from core.scoring import bounded_integer_score, bounded_score


class ScoreBoundaryTests(unittest.TestCase):
    def test_percentage_scores_are_clamped(self):
        self.assertEqual(bounded_score({"score": 140}, "score", minimum=0, maximum=100, default=0), 100)
        self.assertEqual(bounded_score({"score": -20}, "score", minimum=0, maximum=100, default=0), 0)

    def test_numeric_strings_are_accepted(self):
        self.assertEqual(bounded_score({"score": "72.5"}, "score", minimum=0, maximum=100, default=0), 72.5)

    def test_invalid_and_non_finite_scores_use_default(self):
        self.assertEqual(bounded_score({"score": "bad"}, "score", minimum=0, maximum=100, default=25), 25)
        self.assertEqual(bounded_score({"score": math.inf}, "score", minimum=0, maximum=100, default=25), 25)

    def test_rubric_integer_scores_are_rounded_and_clamped(self):
        self.assertEqual(bounded_integer_score({"score": 4.6}, "score", minimum=1, maximum=5, default=1), 5)
        self.assertEqual(bounded_integer_score({"score": 99}, "score", minimum=1, maximum=5, default=1), 5)


if __name__ == "__main__":
    unittest.main()
