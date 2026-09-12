const API_VERSION = "2022-11-28";
const SESSION_LIFETIME_SECONDS = 12 * 60 * 60;
const encoder = new TextEncoder();

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env.ALLOWED_ORIGINS || "");

    if (request.method === "OPTIONS") {
      if (!cors) return json({ error: "Origin is not allowed." }, 403);
      return new Response(null, { status: 204, headers: cors });
    }

    if (!cors) return json({ error: "Origin is not allowed." }, 403);

    try {
      const url = new URL(request.url);
      const route = `${request.method} ${url.pathname}`;

      if (route === "GET /api/health") {
        return json({ ok: true }, 200, cors);
      }

      if (route === "POST /api/login") {
        const ip = request.headers.get("CF-Connecting-IP") || "unknown";
        const rateLimit = await env.LOGIN_RATE_LIMITER.limit({ key: ip });
        if (!rateLimit.success) throw httpError(429, "Too many sign-in attempts. Wait one minute and try again.");
        return withCors(await login(request, env), cors);
      }

      const session = await requireSession(request, env);

      if (route === "GET /api/session") {
        return json({ user: publicUser(session.user) }, 200, cors);
      }
      if (route === "GET /api/annotations") {
        const file = await getAnnotationFile(session.user.username, env);
        return json({ annotations: file.records }, 200, cors);
      }
      if (route === "PUT /api/annotations") {
        const record = validateAnnotation(await readJson(request), session.user);
        await saveAnnotation(session.user.username, record, env);
        return json({ annotation: record }, 200, cors);
      }
      if (route === "GET /api/admin/status") {
        requireAdmin(session.user);
        return json(await adminStatus(env), 200, cors);
      }

      return json({ error: "Endpoint not found." }, 404, cors);
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      const message = status >= 500 ? "The service could not complete the request." : error.message;
      if (status >= 500) console.error(error);
      return json({ error: message }, status, cors);
    }
  }
};

async function login(request, env) {
  const body = await readJson(request);
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) throw httpError(400, "Enter a username and password.");
  if (username.length > 40 || password.length > 256) throw httpError(400, "The username or password is invalid.");

  const users = parseUsers(env.AUTH_USERS_JSON);
  const user = users.find((candidate) => candidate.username.toLowerCase() === username.toLowerCase());
  const passwordUser = user || { salt: "invalid-user", passwordHash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" };
  const passwordMatches = await verifyPassword(password, passwordUser, env.PASSWORD_PEPPER);
  const valid = Boolean(user && user.enabled !== false && passwordMatches);
  if (!valid) throw httpError(401, "The username or password is incorrect.");

  await recordLogin(user.username, env).catch((error) => console.warn("Login activity could not be saved.", error));
  const now = Math.floor(Date.now() / 1000);
  const token = await signToken({ sub: user.username, iat: now, exp: now + SESSION_LIFETIME_SECONDS }, env.SESSION_SECRET);
  return json({ token, user: publicUser(user), expiresAt: (now + SESSION_LIFETIME_SECONDS) * 1000 });
}

async function requireSession(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) throw httpError(401, "Your session has expired. Sign in again.");

  const payload = await verifyToken(token, env.SESSION_SECRET);
  const users = parseUsers(env.AUTH_USERS_JSON);
  const user = users.find((candidate) => candidate.username === payload.sub && candidate.enabled !== false);
  if (!user) throw httpError(401, "This account is no longer available.");
  return { user, payload };
}

function requireAdmin(user) {
  if (user.role !== "admin") throw httpError(403, "This dashboard is available only to project administrators.");
}

function publicUser(user) {
  return { username: user.username, displayName: user.displayName, role: user.role };
}

function parseUsers(value) {
  let users;
  try {
    users = JSON.parse(value || "[]");
  } catch {
    throw httpError(500, "The user configuration is invalid.");
  }
  if (!Array.isArray(users) || users.length === 0 || users.length > 20) {
    throw httpError(500, "No valid annotation users are configured.");
  }
  const usernames = new Set();
  const normalized = users.map((user) => {
    if (!user || !/^[A-Za-z0-9_-]{2,40}$/.test(user.username || "") ||
        typeof user.displayName !== "string" || !user.displayName.trim() || user.displayName.length > 100 ||
        !["admin", "annotator"].includes(user.role) ||
        typeof user.salt !== "string" || typeof user.passwordHash !== "string") {
      throw httpError(500, "The user configuration is invalid.");
    }
    const key = user.username.toLowerCase();
    if (usernames.has(key)) throw httpError(500, "The user configuration contains duplicate usernames.");
    usernames.add(key);
    return user;
  });
  if (!normalized.some((user) => user.role === "admin" && user.enabled !== false)) {
    throw httpError(500, "The user configuration requires an enabled administrator.");
  }
  return normalized;
}

async function verifyPassword(password, user, pepper) {
  if (!pepper || pepper.length < 32) throw httpError(500, "The password secret is not configured.");
  const calculated = await hmac(`${user.salt}:${password}`, pepper);
  return timingSafeEqual(calculated, base64UrlDecode(user.passwordHash));
}

async function signToken(payload, secret) {
  if (!secret) throw httpError(500, "The session secret is not configured.");
  const encodedPayload = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await hmac(encodedPayload, secret);
  return `${encodedPayload}.${base64UrlEncode(signature)}`;
}

async function verifyToken(token, secret) {
  const [payloadPart, signaturePart, extra] = token.split(".");
  if (!payloadPart || !signaturePart || extra || !secret) throw httpError(401, "Your session is invalid.");
  const expected = await hmac(payloadPart, secret);
  if (!timingSafeEqual(expected, base64UrlDecode(signaturePart))) throw httpError(401, "Your session is invalid.");
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart)));
  } catch {
    throw httpError(401, "Your session is invalid.");
  }
  if (!payload.sub || !Number.isInteger(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw httpError(401, "Your session has expired. Sign in again.");
  }
  return payload;
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function validateAnnotation(body, user) {
  const sampleId = typeof body.sample_id === "string" ? body.sample_id : "";
  const comment = typeof body.comment === "string" ? body.comment.trim() : "";
  if (!Number.isInteger(body.question_index) || body.question_index < 0 || body.question_index >= 270) {
    throw httpError(400, "The question index is invalid.");
  }
  const expectedId = `sample_${String(body.question_index).padStart(3, "0")}`;
  if (sampleId !== expectedId) throw httpError(400, "The sample ID is invalid.");
  if (!["yes", "no"].includes(body.answer)) throw httpError(400, "Select Yes or No.");
  if (comment.length > 2000) throw httpError(400, "The comment is too long.");
  return {
    sample_id: sampleId,
    question_index: body.question_index,
    answer: body.answer,
    comment,
    flag_for_review: Boolean(body.flag_for_review),
    annotator: user.username,
    timestamp: new Date().toISOString()
  };
}

async function adminStatus(env) {
  const configuredUsers = parseUsers(env.AUTH_USERS_JSON);
  const users = configuredUsers.map((user) => ({ ...publicUser(user), enabled: user.enabled !== false }));
  const rows = await Promise.all(users.map(async (user) => {
    const [file, activityFile] = await Promise.all([
      getAnnotationFile(user.username, env),
      getActivityFile(user.username, env)
    ]);
    const activity = activityFile ? activityFile.activity : null;
    const records = deduplicate(file.records).filter((record) => {
      const index = Number(record.question_index);
      return Number.isInteger(index) && index >= 0 && index < 270 &&
        String(record.sample_id) === `sample_${String(index).padStart(3, "0")}`;
    });
    const completed = records.length;
    const lastSave = records.reduce((latest, record) => {
      if (typeof record.timestamp !== "string") return latest;
      return !latest || record.timestamp > latest ? record.timestamp : latest;
    }, "");
    return {
      user,
      status: !user.enabled ? "disabled" : completed >= 270 ? "complete" : completed > 0 ? "active" : activity ? "signed_in" : "ready",
      summary: {
        completed,
        yes: records.filter((record) => record.answer === "yes").length,
        no: records.filter((record) => record.answer === "no").length,
        flagged: records.filter((record) => Boolean(record.flag_for_review)).length,
        lastSave,
        lastLogin: activity && typeof activity.lastLoginAt === "string" ? activity.lastLoginAt : ""
      }
    };
  }));
  return { users, rows, totalQuestions: 270, updatedAt: new Date().toISOString() };
}

async function getActivityFile(username, env) {
  const path = `${env.ACTIVITY_DIRECTORY || "activity"}/${username}.json`;
  const endpoint = `/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_RESULTS_REPO)}` +
    `/contents/${encodePath(path)}?ref=${encodeURIComponent(env.GITHUB_RESULTS_BRANCH || "main")}`;
  const file = await githubRequest(endpoint, env, { allowNotFound: true });
  if (!file) return null;
  if (file.type !== "file" || file.encoding !== "base64") throw httpError(502, "The activity file is invalid.");
  try {
    return { activity: JSON.parse(base64ToUtf8(file.content)), sha: file.sha };
  } catch {
    throw httpError(502, "A saved activity file contains invalid JSON.");
  }
}

async function recordLogin(username, env) {
  const path = `${env.ACTIVITY_DIRECTORY || "activity"}/${username}.json`;
  const endpoint = `/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_RESULTS_REPO)}` +
    `/contents/${encodePath(path)}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existingFile = await getActivityFile(username, env);
    const existing = existingFile ? existingFile.activity : null;
    const now = new Date().toISOString();
    const activity = {
      username,
      firstLoginAt: existing && existing.firstLoginAt ? existing.firstLoginAt : now,
      lastLoginAt: now
    };
    try {
      await githubRequest(endpoint, env, {
        method: "PUT",
        body: {
          message: `Record sign in for ${username}`,
          content: utf8ToBase64(`${JSON.stringify(activity)}\n`),
          branch: env.GITHUB_RESULTS_BRANCH || "main",
          ...(existingFile ? { sha: existingFile.sha } : {})
        }
      });
      return activity;
    } catch (error) {
      if (![409, 422].includes(error.status) || attempt === 2) throw error;
    }
  }
}

function deduplicate(records) {
  const bySample = new Map();
  records.forEach((record) => {
    if (record && record.sample_id !== undefined) bySample.set(String(record.sample_id), record);
  });
  return Array.from(bySample.values());
}

function annotationPath(username, env) {
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(username)) throw httpError(400, "The username is invalid.");
  return `${env.ANNOTATIONS_DIRECTORY || "annotations"}/${username}.jsonl`;
}

async function getAnnotationFile(username, env) {
  const path = annotationPath(username, env);
  const endpoint = `/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_RESULTS_REPO)}` +
    `/contents/${encodePath(path)}?ref=${encodeURIComponent(env.GITHUB_RESULTS_BRANCH || "main")}`;
  const file = await githubRequest(endpoint, env, { allowNotFound: true });
  if (!file) return { records: [], sha: null };
  if (file.type !== "file" || file.encoding !== "base64") throw httpError(502, "The annotation file is invalid.");
  return { records: parseJsonl(base64ToUtf8(file.content)), sha: file.sha };
}

async function saveAnnotation(username, record, env) {
  const path = annotationPath(username, env);
  const endpoint = `/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_RESULTS_REPO)}` +
    `/contents/${encodePath(path)}`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const latest = await getAnnotationFile(username, env);
    const records = deduplicate(latest.records);
    const bySample = new Map(records.map((saved) => [String(saved.sample_id), saved]));
    bySample.set(record.sample_id, record);
    const ordered = Array.from(bySample.values()).sort((a, b) => a.question_index - b.question_index);
    try {
      await githubRequest(endpoint, env, {
        method: "PUT",
        body: {
          message: `Save annotation ${record.sample_id} for ${username}`,
          content: utf8ToBase64(serializeJsonl(ordered)),
          branch: env.GITHUB_RESULTS_BRANCH || "main",
          ...(latest.sha ? { sha: latest.sha } : {})
        }
      });
      return;
    } catch (error) {
      if (![409, 422].includes(error.status) || attempt === 2) throw error;
    }
  }
}

async function githubRequest(path, env, options = {}) {
  if (!env.GITHUB_TOKEN) throw httpError(500, "The GitHub token is not configured.");
  const response = await fetch(`https://api.github.com${path}`, {
    method: options.method || "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "question-annotation-worker",
      "X-GitHub-Api-Version": API_VERSION
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (options.allowNotFound && response.status === 404) return null;
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const status = [409, 422].includes(response.status) ? response.status : 502;
    const error = httpError(status, "GitHub could not complete the request.");
    error.githubStatus = response.status;
    throw error;
  }
  return payload;
}

async function readJson(request) {
  const type = request.headers.get("Content-Type") || "";
  if (!type.toLowerCase().includes("application/json")) throw httpError(415, "Send the request as JSON.");
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 10000) throw httpError(413, "The request body is too large.");
  try {
    return await request.json();
  } catch {
    throw httpError(400, "The request body is invalid.");
  }
}

function parseJsonl(text) {
  const records = [];
  text.split(/\r?\n/).forEach((line) => {
    if (!line.trim()) return;
    try {
      records.push(JSON.parse(line));
    } catch {
      throw httpError(502, "A saved annotation file contains invalid JSON.");
    }
  });
  return records;
}

function serializeJsonl(records) {
  return records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : "");
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function utf8ToBase64(value) {
  return base64Encode(encoder.encode(value));
}

function base64ToUtf8(value) {
  return new TextDecoder().decode(base64Decode(value.replace(/\s/g, "")));
}

function base64Encode(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64Decode(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64UrlEncode(bytes) {
  return base64Encode(bytes).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return base64Decode(normalized + "=".repeat((4 - normalized.length % 4) % 4));
}

function timingSafeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function corsHeaders(origin, configuredOrigins) {
  const allowed = configuredOrigins.split(",").map((value) => value.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

function withCors(response, cors) {
  const headers = new Headers(response.headers);
  Object.entries(cors).forEach(([name, value]) => headers.set(name, value));
  return new Response(response.body, { status: response.status, headers });
}

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
  });
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
