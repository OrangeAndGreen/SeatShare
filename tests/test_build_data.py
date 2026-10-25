import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import build_data as b  # noqa: E402


def row(candidate, party, votes, **extra):
    base = {"candidate": candidate, "party": party, "candidatevotes": str(votes),
            "year": "2024", "state_po": "NY", "district": "1", "runoff": "FALSE",
            "special": "FALSE", "writein": "FALSE"}
    base.update(extra)
    return base


class PartyTest(unittest.TestCase):
    def test_major_labels(self):
        self.assertEqual(b.party_of("DEMOCRATIC-FARMER-LABOR"), "D")
        self.assertEqual(b.party_of("INDEPENDENT-REPUBLICAN"), "R")
        self.assertEqual(b.party_of("REPUBLICAN, LIBERTARIAN"), "R")
        self.assertEqual(b.party_of("NATIONAL DEMOCRATIC PARTY OF ALABAMA"), "O")
        self.assertEqual(b.party_of("NA"), "O")

    def test_non_votes(self):
        self.assertFalse(b.is_vote("BLANKS", "NA"))
        self.assertFalse(b.is_vote("OVERVOTES", ""))
        self.assertFalse(b.is_vote("EXHAUSTED BALLOTS", "NA"))
        self.assertTrue(b.is_vote("WRITEIN", "NA"))
        self.assertTrue(b.is_vote("ALL OTHERS", "NA"))


class TallyTest(unittest.TestCase):
    def test_fusion_lines_sum_to_major_party(self):
        rows = [row("SMITH", "DEMOCRAT", 100), row("SMITH", "WORKING FAMILIES", 20),
                row("JONES", "REPUBLICAN", 90), row("JONES", "CONSERVATIVE", 40)]
        self.assertEqual(b.tally_candidates(rows, "party"),
                         [("JONES", "R", 130), ("SMITH", "D", 120)])

    def test_blank_rows_dropped(self):
        rows = [row("SMITH", "DEMOCRAT", 100), row("BLANK VOTES", "NA", 50)]
        self.assertEqual(b.tally_candidates(rows, "party"), [("SMITH", "D", 100)])


class HouseContestTest(unittest.TestCase):
    def test_runoff_decides_winner_first_round_counts_votes(self):
        rows = [row("A", "DEMOCRAT", 50), row("B", "REPUBLICAN", 45), row("C", "LIBERTARIAN", 10),
                row("A", "DEMOCRAT", 40, runoff="TRUE"), row("B", "REPUBLICAN", 60, runoff="TRUE")]
        c = b.house_contests(rows)[(2024, "NY", 1)]
        self.assertEqual(c["party"], "R")
        self.assertEqual(c["votes"], {"D": 50, "R": 45, "O": 10})

    def test_special_used_only_when_no_regular_rows(self):
        regular = [row("A", "DEMOCRAT", 50), row("B", "REPUBLICAN", 45),
                   row("C", "REPUBLICAN", 99, special="TRUE")]
        self.assertEqual(b.house_contests(regular)[(2024, "NY", 1)]["party"], "D")
        texas = [row("C", "REPUBLICAN", 99, special="TRUE", stage="PRI"),
                 row("D", "DEMOCRAT", 10, special="TRUE", stage="PRI")]
        self.assertEqual(b.house_contests(texas)[(2024, "NY", 1)]["party"], "R")

    def test_dc_delegate_skipped(self):
        self.assertEqual(b.house_contests([row("A", "DEMOCRAT", 1, state_po="DC")]), {})

    def test_uncontested_ignores_write_ins(self):
        rows = [row("A", "DEMOCRAT", 1), row("WRITEIN", "NA", 5, writein="TRUE"),
                row("ALL OTHERS", "NA", 9)]
        self.assertTrue(b.house_contests(rows)[(2024, "NY", 1)]["uncontested"])


class ElectorsTest(unittest.TestCase):
    def test_winner_take_all(self):
        self.assertEqual(b.electoral_votes(9, 2024, "MA", "D"), {"D": 11, "R": 0, "O": 0})

    def test_dc_and_splits(self):
        self.assertEqual(b.electoral_votes(0, 2024, "DC", "D"), {"D": 3, "R": 0, "O": 0})
        self.assertEqual(b.electoral_votes(3, 2020, "NE", "R"), {"D": 1, "R": 4, "O": 0})


class NamesTest(unittest.TestCase):
    def test_display_name(self):
        self.assertEqual(b.display_name("CARTER, JIMMY"), "Jimmy Carter")
        self.assertEqual(b.display_name("TRUMP, DONALD J."), "Donald J. Trump")

    def test_state_name(self):
        self.assertEqual(b.state_name("DISTRICT OF COLUMBIA"), "District of Columbia")


if __name__ == "__main__":
    unittest.main()
