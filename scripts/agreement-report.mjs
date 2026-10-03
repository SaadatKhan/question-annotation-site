import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const defaultResultsDirectory = resolve(repositoryRoot, "../question-annotation-results");

const configuredPairs = Object.freeze([
  Object.freeze(["JonathanNebiyu", "NathanQuan"]),
  Object.freeze(["PariKansara", "HaifaAbdulhamid"])
]);

const rounds = Object.freeze({
  training: Object.freeze({
    label: "Training Round 1",
    fileName: "training-round.jsonl",
    reportFile: "training-round-1.txt",
    assignments: Object.freeze({
      JonathanNebiyu: Object.freeze({ start: 1, end: 12 }),
      NathanQuan: Object.freeze({ start: 1, end: 12 }),
      PariKansara: Object.freeze({ start: 13, end: 24 }),
      HaifaAbdulhamid: Object.freeze({ start: 13, end: 24 })
    })
  }),
  "training-2": Object.freeze({
    label: "Training Round 2",
    fileName: "training-round-2.jsonl",
    reportFile: "training-round-2.txt",
    assignments: Object.freeze({
      JonathanNebiyu: Object.freeze({ start: 13, end: 24 }),
      NathanQuan: Object.freeze({ start: 13, end: 24 }),
      PariKansara: Object.freeze({ start: 1, end: 12 }),
      HaifaAbdulhamid: Object.freeze({ start: 1, end: 12 })
    })
  }),
  "training-3": Object.freeze({
    label: "Training Round 3",
    fileName: "training-round-3.jsonl",
    reportFile: "training-round-3.txt",
    assignments: Object.freeze({
      JonathanNebiyu: Object.freeze({ start: 1, end: 10 }),
      NathanQuan: Object.freeze({ start: 1, end: 10 }),
      PariKansara: Object.freeze({ start: 1, end: 10 }),
      HaifaAbdulhamid: Object.freeze({ start: 1, end: 10 })
    })
  })
});

const roundAliases = Object.freeze({
  "1": "training",
  "2": "training-2",
  "3": "training-3",
  "round-1": "training",
  "round-2": "training-2",
  "round-3": "training-3"
});

function usage() {
  return [
    "Usage:",
    "  npm.cmd run report:agreement",
    "  npm.cmd run report:agreement -- --round training-2",
    "  npm.cmd run report:agreement -- --round training-2 --pair JonathanNebiyu NathanQuan",
    "",
    "Options:",
    "  --round <training|training-2|training-3>  Report one round",
    "  --pair <username1> <username2>            Report one configured pair",
    "  --results-dir <path>                      Use another local results repository",
    "  --output-dir <path>                       Write reports to another folder",
    "  --no-pull                                 Use local files without pulling GitHub",
    "  --no-write                                Print without writing report files",
    "  --help                                    Show this help"
  ].join("\n");
}

function parseArguments(argv) {
  const options = {
    pull: true,
    write: true,
    resultsDirectory: defaultResultsDirectory,
    outputDirectory: "",
    roundIds: Object.keys(rounds),
    pairs: configuredPairs,
    customPair: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") return { ...options, help: true };
    if (argument === "--no-pull") {
      options.pull = false;
    } else if (argument === "--no-write") {
      options.write = false;
    } else if (argument === "--round") {
      const requested = argv[++index];
      const roundId = roundAliases[requested] || requested;
      if (!rounds[roundId]) throw new Error(`Unknown round: ${requested || "(missing)"}`);
      options.roundIds = [roundId];
    } else if (argument === "--pair") {
      const left = argv[++index];
      const right = argv[++index];
      if (!left || !right) throw new Error("--pair requires two usernames.");
      options.pairs = [[left, right]];
      options.customPair = true;
    } else if (argument === "--results-dir") {
      const requested = argv[++index];
      if (!requested) throw new Error("--results-dir requires a path.");
      options.resultsDirectory = resolve(requested);
    } else if (argument === "--output-dir") {
      const requested = argv[++index];
      if (!requested) throw new Error("--output-dir requires a path.");
      options.outputDirectory = resolve(requested);
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  if (!options.outputDirectory) {
    options.outputDirectory = resolve(options.resultsDirectory, "annotation-results");
  }
  return options;
}

function pullResults(resultsDirectory) {
  if (!existsSync(resolve(resultsDirectory, ".git"))) {
    throw new Error(`Results repository not found: ${resultsDirectory}`);
  }
  const result = spawnSync("git", ["-C", resultsDirectory, "pull", "--ff-only"], {
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "Git pull failed.").trim());
  }
  const message = result.stdout.trim();
  if (message) console.log(message);
}

function loadRecords(resultsDirectory, username, fileName) {
  const path = resolve(resultsDirectory, "annotations", username, fileName);
  if (!existsSync(path)) return [];
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
  return Array.from(new Map(records.map((record) => [String(record.sample_id), record])).values());
}

function isComplete(record) {
  return Boolean(record && ["C1", "C2", "C3"].includes(record.certainty_assigned) &&
    ["C1", "C2", "C3"].includes(record.certainty_intended) &&
    ["yes", "no"].includes(record.is_hypothetical) &&
    ["yes", "no"].includes(record.fits_naturally));
}

function recordsInAssignment(records, assignment) {
  return new Map(records
    .filter((record) => {
      const sampleNumber = Number(record.question_index) + 1;
      return Number.isInteger(Number(record.question_index)) &&
        sampleNumber >= assignment.start && sampleNumber <= assignment.end && isComplete(record);
    })
    .map((record) => [Number(record.question_index), record]));
}

export function calculatePairScores(leftRecords, rightRecords, expectedIndices) {
  let q1 = 0;
  let q2 = 0;
  let q3 = 0;
  for (const questionIndex of expectedIndices) {
    const left = leftRecords.get(questionIndex);
    const right = rightRecords.get(questionIndex);
    if (!left || !right) throw new Error(`Sample ${questionIndex + 1} is incomplete for this pair.`);
    if (left.certainty_intended !== right.certainty_intended) {
      throw new Error(`Sample ${questionIndex + 1} has conflicting assigned certainty labels.`);
    }
    if (left.certainty_assigned === left.certainty_intended &&
        right.certainty_assigned === right.certainty_intended) q1 += 1;
    if (left.is_hypothetical === right.is_hypothetical) q2 += 1;
    if (left.fits_naturally === right.fits_naturally) q3 += 1;
  }
  const total = expectedIndices.length;
  return {
    total,
    counts: { q1, q2, q3 },
    percentages: { q1: q1 / total * 100, q2: q2 / total * 100, q3: q3 / total * 100 }
  };
}

function formatPercentage(value) {
  return `${value.toFixed(1)}%`;
}

function formatTable(rows) {
  const headers = ["Round", "Annotator pair", "Progress", "Q1", "Q2", "Q3"];
  const values = rows.map((row) => [
    row.round,
    row.pair,
    row.progress,
    row.scores ? formatPercentage(row.scores.q1) : "--",
    row.scores ? formatPercentage(row.scores.q2) : "--",
    row.scores ? formatPercentage(row.scores.q3) : "--"
  ]);
  const widths = headers.map((header, column) => Math.max(
    header.length,
    ...values.map((row) => row[column].length)
  ));
  const line = (row) => row.map((value, column) => value.padEnd(widths[column])).join("  ");
  return [
    line(headers),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...values.map(line)
  ].join("\n");
}

function analyzeRound(roundId, pair, resultsDirectory) {
  const round = rounds[roundId];
  const [leftName, rightName] = pair;
  const leftAssignment = round.assignments[leftName];
  const rightAssignment = round.assignments[rightName];
  if (!leftAssignment || !rightAssignment) {
    throw new Error(`${round.label} has no assignment for ${leftName} or ${rightName}.`);
  }
  if (leftAssignment.start !== rightAssignment.start || leftAssignment.end !== rightAssignment.end) {
    throw new Error(`${leftName} and ${rightName} do not share samples in ${round.label}.`);
  }
  const expectedIndices = Array.from(
    { length: leftAssignment.end - leftAssignment.start + 1 },
    (_, index) => leftAssignment.start - 1 + index
  );
  const leftRecords = recordsInAssignment(
    loadRecords(resultsDirectory, leftName, round.fileName),
    leftAssignment
  );
  const rightRecords = recordsInAssignment(
    loadRecords(resultsDirectory, rightName, round.fileName),
    rightAssignment
  );
  const ready = leftRecords.size === expectedIndices.length && rightRecords.size === expectedIndices.length;
  return {
    roundId,
    round: round.label,
    pair: `${leftName} / ${rightName}`,
    progress: `${leftRecords.size}/${expectedIndices.length} + ${rightRecords.size}/${expectedIndices.length}`,
    scores: ready ? calculatePairScores(leftRecords, rightRecords, expectedIndices).percentages : null
  };
}

function calculateRoundAverages(rows) {
  const averages = [];
  for (const roundId of new Set(rows.map((row) => row.roundId))) {
    const roundRows = rows.filter((row) => row.roundId === roundId);
    if (roundRows.length !== configuredPairs.length || roundRows.some((row) => !row.scores)) continue;
    const average = (field) => roundRows.reduce((sum, row) => sum + row.scores[field], 0) / roundRows.length;
    averages.push({
      roundId,
      round: rounds[roundId].label,
      q1: average("q1"),
      q2: average("q2"),
      q3: average("q3")
    });
  }
  return averages;
}

function formatAverage(row) {
  return `${row.round}: Q1 ${formatPercentage(row.q1)}, Q2 ${formatPercentage(row.q2)}, Q3 ${formatPercentage(row.q3)}`;
}

function reportText(roundId, rows, average, customPair) {
  const lines = [
    `${rounds[roundId].label} Agreement Report`,
    "",
    "Q1: both annotators match the assigned certainty label.",
    "Q2 and Q3: both annotators select the same answer.",
    "",
    formatTable(rows)
  ];
  if (average) lines.push("", "Pair-averaged scores:", formatAverage(average));
  if (customPair) lines.push("", "This report contains the requested custom annotator pair.");
  return `${lines.join("\n")}\n`;
}

function writeReports(options, rows, averages) {
  mkdirSync(options.outputDirectory, { recursive: true });
  for (const roundId of options.roundIds) {
    const roundRows = rows.filter((row) => row.roundId === roundId);
    const average = averages.find((row) => row.roundId === roundId);
    const baseName = rounds[roundId].reportFile.replace(/\.txt$/, "");
    const pairSuffix = options.customPair
      ? `-${options.pairs[0].map((name) => name.toLowerCase()).join("-")}`
      : "";
    const path = resolve(options.outputDirectory, `${baseName}${pairSuffix}.txt`);
    writeFileSync(path, reportText(roundId, roundRows, average, options.customPair), "utf8");
    console.log(`Saved ${path}`);
  }
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
  const rows = options.roundIds.flatMap((roundId) =>
    options.pairs.map((pair) => analyzeRound(roundId, pair, options.resultsDirectory))
  );
  console.log("\nQ1: both annotators match the assigned certainty label.");
  console.log("Q2 and Q3: both annotators select the same answer.\n");
  console.log(formatTable(rows));
  const averages = options.customPair ? [] : calculateRoundAverages(rows);
  if (averages.length) {
    console.log("\nPair-averaged scores:");
    averages.forEach((row) => console.log(formatAverage(row)));
  }
  if (options.write) writeReports(options, rows, averages);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Agreement report failed: ${error.message}`);
    process.exitCode = 1;
  });
}
