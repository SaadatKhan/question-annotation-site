import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  EXCLUDED_TRAINING_SOURCE_IDS,
  TRAINING_BASE_SOURCE_IDS,
  VALIDATION_BASE_SOURCE_IDS
} from "../scripts/question-selection.mjs";
import { repairMojibake } from "../scripts/repair-mojibake.mjs";

test("repairs common punctuation and medical symbols without changing valid text", () => {
  const cases = [
    ["patientâ€™s", "patient’s"],
    ["â€œtoo tired.â€\u009d", "“too tired.”"],
    ["3â€“4", "3–4"],
    ["98.6Â°F", "98.6°F"],
    ["Mean corpuscular volume 75 Î¼m3", "Mean corpuscular volume 75 μm3"],
    ["Normal â‰¥ 500", "Normal ≥ 500"],
    ["patient's current findings", "patient's current findings"]
  ];
  for (const [input, expected] of cases) {
    assert.equal(repairMojibake(input), expected);
    assert.equal(repairMojibake(repairMojibake(input)), expected);
  }
});

test("training selection is separate from test-validation and excludes requested source rows", async () => {
  const training = JSON.parse(
    await readFile(new URL("../data/training-questions.json", import.meta.url), "utf8")
  );
  const validationIds = new Set(VALIDATION_BASE_SOURCE_IDS);
  const excludedIds = new Set(EXCLUDED_TRAINING_SOURCE_IDS);

  assert.equal(training.length, 24);
  assert.equal(training[0].id, "sample_000");
  assert.equal(training.at(-1).id, "sample_023");
  assert.equal(new Set(TRAINING_BASE_SOURCE_IDS).size, 24);
  assert.ok(TRAINING_BASE_SOURCE_IDS.every((id) => !validationIds.has(id) && !excludedIds.has(id)));
});

test("public questions preserve line breaks and contain no mojibake markers", async () => {
  const questions = JSON.parse(await readFile(new URL("../data/questions.json", import.meta.url), "utf8"));
  const strings = questions.flatMap((question) => [
    question.text,
    question.original_text,
    question.statement,
    ...question.options
  ]);
  assert.equal(questions.length, 300);
  assert.equal(questions.at(-1).id, "sample_299");
  assert.ok(questions.some((question) => question.text.includes("\n")));
  assert.ok(strings.every((value) => repairMojibake(value) === value));
  assert.ok(strings.some((value) => value.includes("patient’s")));
});
