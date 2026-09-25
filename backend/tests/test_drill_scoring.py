import unittest

from core.drill_scoring import calculate_drill_score


def words(count: int) -> str:
    return " ".join(f"word{index}" for index in range(count))


class DrillScoringTests(unittest.TestCase):
    def test_proficient_spoken_response_passes(self):
        result = calculate_drill_score("jam", {"spoken_response": words(60)})
        self.assertEqual(result["scoring"]["raw_score"], 23)
        self.assertEqual(result["score"], 76.67)
        self.assertTrue(result["passed"])

    def test_developing_spoken_response_does_not_pass(self):
        result = calculate_drill_score("jam", {"spoken_response": words(30)})
        self.assertEqual(result["scoring"]["raw_score"], 19)
        self.assertEqual(result["score"], 63.33)
        self.assertFalse(result["passed"])

    def test_short_spoken_response_uses_beginning_score(self):
        result = calculate_drill_score("jam", {"spoken_response": "brief response"})
        self.assertEqual(result["scoring"]["raw_score"], 15)
        self.assertEqual(result["score"], 50.0)
        self.assertFalse(result["passed"])

    def test_five_negotiation_turns_pass(self):
        messages = [{"sender": "user", "text": f"Response {index}"} for index in range(5)]
        result = calculate_drill_score("negotiation", {"negotiation_messages": messages})
        self.assertEqual(result["scoring"]["measured_value"], 5)
        self.assertEqual(result["score"], 76.67)
        self.assertTrue(result["passed"])

    def test_empty_response_cannot_be_scored(self):
        with self.assertRaisesRegex(ValueError, "spoken response is required"):
            calculate_drill_score("jam", {})

    def test_repeated_or_off_topic_jam_loses_task_points(self):
        relevant = calculate_drill_score("jam", {
            "spoken_response": "Coffee helps me start the morning because its aroma makes our kitchen welcoming. "
            "I learned about beans from farmers who explained roasting temperatures and fresh grinding. "
            "At school my friends discuss different flavors while sharing stories after difficult classes. "
            "I also compare brewing methods, preparation time, and cost before choosing a cup for the day. "
            "These small routines make conversations easier and give our group a pleasant break from work.",
            "prompt": {"topic": "Coffee"},
        })
        repeated = calculate_drill_score("jam", {
            "spoken_response": "coffee coffee coffee coffee " * 16,
            "prompt": {"topic": "Coffee"},
        })
        off_topic = calculate_drill_score("jam", {
            "spoken_response": words(60),
            "prompt": {"topic": "Coffee"},
        })
        self.assertGreater(relevant["score"], repeated["score"])
        self.assertGreater(relevant["score"], off_topic["score"])
        self.assertEqual(off_topic["scoring"]["criteria"]["task_completion"], 1)


if __name__ == "__main__":
    unittest.main()
