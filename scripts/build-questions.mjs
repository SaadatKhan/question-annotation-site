import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { repairMojibake } from "./repair-mojibake.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const sourcePath = resolve(repositoryRoot, process.argv[2] || "../injected_270_base.jsonl");
const outputPath = resolve(repositoryRoot, process.argv[3] || "data/questions.json");

const raw = (await readFile(sourcePath, "utf8")).replace(/^\uFEFF/, "");
const rows = raw
  .split(/\r?\n/)
  .filter((line) => line.trim())
  .map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Source line ${index + 1} is invalid JSON: ${error.message}`);
    }
  });

if (rows.length !== 270) {
  throw new Error(`Expected 270 base records but found ${rows.length}.`);
}

const seen = new Set();
const certaintyLabels = Object.freeze({
  C1: "Low certainty",
  C2: "Moderate certainty",
  C3: "High certainty"
});
const questions = rows.map((row, index) => {
  if (row.source_variant !== "base") {
    throw new Error(`Source line ${index + 1} is not a base record.`);
  }
  if (row.id === undefined || !row.injected_question || !row.original_question) {
    throw new Error(`Source line ${index + 1} is missing required fields.`);
  }
  if (!certaintyLabels[row.certainty]) {
    throw new Error(`Source line ${index + 1} has an unknown certainty class: ${row.certainty}.`);
  }

  const id = `sample_${String(row.id).padStart(3, "0")}`;
  if (seen.has(id)) throw new Error(`Duplicate sample id: ${id}`);
  seen.add(id);

  return {
    id,
    text: repairMojibake(row.injected_question),
    original_text: repairMojibake(row.original_question),
    statement: repairMojibake(row.statement || ""),
    certainty: row.certainty,
    certainty_label: certaintyLabels[row.certainty],
    options: Array.isArray(row.options) ? row.options.map(repairMojibake) : []
  };
});

const serialized = `${JSON.stringify(questions, null, 2)}\n`;
if (serialized.includes('"correct_answer"') || serialized.includes('"hypothesis_type"')) {
  throw new Error("A protected gold-label field leaked into the browser dataset.");
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, serialized, "utf8");
console.log(`Wrote ${questions.length} sanitized base questions to ${outputPath}`);
