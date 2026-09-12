(function () {
  "use strict";

  const API_ROOT = "https://api.github.com";
  const API_VERSION = "2022-11-28";

  class GitHubApiError extends Error {
    constructor(message, status, details) {
      super(message);
      this.name = "GitHubApiError";
      this.status = status;
      this.details = details;
    }
  }

  function getStoredToken() {
    const config = window.APP_CONFIG;
    return sessionStorage.getItem(config.sessionTokenStorageKey) ||
      localStorage.getItem(config.tokenStorageKey) || "";
  }

  function storeToken(token, remember) {
    const config = window.APP_CONFIG;
    localStorage.removeItem(config.tokenStorageKey);
    sessionStorage.removeItem(config.sessionTokenStorageKey);
    if (remember) {
      localStorage.setItem(config.tokenStorageKey, token);
    } else {
      sessionStorage.setItem(config.sessionTokenStorageKey, token);
    }
  }

  function clearToken() {
    const config = window.APP_CONFIG;
    localStorage.removeItem(config.tokenStorageKey);
    sessionStorage.removeItem(config.sessionTokenStorageKey);
  }

  function encodePath(path) {
    return path.split("/").map(encodeURIComponent).join("/");
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  function utf8ToBase64(text) {
    return bytesToBase64(new TextEncoder().encode(text));
  }

  function base64ToUtf8(base64) {
    const normalized = base64.replace(/\s/g, "");
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function parseJsonl(text) {
    const records = [];
    text.split(/\r?\n/).forEach((line, index) => {
      if (!line.trim()) return;
      try {
        records.push(JSON.parse(line));
      } catch (error) {
        throw new Error(`Saved annotation line ${index + 1} is invalid JSON: ${error.message}`);
      }
    });
    return records;
  }

  function serializeJsonl(records) {
    return records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : "");
  }

  async function request(path, options = {}) {
    const token = options.token || getStoredToken();
    if (!token) throw new GitHubApiError("No GitHub token is available.", 401);

    const response = await fetch(`${API_ROOT}${path}`, {
      method: options.method || "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": API_VERSION,
        ...(options.body ? { "Content-Type": "application/json" } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    if (options.allowNotFound && response.status === 404) return null;

    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const apiMessage = payload && payload.message ? payload.message : response.statusText;
      throw new GitHubApiError(`GitHub request failed: ${apiMessage}`, response.status, payload);
    }
    return payload;
  }

  async function verifyAccess(token) {
    const config = window.APP_CONFIG;
    const user = await request("/user", { token });
    await request(`/repos/${encodeURIComponent(config.githubOwner)}/${encodeURIComponent(config.resultsRepo)}`, { token });
    return user;
  }

  function annotationPath(username) {
    const config = window.APP_CONFIG;
    if (!/^[A-Za-z0-9-]+$/.test(username)) {
      throw new Error("The verified GitHub username cannot be used as an annotation filename.");
    }
    return `${config.annotationsDirectory}/${username}.jsonl`;
  }

  async function getAnnotationFile(username, token) {
    const config = window.APP_CONFIG;
    const path = annotationPath(username);
    const encoded = encodePath(path);
    const endpoint = `/repos/${encodeURIComponent(config.githubOwner)}/${encodeURIComponent(config.resultsRepo)}` +
      `/contents/${encoded}?ref=${encodeURIComponent(config.resultsBranch)}`;
    const file = await request(endpoint, { token, allowNotFound: true });
    if (!file) return { records: [], sha: null };
    if (file.type !== "file" || file.encoding !== "base64") {
      throw new Error("The annotation path did not resolve to a Base64-encoded file.");
    }
    return { records: parseJsonl(base64ToUtf8(file.content)), sha: file.sha };
  }

  async function loadAnnotations(username, token) {
    const file = await getAnnotationFile(username, token);
    const annotations = new Map();
    file.records.forEach((record) => {
      if (record && record.sample_id !== undefined) {
        annotations.set(String(record.sample_id), record);
      }
    });
    return annotations;
  }

  async function saveAnnotation(username, record, token) {
    const config = window.APP_CONFIG;
    const path = annotationPath(username);
    const endpoint = `/repos/${encodeURIComponent(config.githubOwner)}/${encodeURIComponent(config.resultsRepo)}` +
      `/contents/${encodePath(path)}`;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const latest = await getAnnotationFile(username, token);
      const bySample = new Map();
      latest.records.forEach((savedRecord) => {
        if (savedRecord && savedRecord.sample_id !== undefined) {
          bySample.set(String(savedRecord.sample_id), savedRecord);
        }
      });
      bySample.set(String(record.sample_id), record);

      const orderedRecords = Array.from(bySample.values()).sort((left, right) => {
        const a = Number.isFinite(left.question_index) ? left.question_index : Number.MAX_SAFE_INTEGER;
        const b = Number.isFinite(right.question_index) ? right.question_index : Number.MAX_SAFE_INTEGER;
        return a - b;
      });

      const body = {
        message: `Save annotation ${record.sample_id} for ${username}`,
        content: utf8ToBase64(serializeJsonl(orderedRecords)),
        branch: config.resultsBranch,
        ...(latest.sha ? { sha: latest.sha } : {})
      };

      try {
        await request(endpoint, { method: "PUT", body, token });
        return record;
      } catch (error) {
        const isConflict = error instanceof GitHubApiError && (error.status === 409 || error.status === 422);
        if (!isConflict || attempt === 2) throw error;
      }
    }
    throw new Error("The annotation could not be saved after multiple attempts.");
  }

  window.GitHubClient = Object.freeze({
    GitHubApiError,
    getStoredToken,
    storeToken,
    clearToken,
    verifyAccess,
    loadAnnotations,
    saveAnnotation,
    parseJsonl,
    serializeJsonl,
    utf8ToBase64,
    base64ToUtf8
  });
})();
