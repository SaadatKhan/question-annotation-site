import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const apiRoot = "https://question-annotation-api.question-annotation-site.workers.dev";
const origin = "https://saadatkhan.github.io";
const credentialsText = await readFile("account-credentials.txt", "utf8");
const credentials = Array.from(credentialsText.matchAll(/Username: ([^\r\n]+)\r?\nPassword: ([^\r\n]+)/g))
  .map((match) => ({ username: match[1], password: match[2] }));

assert.equal(credentials.length, 5, "Expected one admin and four annotator credentials.");

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

const dashboard = await request("/api/admin/status", { headers: adminHeaders });
assert.equal(dashboard.response.status, 200, dashboard.body.error || "Admin dashboard failed.");
assert.equal(dashboard.body.users.length, 5);
assert.equal(dashboard.body.rows.length, 5);

const annotatorLogin = await login(credentials[1]);
assert.equal(annotatorLogin.response.status, 200, annotatorLogin.body.error || "Annotator login failed.");
assert.equal(annotatorLogin.body.user.role, "annotator");

const forbidden = await request("/api/admin/status", {
  headers: { Authorization: `Bearer ${annotatorLogin.body.token}` }
});
assert.equal(forbidden.response.status, 403, "Annotator unexpectedly accessed the admin dashboard.");

console.log(`Live smoke tests passed: 5 users, ${annotations.body.annotations.length} existing admin annotations.`);
