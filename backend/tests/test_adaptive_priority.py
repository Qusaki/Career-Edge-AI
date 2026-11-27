import datetime
import unittest

from core.adaptive_priority import Evidence, select_adaptive_priority


TIME = datetime.datetime(2026, 1, 1)


def item(family, id, scores, *, subtype="", target="", difficulty=""):
    return Evidence(family, id, TIME + datetime.timedelta(days=id), scores, subtype, target, difficulty)


def scores(**overrides):
    return {**dict.fromkeys(("vocabulary", "clarity", "grammar", "conciseness", "courtesy"), 4.0), **overrides}


class AdaptivePriorityTests(unittest.TestCase):
    def test_no_evidence_and_partial_pre_test(self):
        self.assertIsNone(select_adaptive_priority([])["priority_criterion"])
        profile = select_adaptive_priority([item("pre_test", 1, {"grammar": 2.5}, subtype="who_am_i")])
        self.assertEqual(profile["priority_criterion"], "grammar")
        self.assertEqual(profile["confidence"], "limited")

    def test_initial_pre_subtypes_are_equally_combined(self):
        records = [item("pre_test", 1, {"clarity": 2}, subtype="who_am_i"),
                   item("pre_test", 2, {"clarity": 4}, subtype="active_listening"),
                   item("pre_test", 3, {"clarity": 5}, subtype="who_am_i")]
        self.assertEqual(select_adaptive_priority(records)["scores"]["clarity"], 3)

    def test_recent_three_drill_window_and_321_weighting(self):
        records = [item("drill", 1, scores(clarity=1)), item("drill", 2, scores(clarity=2)),
                   item("drill", 3, scores(clarity=3)), item("drill", 4, scores(clarity=4))]
        profile = select_adaptive_priority(records)
        self.assertEqual(profile["scores"]["clarity"], round((4*3+3*2+2)/6, 3))
        self.assertEqual(profile["priority_criterion"], "clarity")

    def test_family_weights_and_pre_decay(self):
        pre = item("pre_test", 1, scores(clarity=1), subtype="who_am_i")
        drill = item("drill", 2, scores(clarity=4))
        post = item("post_test", 3, scores(clarity=5))
        self.assertEqual(select_adaptive_priority([pre, drill, post])["scores"]["clarity"], 3.8)
        more = [item("drill", 4, scores(clarity=4)), item("drill", 5, scores(clarity=4))]
        self.assertEqual(select_adaptive_priority([pre, drill, post, *more])["scores"]["clarity"], 4.5)

    def test_pre_decay_only_counts_later_results(self):
        pre = item("pre_test", 4, scores(clarity=1), subtype="who_am_i")
        earlier = [item("drill", 1, scores(clarity=4)),
                   item("drill", 2, scores(clarity=4)),
                   item("post_test", 3, scores(clarity=4))]
        profile = select_adaptive_priority([*earlier, pre])
        self.assertEqual(profile["scores"]["clarity"], 3.4)

    def test_tie_stability_material_change_and_maintenance(self):
        tied = select_adaptive_priority([item("post_test", 1, scores())])
        self.assertEqual(tied["priority_criterion"], "clarity")
        self.assertTrue(tied["maintenance"])
        records = [item("post_test", 1, scores(clarity=3.0, grammar=2.7)),
                   item("adaptive", 2, scores(clarity=3.0), target="clarity", difficulty="intermediate")]
        self.assertEqual(select_adaptive_priority(records)["priority_criterion"], "clarity")
        changed = [item("post_test", 1, scores(clarity=3.5, grammar=2.0)), records[1]]
        self.assertEqual(select_adaptive_priority(changed)["priority_criterion"], "grammar")

    def test_difficulty_bands_and_two_consecutive_results(self):
        self.assertEqual(select_adaptive_priority([item("drill", 1, scores(clarity=2.9))])["difficulty"], "beginner")
        self.assertEqual(select_adaptive_priority([item("drill", 1, scores(clarity=3.0))])["difficulty"], "intermediate")
        self.assertEqual(select_adaptive_priority([item("drill", 1, scores())])["difficulty"], "advanced")
        base = item("post_test", 1, scores(clarity=2))
        first = item("adaptive", 2, scores(clarity=4), target="clarity", difficulty="beginner")
        second = item("adaptive", 3, scores(clarity=4), target="clarity", difficulty="beginner")
        self.assertEqual(select_adaptive_priority([base, first])["difficulty"], "beginner")
        self.assertEqual(select_adaptive_priority([base, first, second])["difficulty"], "intermediate")
        low = [item("adaptive", 2, scores(clarity=2), target="clarity", difficulty="beginner"),
               item("adaptive", 3, scores(clarity=2), target="clarity", difficulty="beginner")]
        self.assertEqual(select_adaptive_priority([base, *low])["difficulty"], "beginner")

    def test_invalid_or_missing_criterion_is_not_zero_filled(self):
        profile = select_adaptive_priority([item("drill", 1, {"clarity": 2, "grammar": float("nan")})])
        self.assertEqual(profile["scores"], {"clarity": 2})


if __name__ == "__main__":
    unittest.main()
