import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EXCLUDED_FIXED_SOURCE_IDS, VALIDATION_BASE_SOURCE_IDS } from "./question-selection.mjs";
import { repairMojibake } from "./repair-mojibake.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const originalSourcePath = resolve(repositoryRoot, process.argv[2] || "../injected_270_base.jsonl");
const validationSourcePath = resolve(repositoryRoot, process.argv[3] || "../dataset_59_val_base.jsonl");
const outputPath = resolve(repositoryRoot, process.argv[4] || "data/questions.json");

async function readJsonl(path, label) {
  const raw = (await readFile(path, "utf8")).replace(/^\uFEFF/, "");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${label} line ${index + 1} is invalid JSON: ${error.message}`);
      }
    });
}

const originalRows = await readJsonl(originalSourcePath, "Original source");
const validationRows = await readJsonl(validationSourcePath, "Validation source");

if (originalRows.length !== 270) {
  throw new Error(`Expected 270 original base records but found ${originalRows.length}.`);
}
if (validationRows.length !== 59) {
  throw new Error(`Expected 59 validation base records but found ${validationRows.length}.`);
}
if (VALIDATION_BASE_SOURCE_IDS.length !== 30 || new Set(VALIDATION_BASE_SOURCE_IDS).size !== 30) {
  throw new Error("The validation selection must contain 30 unique source IDs.");
}
const excludedIds = new Set(EXCLUDED_FIXED_SOURCE_IDS);
if (VALIDATION_BASE_SOURCE_IDS.some((id) => excludedIds.has(id))) {
  throw new Error("The validation selection includes a recently fixed source row.");
}

const seen = new Set();
const certaintyLabels = Object.freeze({
  C1: "Low certainty",
  C2: "Moderate certainty",
  C3: "High certainty"
});

function sanitizeQuestion(row, index, fields) {
  const { text, statement } = fields;
  if (row.id === undefined || !text || !row.original_question) {
    throw new Error(`Combined source row ${index + 1} is missing required fields.`);
  }
  if (!certaintyLabels[row.certainty]) {
    throw new Error(`Combined source row ${index + 1} has an unknown certainty class: ${row.certainty}.`);
  }

  const id = `sample_${String(index).padStart(3, "0")}`;
  if (seen.has(id)) throw new Error(`Duplicate sample id: ${id}`);
  seen.add(id);

  return {
    id,
    text: repairMojibake(text),
    original_text: repairMojibake(row.original_question),
    statement: repairMojibake(statement || ""),
    certainty: row.certainty,
    certainty_label: certaintyLabels[row.certainty],
    options: Array.isArray(row.options) ? row.options.map(repairMojibake) : []
  };
}

const originalQuestions = originalRows.map((row, index) => {
  if (row.source_variant !== "base") {
    throw new Error(`Original source line ${index + 1} is not a base record.`);
  }
  if (row.id !== index) {
    throw new Error(`Original source line ${index + 1} has an unexpected ID.`);
  }
  return sanitizeQuestion(row, index, {
    text: row.injected_question,
    statement: row.statement
  });
});

const validationById = new Map(validationRows.map((row) => [row.id, row]));
if (validationById.size !== validationRows.length) {
  throw new Error("The validation base dataset contains duplicate source IDs.");
}
const validationQuestions = VALIDATION_BASE_SOURCE_IDS.map((sourceId, offset) => {
  const row = validationById.get(sourceId);
  if (!row) throw new Error(`Validation source ID ${sourceId} was not found.`);
  if (row.hypothesis_type !== "correct" || row.hypothesis !== row.correct_answer) {
    throw new Error(`Validation source ID ${sourceId} is not a correct-answer base record.`);
  }
  return sanitizeQuestion(row, originalRows.length + offset, {
    text: row.perturbed_question,
    statement: row.injected_statement
  });
});

const questions = [...originalQuestions, ...validationQuestions];
const serialized = `${JSON.stringify(questions, null, 2)}\n`;
if (serialized.includes('"correct_answer"') || serialized.includes('"hypothesis_type"')) {
  throw new Error("A protected gold-label field leaked into the browser dataset.");
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, serialized, "utf8");
console.log(`Wrote ${questions.length} sanitized base questions to ${outputPath}`);
