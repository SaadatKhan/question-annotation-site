import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const defaultResultsDirectory = resolve(repositoryRoot, "../question-annotation-results");
const certaintyLevels = Object.freeze(["C1", "C2", "C3"]);
const configuredPairs = Object.freeze([
  Object.freeze({ left: "JonathanNebiyu", right: "NathanQuan", start: 0, end: 150 }),
  Object.freeze({ left: "PariKansara", right: "HaifaAbdulhamid", start: 150, end: 300 })
]);

function usage() {
  return [
    "Usage:",
    "  npm.cmd run report:reliability",
    "",
    "Options:",
    "  --results-dir <path>  Use another local results repository",
    "  --output <path>       Write the report to another file",
    "  --no-pull             Use local files without pulling GitHub",
    "  --no-write            Print without writing a report file",
    "  --help                Show this help"
  ].join("\n");
}

function parseArguments(argv) {
  const options = {
    pull: true,
    write: true,
    resultsDirectory: defaultResultsDirectory,
    outputPath: ""
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") return { ...options, help: true };
    if (argument === "--no-pull") {
      options.pull = false;
    } else if (argument === "--no-write") {
      options.write = false;
    } else if (argument === "--results-dir") {
      const requested = argv[++index];
      if (!requested) throw new Error("--results-dir requires a path.");
      options.resultsDirectory = resolve(requested);
    } else if (argument === "--output") {
      const requested = argv[++index];
      if (!requested) throw new Error("--output requires a path.");
      options.outputPath = resolve(requested);
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  if (!options.outputPath) {
    options.outputPath = resolve(
      options.resultsDirectory,
      "annotation-results/test-validation-reliability.txt"
    );
  }
  return options;
}

function runGit(resultsDirectory, args, failureMessage) {
  const result = spawnSync("git", ["-C", resultsDirectory, ...args], {
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || failureMessage).trim());
  }
  return result.stdout.trim();
}

function readResultsCommit(resultsDirectory) {
  try {
    return runGit(
      resultsDirectory,
      ["rev-parse", "--short", "HEAD"],
      "Could not read the results commit."
    );
  } catch {
    return "unavailable";
  }
}

function pullResults(resultsDirectory) {
  if (!existsSync(resolve(resultsDirectory, ".git"))) {
    throw new Error(`Results repository not found: ${resultsDirectory}`);
  }
  const message = runGit(resultsDirectory, ["pull", "--ff-only"], "Git pull failed.");
  if (message) console.log(message);
}

function loadRecords(resultsDirectory, username) {
  const path = resolve(resultsDirectory, "annotations", username, "test-validation.jsonl");
  if (!existsSync(path)) return new Map();
  const records = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${path}, line ${index + 1}: ${error.message}`);
      }
    });
  return new Map(records.map((record) => [Number(record.question_index), record]));
}

function isComplete(record) {
  return Boolean(record &&
    certaintyLevels.includes(record.certainty_assigned) &&
    certaintyLevels.includes(record.certainty_intended) &&
    ["yes", "no"].includes(record.is_hypothetical) &&
    ["yes", "no"].includes(record.fits_naturally));
}

function ordinalDistance(leftIndex, rightIndex, marginals) {
  if (leftIndex === rightIndex) return 0;
  const start = Math.min(leftIndex, rightIndex);
  const end = Math.max(leftIndex, rightIndex);
  let interval = 0;
  for (let index = start; index <= end; index += 1) interval += marginals[index];
  interval -= (marginals[start] + marginals[end]) / 2;
  return interval ** 2;
}

export function ordinalKrippendorffAlpha(units, categories = certaintyLevels) {
  const categoryIndex = new Map(categories.map((category, index) => [category, index]));
  const coincidence = categories.map(() => categories.map(() => 0));
  for (const ratings of units) {
    const valid = ratings.filter((rating) => categoryIndex.has(rating));
    if (valid.length < 2) continue;
    for (let left = 0; left < valid.length; left += 1) {
      for (let right = 0; right < valid.length; right += 1) {
        if (left === right) continue;
        coincidence[categoryIndex.get(valid[left])][categoryIndex.get(valid[right])] +=
          1 / (valid.length - 1);
      }
    }
  }
  const marginals = coincidence.map((row) => row.reduce((sum, value) => sum + value, 0));
  const total = marginals.reduce((sum, value) => sum + value, 0);
  if (total < 2) return null;

  let observed = 0;
  let expected = 0;
  for (let left = 0; left < categories.length; left += 1) {
    for (let right = 0; right < categories.length; right += 1) {
      const distance = ordinalDistance(left, right, marginals);
      observed += coincidence[left][right] * distance;
      const expectedCoincidence = left === right
        ? marginals[left] * (marginals[left] - 1) / (total - 1)
        : marginals[left] * marginals[right] / (total - 1);
      expected += expectedCoincidence * distance;
    }
  }
  if (expected === 0) return observed === 0 ? 1 : null;
  return 1 - observed / expected;
}

export function binaryReliability(units) {
  let comparisons = 0;
  let agreements = 0;
  let noRatings = 0;
  let totalRatings = 0;
  for (const ratings of units) {
    const valid = ratings.filter((rating) => rating === "yes" || rating === "no");
    noRatings += valid.filter((rating) => rating === "no").length;
    totalRatings += valid.length;
    for (let left = 0; left < valid.length; left += 1) {
      for (let right = left + 1; right < valid.length; right += 1) {
        comparisons += 1;
        if (valid[left] === valid[right]) agreements += 1;
      }
    }
  }
  if (!comparisons) return null;
  const agreement = agreements / comparisons;
  return {
    agreements,
    comparisons,
    agreement,
    noRatings,
    totalRatings,
    pabak: 2 * agreement - 1
  };
}

export function intendedChosenMatrix(recordUnits, categories = certaintyLevels) {
  const matrix = Object.fromEntries(
    categories.map((intended) => [intended, Object.fromEntries(categories.map((chosen) => [chosen, 0]))])
  );
  for (const records of recordUnits) {
    for (const record of records) {
      if (matrix[record.certainty_intended]?.[record.certainty_assigned] !== undefined) {
        matrix[record.certainty_intended][record.certainty_assigned] += 1;
      }
    }
  }
  return matrix;
}

function collectPairedUnits(resultsDirectory) {
  const recordUnits = [];
  const pairCounts = [];
  for (const pair of configuredPairs) {
    const leftRecords = loadRecords(resultsDirectory, pair.left);
    const rightRecords = loadRecords(resultsDirectory, pair.right);
    let count = 0;
    for (let questionIndex = pair.start; questionIndex < pair.end; questionIndex += 1) {
      const left = leftRecords.get(questionIndex);
      const right = rightRecords.get(questionIndex);
      if (!isComplete(left) || !isComplete(right)) continue;
      if (left.certainty_intended !== right.certainty_intended) {
        throw new Error(`Sample ${questionIndex + 1} has conflicting intended certainty labels.`);
      }
      recordUnits.push([left, right]);
      count += 1;
    }
    pairCounts.push({ ...pair, count });
  }
  return { recordUnits, pairCounts };
}

function formatMatrix(matrix) {
  const heading = "Intended  C1  C2  C3";
  const rows = certaintyLevels.map((intended) =>
    `${intended.padEnd(8)}  ${certaintyLevels.map((chosen) =>
      String(matrix[intended][chosen]).padStart(2)).join("  ")}`
  );
  return [heading, ...rows].join("\n");
}

function formatBinary(label, result) {
  const percentage = (result.agreement * 100).toFixed(1);
  return `${label.padEnd(25)} ${`${result.agreements}/${result.comparisons} (${percentage}%)`.padEnd(18)} ` +
    `${`${result.noRatings}/${result.totalRatings}`.padEnd(11)} ${result.pabak.toFixed(3)}`;
}

function buildReport(resultsCommit, recordUnits, pairCounts) {
  if (!recordUnits.length) throw new Error("No fully double-annotated test-validation samples were found.");
  const certaintyUnits = recordUnits.map((records) => records.map((record) => record.certainty_assigned));
  const hypotheticalUnits = recordUnits.map((records) => records.map((record) => record.is_hypothetical));
  const coherenceUnits = recordUnits.map((records) => records.map((record) => record.fits_naturally));
  const alpha = ordinalKrippendorffAlpha(certaintyUnits);
  const hypothetical = binaryReliability(hypotheticalUnits);
  const coherence = binaryReliability(coherenceUnits);
  const matrix = intendedChosenMatrix(recordUnits);
  const totalRatings = recordUnits.reduce((sum, records) => sum + records.length, 0);

  return [
    "Test-validation Reliability Report",
    `Results commit: ${resultsCommit || "unknown"}`,
    "",
    "Included fully double-annotated samples:",
    ...pairCounts.map((pair) => `${pair.left} / ${pair.right}: ${pair.count}`),
    `Total: ${recordUnits.length} paired samples (${totalRatings} ratings)`,
    "",
    "Certainty level",
    `Krippendorff's alpha (ordinal): ${alpha === null ? "not defined" : alpha.toFixed(3)}`,
    "",
    "Intended vs chosen certainty (rating counts)",
    formatMatrix(matrix),
    "",
    "Binary questions",
    "Question                  Agreement          No ratings  PABAK",
    formatBinary("Q2: Hypothetical", hypothetical),
    formatBinary("Q3: Natural/coherent", coherence),
    "",
    "Only samples with complete ratings from both assigned annotators are included."
  ].join("\n") + "\n";
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.pull) {
    console.log("Pulling latest private results...");
    pullResults(options.resultsDirectory);
  }
  const resultsCommit = readResultsCommit(options.resultsDirectory);
  const { recordUnits, pairCounts } = collectPairedUnits(options.resultsDirectory);
  const report = buildReport(resultsCommit, recordUnits, pairCounts);
  console.log(`\n${report}`);
  if (options.write) {
    mkdirSync(dirname(options.outputPath), { recursive: true });
    writeFileSync(options.outputPath, report, "utf8");
    console.log(`Saved ${options.outputPath}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Reliability report failed: ${error.message}`);
    process.exitCode = 1;
  });
}
