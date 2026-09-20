import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(key) || null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

test("browser client stores sessions and sends authenticated requests", async () => {
  const calls = [];
  const context = vm.createContext({
    window: { APP_CONFIG: {
      apiBaseUrl: "https://api.example.test",
      tokenStorageKey: "persistent",
      sessionTokenStorageKey: "session",
      currentUserStorageKey: "user",
      defaultDatasetId: "test-validation"
    } },
    localStorage: new MemoryStorage(),
    sessionStorage: new MemoryStorage(),
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/api/login")) return Response.json({ token: "signed-token", user: { username: "test" } });
      return Response.json({ annotations: [{
        sample_id: "sample_001",
        is_hypothetical: "yes",
        matches_certainty_strength: "no",
        fits_naturally: "yes"
      }] });
    }
  });
  const source = await readFile(new URL("../js/api.js", import.meta.url), "utf8");
  vm.runInContext(source, context);
  const api = context.window.AnnotationApi;

  const result = await api.login("test", "password");
  api.storeToken(result.token, false);
  const annotations = await api.loadAnnotations("training");
  assert.equal(annotations.get("sample_001").matches_certainty_strength, "no");
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[1].options.headers.Authorization, "Bearer signed-token");
  assert.match(calls[1].url, /dataset=training$/);
});
