import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const apiRoot = "https://question-annotation-api.question-annotation-site.workers.dev";
const siteRoot = "https://saadatkhan.github.io/question-annotation-site/";
const origin = "https://saadatkhan.github.io";
const credentialsText = await readFile("account-credentials.txt", "utf8");
const credentials = Array.from(credentialsText.matchAll(/Username: ([^\r\n]+)\r?\nPassword: ([^\r\n]+)/g))
  .map((match) => ({ username: match[1], password: match[2] }));

assert.equal(credentials.length, 6, "Expected two admin and four annotator credentials.");

async function request(path, options = {}) {
  const response = await fetch(`${apiRoot}${path}`, {
    ...options,
    headers: { Origin: origin, ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function login(account) {
  return request("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(account)
  });
}

const adminLogin = await login(credentials[0]);
assert.equal(adminLogin.response.status, 200, adminLogin.body.error || "Admin login failed.");
assert.equal(adminLogin.body.user.role, "admin");

const adminHeaders = { Authorization: `Bearer ${adminLogin.body.token}` };
const session = await request("/api/session", { headers: adminHeaders });
assert.equal(session.response.status, 200, session.body.error || "Session check failed.");

const annotations = await request("/api/annotations", { headers: adminHeaders });
assert.equal(annotations.response.status, 200, annotations.body.error || "Annotation loading failed.");
assert.ok(Array.isArray(annotations.body.annotations));
const trainingAnnotations = await request("/api/annotations?dataset=training", { headers: adminHeaders });
assert.equal(trainingAnnotations.response.status, 200, trainingAnnotations.body.error || "Training annotations failed.");
assert.ok(Array.isArray(trainingAnnotations.body.annotations));

const dashboard = await request("/api/admin/status?dataset=test-validation", { headers: adminHeaders });
assert.equal(dashboard.response.status, 200, dashboard.body.error || "Admin dashboard failed.");
assert.equal(dashboard.body.dataset, "test-validation");
assert.equal(dashboard.body.users.length, 6);
assert.equal(dashboard.body.rows.length, 6);
const assignmentByUsername = new Map(dashboard.body.users.map((user) => [user.username, user.assignment]));
assert.deepEqual(assignmentByUsername.get("JonathanNebiyu"), { start: 1, end: 150, total: 150 });
assert.deepEqual(assignmentByUsername.get("NathanQuan"), { start: 1, end: 150, total: 150 });
assert.deepEqual(assignmentByUsername.get("PariKansara"), { start: 151, end: 300, total: 150 });
assert.deepEqual(assignmentByUsername.get("HaifaAbdulhamid"), { start: 151, end: 300, total: 150 });
assert.deepEqual(assignmentByUsername.get("SaadatKhan"), { start: 1, end: 300, total: 300 });
assert.deepEqual(assignmentByUsername.get("KevinLybarger"), { start: 1, end: 300, total: 300 });
const trainingDashboard = await request("/api/admin/status?dataset=training", { headers: adminHeaders });
assert.equal(trainingDashboard.response.status, 200, trainingDashboard.body.error || "Training dashboard failed.");
assert.equal(trainingDashboard.body.dataset, "training");
const trainingAssignmentByUsername = new Map(
  trainingDashboard.body.users.map((user) => [user.username, user.assignment])
);
assert.deepEqual(trainingAssignmentByUsername.get("JonathanNebiyu"), { start: 1, end: 12, total: 12 });
assert.deepEqual(trainingAssignmentByUsername.get("NathanQuan"), { start: 1, end: 12, total: 12 });
assert.deepEqual(trainingAssignmentByUsername.get("PariKansara"), { start: 13, end: 24, total: 12 });
assert.deepEqual(trainingAssignmentByUsername.get("HaifaAbdulhamid"), { start: 13, end: 24, total: 12 });
assert.deepEqual(trainingAssignmentByUsername.get("SaadatKhan"), { start: 1, end: 24, total: 24 });
assert.deepEqual(trainingAssignmentByUsername.get("KevinLybarger"), { start: 1, end: 24, total: 24 });
const inProgress = dashboard.body.rows.filter((row) => row.status === "active").length;
const notStarted = dashboard.body.rows.filter((row) => ["ready", "signed_in"].includes(row.status)).length;

const annotatorLogin = await login(credentials[1]);
assert.equal(annotatorLogin.response.status, 200, annotatorLogin.body.error || "Annotator login failed.");
assert.equal(annotatorLogin.body.user.role, "annotator");

const forbidden = await request("/api/admin/status", {
  headers: { Authorization: `Bearer ${annotatorLogin.body.token}` }
});
assert.equal(forbidden.response.status, 403, "Annotator unexpectedly accessed the admin dashboard.");

const [indexResponse, configResponse, validationDataResponse, trainingDataResponse] = await Promise.all([
  fetch(`${siteRoot}?smoke=${Date.now()}`),
  fetch(`${siteRoot}js/config.js?smoke=${Date.now()}`),
  fetch(`${siteRoot}data/questions.json?smoke=${Date.now()}`),
  fetch(`${siteRoot}data/training-questions.json?smoke=${Date.now()}`)
]);
assert.equal(indexResponse.status, 200, "The GitHub Pages login could not be loaded.");
assert.equal(configResponse.status, 200, "The live site configuration could not be loaded.");
assert.equal(validationDataResponse.status, 200, "The test-validation dataset could not be loaded.");
assert.equal(trainingDataResponse.status, 200, "The training dataset could not be loaded.");
const [indexHtml, siteConfig, validationData, trainingData] = await Promise.all([
  indexResponse.text(),
  configResponse.text(),
  validationDataResponse.json(),
  trainingDataResponse.json()
]);
assert.match(indexHtml, /id="username"/);
assert.doesNotMatch(indexHtml, /GitHub access token/);
assert.match(siteConfig, /question-annotation-api\.question-annotation-site\.workers\.dev/);
assert.equal(validationData.length, 300);
assert.equal(trainingData.length, 24);

console.log(
  `Live smoke tests passed: two datasets, 6 users, assigned ranges, ` +
  `${annotations.body.annotations.length} test-validation and ${trainingAnnotations.body.annotations.length} training admin annotations, ` +
  `${inProgress} in progress, ${notStarted} not started.`
);
