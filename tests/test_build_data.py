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


def senate_row(candidate, party, votes, year="2008", state="GA", stage="gen", special="False",
               simplified=None, writein="False"):
    return {"candidate": candidate, "party_detailed": party, "candidatevotes": f"{votes}.0",
            "party_simplified": simplified if simplified is not None else party,
            "year": year, "state_po": state, "stage": stage, "special": special, "writein": writein}


class SenateTest(unittest.TestCase):
    def test_pre_round_counts_and_gen_round_decides(self):
        rows = [senate_row("MARTIN", "DEMOCRAT", 1757, stage="pre"),
                senate_row("CHAMBLISS", "REPUBLICAN", 1867, stage="pre"),
                senate_row("BUCKLEY", "LIBERTARIAN", 128, stage="pre"),
                senate_row("MARTIN", "DEMOCRAT", 910),
                senate_row("CHAMBLISS", "REPUBLICAN", 1228)]
        c = b.senate_contests(rows)[(2008, "GA", False)]
        self.assertEqual(c["party"], "R")
        self.assertEqual(c["votes"], {"D": 1757, "R": 1867, "O": 128})

    def test_odd_year_runoff_belongs_to_the_election_before(self):
        rows = [senate_row("WARNOCK", "DEMOCRAT", 1617, year="2020", special="True"),
                senate_row("LOEFFLER", "REPUBLICAN", 1273, year="2020", special="True"),
                senate_row("COLLINS", "REPUBLICAN", 980, year="2020", special="True"),
                senate_row("WARNOCK", "DEMOCRAT", 2289, year="2021", stage="runoff", special="True"),
                senate_row("LOEFFLER", "REPUBLICAN", 2195, year="2021", stage="runoff", special="True")]
        contests = b.senate_contests(rows)
        self.assertEqual(list(contests), [(2020, "GA", True)])
        self.assertEqual(contests[(2020, "GA", True)]["votes"], {"D": 1617, "R": 2253, "O": 0})

    def test_regular_and_special_are_separate_races(self):
        rows = [senate_row("A", "DEMOCRAT", 10, year="2024", state="NE"),
                senate_row("B", "REPUBLICAN", 20, year="2024", state="NE", special="TRUE")]
        self.assertEqual(len(b.senate_contests(rows)), 2)

    def test_party_from_detailed_label_then_fixes(self):
        rows = [senate_row("TAMMY DUCKWORTH", "DEMOCRATIC", 2329, year="2022", state="IL",
                           stage="GEN", simplified="OTHER"),
                senate_row("KATHY SALVI", "REPUBLICAN", 1701, year="2022", state="IL", stage="GEN")]
        self.assertEqual(b.senate_contests(rows)[(2022, "IL", False)]["party"], "D")
        wy = [senate_row("CYNTHIA M. LUMMIS", "", 198100, year="2020", state="WY", simplified="OTHER"),
              senate_row("MERAV BEN DAVID", "", 72766, year="2020", state="WY", simplified="OTHER")]
        c = b.senate_contests(wy)[(2020, "WY", False)]
        self.assertEqual((c["party"], c["votes"]), ("R", {"D": 72766, "R": 198100, "O": 0}))

    def test_fixed_rows_split_into_rounds(self):
        rows = [senate_row("BILL CASSIDY", "REPUBLICAN", 1712379, year="2014", state="LA"),
                senate_row("MARY L. LANDRIEU", "DEMOCRAT", 1561210, year="2014", state="LA"),
                senate_row("ROB MANESS", "REPUBLICAN", 202556, year="2014", state="LA")]
        c = b.senate_contests(rows)[(2014, "LA", False)]
        self.assertEqual(c["winner"], "Bill Cassidy")
        self.assertEqual(c["votes"]["D"], 619402)


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
        self.assertEqual(b.display_name("BYRD, HARRY F., JR."), "Harry F. Byrd Jr.")
        self.assertEqual(b.display_name("Angus S. King, Jr."), "Angus S. King Jr.")
        self.assertEqual(b.display_name("BERNIE SANDERS"), "Bernie Sanders")

    def test_state_name(self):
        self.assertEqual(b.state_name("DISTRICT OF COLUMBIA"), "District of Columbia")


if __name__ == "__main__":
    unittest.main()
