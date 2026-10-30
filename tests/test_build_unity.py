import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import build_unity as u  # noqa: E402

D, R, I = 100, 200, 328
Y, N, NV = 1, 6, 9


def votes(*rolls):
    """rolls: one {icpsr: cast_code} per roll call, numbered from 1."""
    return [(n, icpsr, code) for n, roll in enumerate(rolls, 1) for icpsr, code in roll.items()]


class PositionTest(unittest.TestCase):
    def test_majority_and_tie(self):
        self.assertEqual(u.party_positions({D: (3, 1), R: (1, 2)}), {D: u.YEA, R: u.NAY})
        self.assertEqual(u.party_positions({D: (2, 2), R: (0, 1)}), {R: u.NAY})

    def test_unity_vote_needs_both_parties_opposed(self):
        self.assertTrue(u.is_unity_vote({D: u.YEA, R: u.NAY}))
        self.assertFalse(u.is_unity_vote({D: u.YEA, R: u.YEA}))
        self.assertFalse(u.is_unity_vote({R: u.NAY}))


class ScoreTest(unittest.TestCase):
    members = {1: D, 2: D, 3: D, 4: R, 5: R, 6: I}

    def test_only_party_unity_votes_count(self):
        unity, s = u.score_members(self.members, votes(
            {1: Y, 2: Y, 3: N, 4: N, 5: N, 6: Y},   # unity vote: D yea, R nay
            {1: Y, 2: Y, 3: Y, 4: Y, 5: Y, 6: Y},   # bipartisan: ignored
            {1: N, 2: N, 3: N, 4: Y, 5: N, 6: N},   # Republicans split 1-1: no majority
        ))
        self.assertEqual(unity, 1)
        self.assertEqual(s[3], {"party": "D", "caucus": "D", "votes": 1, "with": 0})
        self.assertEqual(s[1]["with"], 1)
        self.assertEqual(s[4], {"party": "R", "caucus": "R", "votes": 1, "with": 1})

    def test_not_voting_and_paired_do_not_count(self):
        unity, s = u.score_members(self.members, votes(
            {1: Y, 2: Y, 3: NV, 4: N, 5: 2, 6: 7},
        ))
        self.assertEqual(unity, 1)
        self.assertEqual(s[3]["votes"], 0)
        self.assertEqual(s[5]["votes"], 0)   # paired yea is not a vote
        self.assertEqual(s[6]["caucus"], None)

    def test_independent_scored_with_the_party_they_vote_with(self):
        unity, s = u.score_members(self.members, votes(
            {1: Y, 2: Y, 3: Y, 4: N, 5: N, 6: Y},
            {1: N, 2: N, 3: N, 4: Y, 5: Y, 6: N},
            {1: Y, 2: Y, 3: Y, 4: N, 5: N, 6: N},
        ))
        self.assertEqual(unity, 3)
        self.assertEqual(s[6], {"party": "I", "caucus": "D", "votes": 3, "with": 2})

    def test_independents_do_not_decide_the_party_majority(self):
        # Three independents voting nay don't outvote the one Democrat.
        members = {1: D, 4: R, 6: I, 7: I, 8: I}
        unity, s = u.score_members(members, votes({1: Y, 4: N, 6: N, 7: N, 8: N}))
        self.assertEqual(unity, 1)
        self.assertEqual(s[1]["with"], 1)

    def test_unknown_members_are_ignored(self):
        unity, s = u.score_members({1: D, 4: R}, votes({1: Y, 4: N, 99: Y}))
        self.assertEqual(unity, 1)
        self.assertNotIn(99, s)


class AverageTest(unittest.TestCase):
    def test_min_votes(self):
        self.assertEqual(u.min_votes(20), 10)
        self.assertEqual(u.min_votes(401), 101)

    def test_averages_leave_out_unranked_and_independents(self):
        scored = {
            1: {"party": "D", "votes": 100, "with": 90},
            2: {"party": "D", "votes": 100, "with": 70},
            3: {"party": "D", "votes": 5, "with": 0},     # too few votes
            4: {"party": "R", "votes": 80, "with": 80},
            5: {"party": "I", "votes": 100, "with": 10},
        }
        self.assertEqual(u.party_averages(scored, 100), {"D": 0.8, "R": 1.0})

    def test_party_with_no_ranked_members(self):
        self.assertEqual(u.party_averages({1: {"party": "D", "votes": 50, "with": 25}}, 100),
                         {"D": 0.5, "R": None})


class NameTest(unittest.TestCase):
    def test_display_name(self):
        self.assertEqual(u.display_name("ROGERS, Mike Dennis"), "Mike Rogers")
        self.assertEqual(u.display_name("BIDEN, Joseph Robinette (Joe), Jr."), "Joe Biden")
        self.assertEqual(u.display_name("McCARTHY, Kevin"), "Kevin McCarthy")
        self.assertEqual(u.display_name("O'ROURKE, Robert (Beto)"), "Beto O'Rourke")
        self.assertEqual(u.display_name("OCASIO-CORTEZ, Alexandria"), "Alexandria Ocasio-Cortez")
        self.assertEqual(u.display_name("BLUNT ROCHESTER, Lisa"), "Lisa Blunt Rochester")
        self.assertEqual(u.display_name("DeLAURO, Rosa L."), "Rosa DeLauro")

    def test_seat_label(self):
        self.assertEqual(u.seat_label("H", "CA", "12", {"1", "12"}), "CA-12")
        self.assertEqual(u.seat_label("H", "AK", "1", {"1"}), "AK-AL")
        self.assertEqual(u.seat_label("H", "CA", "1", {"1", "2"}), "CA-1")
        self.assertEqual(u.seat_label("S", "ME", "0", {"0"}), "ME")


class YearsTest(unittest.TestCase):
    def test_congress_years(self):
        self.assertEqual(u.congress_years(118), (2023, 2025))
        self.assertEqual(u.congress_years(80), (1947, 1949))
        self.assertEqual(u.congress_years(1), (1789, 1791))


if __name__ == "__main__":
    unittest.main()
