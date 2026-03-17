export const HARD_SUDOKU_PRESETS = Object.freeze([
  {
    id: "ai-escargot",
    label: "AI Escargot",
    puzzle:
      "100007090030020008009600500005300900010080002600004000300000010040000007007000300",
  },
  {
    id: "inkala-2012",
    label: "Arto Inkala 2012",
    puzzle:
      "800000000003600000070090200050007000000045700000100030001000068008500010090000400",
  },
  {
    id: "benchmark-28",
    label: "Benchmark #28",
    puzzle:
      "600008940900006100070040000200610000000000200089002000000060005000000030800001600",
  },
  {
    id: "benchmark-49",
    label: "Benchmark #49",
    puzzle:
      "002800000030060007100000040600090000050600009000057060000300100070006008400000020",
  },
  {
    id: "forum-1106-r365",
    label: "Forum hardest 1106 · r365",
    puzzle:
      ".6...8.......7....4..3....9...1......46.....11.....93..2....5..6..9....33..65...4",
  },
  {
    id: "forum-1905-r364",
    label: "Forum hardest 1905 · r364",
    puzzle:
      "..71....6.......4......3.....17....2....5..9...26....8.7......1..6.1.28.1..8....3",
  },
  {
    id: "forum-1905-r344",
    label: "Forum hardest 1905 · r344",
    puzzle:
      "1.23.7..5....6....8..5....3.....49..2..1....8..7.......28.....13......5..1.2..3..",
  },
  {
    id: "forum-1905-r392",
    label: "Forum hardest 1905 · r392",
    puzzle:
      "7......6...29..1.79.....4..1....8....2.7..3.1....4......1.7..5...3......2..1..7.3",
  },
  {
    id: "17-clue-r465",
    label: "17-clue extreme · r465",
    puzzle:
      "..3.8.......35.....7....6....5.......2...94.7........1.......8..6.....3.1....4...",
  },
  {
    id: "forum-1905-r390",
    label: "Forum hardest 1905 · r390",
    puzzle:
      "..6..7...49.........7.34.692.....5....4..3.7.....1...4...37..8...8...........84.6",
  },
]);

export const HARD_SUDOKU_BENCHMARK_DELTA = Object.freeze({
  "ai-escargot": {
    searchEventsSaved: 17500,
    placementsSaved: 8750,
    backtracksSaved: 8750,
    candidateQueriesDelta: -6872,
    chooserCellScansDelta: -369469,
  },
  "inkala-2012": {
    searchEventsSaved: 71496,
    placementsSaved: 35748,
    backtracksSaved: 35748,
    candidateQueriesDelta: 134103,
    chooserCellScansDelta: -1455731,
  },
  "benchmark-28": {
    searchEventsSaved: 5975470,
    placementsSaved: 2987735,
    backtracksSaved: 2987735,
    candidateQueriesDelta: -2227196,
    chooserCellScansDelta: -146747784,
  },
  "benchmark-49": {
    searchEventsSaved: 2060734,
    placementsSaved: 1030367,
    backtracksSaved: 1030367,
    candidateQueriesDelta: -740987,
    chooserCellScansDelta: -43877333,
  },
});
