import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

const config = {
  githubOwner: "SaadatKhan",
  resultsRepo: "question-annotation-results",
  resultsBranch: "main",
  annotationsDirectory: "annotations",
  tokenStorageKey: "persistent-token",
  sessionTokenStorageKey: "session-token"
};

const context = vm.createContext({
  window: { APP_CONFIG: config },
  localStorage: new MemoryStorage(),
  sessionStorage: new MemoryStorage(),
  TextEncoder,
  TextDecoder,
  Uint8Array,
  btoa,
  atob,
  console,
  fetch: async () => {
    throw new Error("Unexpected network request");
  }
});

const source = await readFile(new URL("../js/github.js", import.meta.url), "utf8");
vm.runInContext(source, context);
const client = context.window.GitHubClient;

const unicode = "Temperature: 37.0 C; cafe; patient says yes.";
assert.equal(client.base64ToUtf8(client.utf8ToBase64(unicode)), unicode);

const records = [
  { sample_id: "sample_000", answer: "yes" },
  { sample_id: "sample_001", answer: "no" }
];
assert.deepEqual(
  JSON.parse(JSON.stringify(client.parseJsonl(client.serializeJsonl(records)))),
  records
);

client.storeToken("persistent", true);
assert.equal(client.getStoredToken(), "persistent");
client.storeToken("session", false);
assert.equal(client.getStoredToken(), "session");
client.clearToken();
assert.equal(client.getStoredToken(), "");

const existing = client.utf8ToBase64(
  client.serializeJsonl([{ sample_id: "sample_000", question_index: 0, answer: "yes" }])
);
const responses = [
  new Response(JSON.stringify({ content: existing, encoding: "base64", type: "file", sha: "old-sha" }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  }),
  new Response(JSON.stringify({ message: "Conflict" }), {
    status: 409,
    headers: { "Content-Type": "application/json" }
  }),
  new Response(JSON.stringify({ content: existing, encoding: "base64", type: "file", sha: "new-sha" }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  }),
  new Response(JSON.stringify({ content: { sha: "saved-sha" } }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  })
];
const calls = [];
context.fetch = async (url, options) => {
  calls.push({ url, options });
  const response = responses.shift();
  if (!response) throw new Error("Mock response queue exhausted");
  if (response instanceof Error) throw response;
  return response;
};

const update = {
  sample_id: "sample_001",
  question_index: 1,
  answer: "no",
  comment: "review",
  annotator: "SaadatKhan",
  timestamp: "2026-09-12T12:00:00.000Z"
};
await client.saveAnnotation("SaadatKhan", update, "test-token");

assert.equal(calls.length, 4, "a conflict should fetch and retry once");
assert.ok(calls.every((call) => call.options.cache === "no-store"));
const finalBody = JSON.parse(calls[3].options.body);
assert.equal(finalBody.sha, "new-sha");
const savedRecords = client.parseJsonl(client.base64ToUtf8(finalBody.content));
assert.equal(savedRecords.length, 2);
assert.equal(savedRecords[1].sample_id, "sample_001");
assert.equal(savedRecords[1].comment, "review");

const ambiguousRecord = {
  sample_id: "sample_002",
  question_index: 2,
  answer: "yes",
  comment: "",
  annotator: "SaadatKhan",
  timestamp: "2026-09-12T12:01:00.000Z"
};
responses.push(
  new Response(JSON.stringify({ message: "Not Found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" }
  }),
  new TypeError("Failed to fetch"),
  new Response(JSON.stringify({
    content: client.utf8ToBase64(client.serializeJsonl([ambiguousRecord])),
    encoding: "base64",
    type: "file",
    sha: "confirmed-sha"
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  })
);
const callsBeforeConfirmation = calls.length;
await client.saveAnnotation("SaadatKhan", ambiguousRecord, "test-token");
assert.equal(calls.length - callsBeforeConfirmation, 3, "an ambiguous save should be confirmed by refetching");

console.log("GitHub client tests passed");
