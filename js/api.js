(function () {
  "use strict";

  const config = window.APP_CONFIG;

  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }

  function apiUrl(path) {
    const root = config.apiBaseUrl.replace(/\/$/, "");
    if (!root || root.includes("YOUR-WORKERS-SUBDOMAIN")) {
      throw new ApiError("The annotation service has not been configured yet.", 503);
    }
    return `${root}${path}`;
  }

  function getStoredToken() {
    return sessionStorage.getItem(config.sessionTokenStorageKey) ||
      localStorage.getItem(config.tokenStorageKey) || "";
  }

  function storeToken(token, remember) {
    clearSession();
    const storage = remember ? localStorage : sessionStorage;
    storage.setItem(remember ? config.tokenStorageKey : config.sessionTokenStorageKey, token);
  }

  function clearSession() {
    localStorage.removeItem(config.tokenStorageKey);
    sessionStorage.removeItem(config.sessionTokenStorageKey);
    sessionStorage.removeItem(config.currentUserStorageKey);
  }

  async function request(path, options = {}) {
    const token = options.auth === false ? "" : getStoredToken();
    if (options.auth !== false && !token) throw new ApiError("Sign in to continue.", 401);

    let response;
    try {
      response = await fetch(apiUrl(path), {
        method: options.method || "GET",
        cache: "no-store",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(options.body ? { "Content-Type": "application/json" } : {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
      });
    } catch {
      throw new ApiError("The annotation service could not be reached.", 0);
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(payload.error || "The request could not be completed.", response.status);
    return payload;
  }

  async function login(username, password) {
    return request("/api/login", { method: "POST", body: { username, password }, auth: false });
  }

  async function getSession() {
    return request("/api/session");
  }

  async function loadAnnotations(datasetId) {
    const selectedDataset = datasetId || config.defaultDatasetId;
    const payload = await request(`/api/annotations?dataset=${encodeURIComponent(selectedDataset)}`);
    const annotations = new Map();
    (payload.annotations || []).forEach((record) => {
      if (record && record.sample_id !== undefined) annotations.set(String(record.sample_id), record);
    });
    return annotations;
  }

  async function saveAnnotation(datasetId, record) {
    const selectedDataset = datasetId || config.defaultDatasetId;
    const payload = await request("/api/annotations", {
      method: "PUT",
      body: { ...record, dataset: selectedDataset }
    });
    return payload.annotation;
  }

  async function loadAdminStatus(datasetId) {
    const selectedDataset = datasetId || config.defaultDatasetId;
    return request(`/api/admin/status?dataset=${encodeURIComponent(selectedDataset)}`);
  }

  window.AnnotationApi = Object.freeze({
    ApiError,
    getStoredToken,
    storeToken,
    clearSession,
    login,
    getSession,
    loadAnnotations,
    saveAnnotation,
    loadAdminStatus
  });
})();
