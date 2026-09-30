import assert from "node:assert/strict";
import test from "node:test";
import { calculatePairScores } from "../scripts/agreement-report.mjs";

function record(index, intended, selected, hypothetical, coherent) {
  return {
    sample_id: `sample_${String(index).padStart(3, "0")}`,
    question_index: index,
    certainty_intended: intended,
    certainty_assigned: selected,
    is_hypothetical: hypothetical,
    fits_naturally: coherent
  };
}

test("agreement report applies the study's three percentage definitions", () => {
  const left = new Map([
    [0, record(0, "C1", "C1", "yes", "yes")],
    [1, record(1, "C2", "C2", "yes", "no")]
  ]);
  const right = new Map([
    [0, record(0, "C1", "C1", "yes", "yes")],
    [1, record(1, "C2", "C1", "no", "no")]
  ]);

  const result = calculatePairScores(left, right, [0, 1]);
  assert.deepEqual(result.counts, { q1: 1, q2: 1, q3: 2 });
  assert.deepEqual(result.percentages, { q1: 50, q2: 50, q3: 100 });
});
