import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const apiRoot = "https://question-annotation-api.question-annotation-site.workers.dev";
const siteRoot = "https://saadatkhan.github.io/question-annotation-site/";
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
const inProgress = dashboard.body.rows.filter((row) => row.status === "active").length;
const notStarted = dashboard.body.rows.filter((row) => ["ready", "signed_in"].includes(row.status)).length;

const annotatorLogin = await login(credentials[1]);
assert.equal(annotatorLogin.response.status, 200, annotatorLogin.body.error || "Annotator login failed.");
assert.equal(annotatorLogin.body.user.role, "annotator");

const forbidden = await request("/api/admin/status", {
  headers: { Authorization: `Bearer ${annotatorLogin.body.token}` }
});
assert.equal(forbidden.response.status, 403, "Annotator unexpectedly accessed the admin dashboard.");

const [indexResponse, configResponse] = await Promise.all([
  fetch(`${siteRoot}?smoke=${Date.now()}`),
  fetch(`${siteRoot}js/config.js?smoke=${Date.now()}`)
]);
assert.equal(indexResponse.status, 200, "The GitHub Pages login could not be loaded.");
assert.equal(configResponse.status, 200, "The live site configuration could not be loaded.");
const [indexHtml, siteConfig] = await Promise.all([indexResponse.text(), configResponse.text()]);
assert.match(indexHtml, /id="username"/);
assert.doesNotMatch(indexHtml, /GitHub access token/);
assert.match(siteConfig, /question-annotation-api\.question-annotation-site\.workers\.dev/);

console.log(
  `Live smoke tests passed: published login, 5 users, ${annotations.body.annotations.length} existing admin annotations, ` +
  `${inProgress} in progress, ${notStarted} not started.`
);
