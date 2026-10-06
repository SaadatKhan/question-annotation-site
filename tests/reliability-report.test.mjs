import assert from "node:assert/strict";
import test from "node:test";
import {
  binaryReliability,
  intendedChosenMatrix,
  ordinalKrippendorffAlpha
} from "../scripts/reliability-report.mjs";

test("ordinal Krippendorff alpha is one for perfect agreement", () => {
  const alpha = ordinalKrippendorffAlpha([
    ["C1", "C1"],
    ["C2", "C2"],
    ["C3", "C3"]
  ]);
  assert.equal(alpha, 1);
});

test("binary reliability reports agreement, no ratings, and PABAK", () => {
  const result = binaryReliability([
    ["yes", "yes"],
    ["yes", "no"],
    ["no", "no"]
  ]);
  assert.equal(result.agreements, 2);
  assert.equal(result.comparisons, 3);
  assert.equal(result.agreement, 2 / 3);
  assert.equal(result.noRatings, 3);
  assert.equal(result.totalRatings, 6);
  assert.ok(Math.abs(result.pabak - 1 / 3) < Number.EPSILON);
});

test("intended versus chosen matrix counts every individual rating", () => {
  const matrix = intendedChosenMatrix([
    [
      { certainty_intended: "C1", certainty_assigned: "C1" },
      { certainty_intended: "C1", certainty_assigned: "C2" }
    ],
    [
      { certainty_intended: "C3", certainty_assigned: "C3" },
      { certainty_intended: "C3", certainty_assigned: "C3" }
    ]
  ]);
  assert.deepEqual(matrix, {
    C1: { C1: 1, C2: 1, C3: 0 },
    C2: { C1: 0, C2: 0, C3: 0 },
    C3: { C1: 0, C2: 0, C3: 2 }
  });
});
