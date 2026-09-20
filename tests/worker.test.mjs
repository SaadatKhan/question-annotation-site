import assert from "node:assert/strict";
import { createHmac, webcrypto } from "node:crypto";
import test from "node:test";

if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: webcrypto });
const { default: worker } = await import("../worker/src/index.js");

globalThis.fetch = async (_url, options = {}) => {
  if ((options.method || "GET") === "GET") return new Response("{}", { status: 404 });
  return Response.json({ content: { sha: "saved" } });
};

const origin = "https://saadatkhan.github.io";
const salt = Buffer.alloc(16, 7);

function user(username, password, role) {
  const passwordHash = createHmac("sha256", "test-password-pepper-that-is-long-and-random")
    .update(`${salt.toString("base64url")}:${password}`)
    .digest("base64url");
  return {
    username,
    displayName: username === "SaadatKhan" ? "Saadat Khan" : "Test Annotator",
    role,
    enabled: true,
    salt: salt.toString("base64url"),
    passwordHash
  };
}

const users = [
  user("SaadatKhan", "a-strong-admin-password", "admin"),
  user("annotator1", "a-strong-user-password", "annotator")
];

const env = {
  ALLOWED_ORIGINS: `${origin},http://localhost:8080`,
  AUTH_USERS_JSON: JSON.stringify(users),
  SESSION_SECRET: "test-session-secret-that-is-long-and-random",
  PASSWORD_PEPPER: "test-password-pepper-that-is-long-and-random",
  GITHUB_TOKEN: "github-test-token",
  GITHUB_OWNER: "SaadatKhan",
  GITHUB_RESULTS_REPO: "question-annotation-results",
  GITHUB_RESULTS_BRANCH: "main",
  ANNOTATIONS_DIRECTORY: "annotations",
  LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) }
};

function request(path, options = {}) {
  return new Request(`https://api.example.test${path}`, {
    ...options,
    headers: { Origin: origin, ...(options.headers || {}) }
  });
}

async function login(username, password) {
  const response = await worker.fetch(request("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  }), env);
  return { response, payload: await response.json() };
}

test("login issues a session without exposing credential data", async () => {
  const { response, payload } = await login("annotator1", "a-strong-user-password");
  assert.equal(response.status, 200);
  assert.equal(payload.user.role, "annotator");
  assert.deepEqual(payload.user.assignment, { start: 1, end: 150, total: 150 });
  assert.deepEqual(payload.user.assignments.training, { start: 1, end: 12, total: 12 });
  assert.deepEqual(payload.user.assignments["test-validation"], { start: 1, end: 150, total: 150 });
  assert.equal(typeof payload.token, "string");
  assert.equal(payload.user.passwordHash, undefined);

  const sessionResponse = await worker.fetch(request("/api/session", {
    headers: { Authorization: `Bearer ${payload.token}` }
  }), env);
  assert.equal(sessionResponse.status, 200);
  assert.equal((await sessionResponse.json()).user.username, "annotator1");
});

test("invalid credentials and disallowed origins are rejected", async () => {
  assert.equal((await login("annotator1", "wrong-password")).response.status, 401);
  const response = await worker.fetch(new Request("https://api.example.test/api/health", {
    headers: { Origin: "https://untrusted.example" }
  }), env);
  assert.equal(response.status, 403);
});

test("annotators cannot open the admin endpoint", async () => {
  const { payload } = await login("annotator1", "a-strong-user-password");
  const response = await worker.fetch(request("/api/admin/status", {
    headers: { Authorization: `Bearer ${payload.token}` }
  }), env);
  assert.equal(response.status, 403);
});

test("saving writes the authenticated user's JSONL file", async (context) => {
  const { payload } = await login("annotator1", "a-strong-user-password");
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if ((options.method || "GET") === "GET") return new Response("{}", { status: 404 });
    return Response.json({ content: { sha: "saved" } });
  };
  context.after(() => { globalThis.fetch = originalFetch; });

  const response = await worker.fetch(request("/api/annotations", {
    method: "PUT",
    headers: { Authorization: `Bearer ${payload.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      sample_id: "sample_004",
      question_index: 4,
      certainty_assigned: "C2",
      certainty_intended: "C1",
      ms_on_item: 4300,
      is_hypothetical: "yes",
      fits_naturally: "yes",
      comment: "Looks natural",
      flag_for_review: false,
      annotator: "someone-else"
    })
  }), env);

  assert.equal(response.status, 200);
  const saved = (await response.json()).annotation;
  assert.equal(saved.annotator, "annotator1");
  assert.equal(saved.schema_version, 4);
  assert.equal(saved.dataset, "test-validation");
  assert.equal(saved.certainty_assigned, "C2");
  assert.equal(saved.ms_on_item, 4300);
  assert.equal(calls.length, 3);
  assert.match(calls[2].url, /annotations\/annotator1\/test-validation\.jsonl$/);
  assert.equal(calls[2].options.headers.Authorization, "Bearer github-test-token");
  const gitBody = JSON.parse(calls[2].options.body);
  const jsonl = Buffer.from(gitBody.content, "base64").toString("utf8");
  assert.equal(JSON.parse(jsonl).annotator, "annotator1");
});

test("training saves use the separate training-round JSONL file", async (context) => {
  const { payload } = await login("annotator1", "a-strong-user-password");
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if ((options.method || "GET") === "GET") return new Response("{}", { status: 404 });
    return Response.json({ content: { sha: "saved" } });
  };
  context.after(() => { globalThis.fetch = originalFetch; });

  const response = await worker.fetch(request("/api/annotations", {
    method: "PUT",
    headers: { Authorization: `Bearer ${payload.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      dataset: "training",
      sample_id: "sample_000",
      question_index: 0,
      certainty_assigned: "C1",
      certainty_intended: "C1",
      ms_on_item: 1200,
      is_hypothetical: "yes",
      fits_naturally: "yes"
    })
  }), env);

  assert.equal(response.status, 200);
  assert.equal((await response.json()).annotation.dataset, "training");
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /annotations\/annotator1\/training-round\.jsonl$/);
});

test("saving requires a certainty level and both Yes/No answers", async () => {
  const { payload } = await login("annotator1", "a-strong-user-password");
  const response = await worker.fetch(request("/api/annotations", {
    method: "PUT",
    headers: { Authorization: `Bearer ${payload.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      sample_id: "sample_004",
      question_index: 4,
      certainty_intended: "C1",
      ms_on_item: 4300,
      is_hypothetical: "yes",
      fits_naturally: "yes"
    })
  }), env);

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /certainty level and both Yes\/No/i);
});

test("annotators cannot save outside their assigned question range", async () => {
  const { payload } = await login("annotator1", "a-strong-user-password");
  const response = await worker.fetch(request("/api/annotations", {
    method: "PUT",
    headers: { Authorization: `Bearer ${payload.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      dataset: "training",
      sample_id: "sample_012",
      question_index: 12,
      certainty_assigned: "C1",
      certainty_intended: "C1",
      ms_on_item: 1000,
      is_hypothetical: "yes",
      fits_naturally: "yes"
    })
  }), env);

  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /outside your assigned question range/i);
});

test("admin progress counts only complete three-question records", async (context) => {
  const { payload } = await login("SaadatKhan", "a-strong-admin-password");
  const originalFetch = globalThis.fetch;
  const records = [
    { sample_id: "sample_000", question_index: 0, answer: "yes", timestamp: "2026-09-10T12:00:00.000Z" },
    {
      sample_id: "sample_001",
      question_index: 1,
      certainty_assigned: "C2",
      certainty_intended: "C1",
      ms_on_item: 4300,
      is_hypothetical: "no",
      fits_naturally: "yes",
      timestamp: "2026-09-11T12:00:00.000Z"
    }
  ];
  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    if (requestUrl.includes("annotations/SaadatKhan.jsonl")) {
      const jsonl = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
      return Response.json({ type: "file", encoding: "base64", content: Buffer.from(jsonl).toString("base64"), sha: "saved" });
    }
    return new Response("{}", { status: 404 });
  };
  context.after(() => { globalThis.fetch = originalFetch; });

  const response = await worker.fetch(request("/api/admin/status", {
    headers: { Authorization: `Bearer ${payload.token}` }
  }), env);
  assert.equal(response.status, 200);
  const row = (await response.json()).rows.find(({ user: listedUser }) => listedUser.username === "SaadatKhan");
  assert.equal(row.status, "active");
  assert.equal(row.summary.savedRecords, 2);
  assert.equal(row.summary.completed, 1);
  assert.deepEqual(row.user.assignment, { start: 1, end: 300, total: 300 });
  assert.deepEqual(row.summary.taskCounts.hypothetical, { yes: 0, no: 1 });
  assert.deepEqual(row.summary.taskCounts.certainty, { yes: 0, no: 1 });
  assert.deepEqual(row.summary.taskCounts.coherence, { yes: 2, no: 0 });
});
