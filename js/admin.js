(function () {
  "use strict";

  const config = window.APP_CONFIG;
  const client = window.GitHubClient;
  const elements = {
    loading: document.getElementById("admin-loading"),
    error: document.getElementById("admin-error"),
    errorMessage: document.getElementById("admin-error-message"),
    retry: document.getElementById("admin-retry"),
    workspace: document.getElementById("admin-workspace"),
    adminName: document.getElementById("admin-name"),
    logout: document.getElementById("admin-logout"),
    refresh: document.getElementById("refresh-dashboard"),
    updated: document.getElementById("admin-updated"),
    warning: document.getElementById("admin-warning"),
    accessList: document.getElementById("access-list"),
    summaryTeam: document.getElementById("summary-team"),
    summaryActive: document.getElementById("summary-active"),
    summaryPending: document.getElementById("summary-pending"),
    summaryComplete: document.getElementById("summary-complete"),
    totalProgress: document.getElementById("total-progress"),
    tableBody: document.getElementById("status-table-body")
  };

  const state = {
    token: "",
    username: "",
    users: [],
    questionIds: new Set(),
    refreshing: false
  };

  function approvedUser(username) {
    const key = Object.keys(window.ANNOTATION_USERS).find(
      (candidate) => candidate.toLowerCase() === username.toLowerCase()
    );
    return key ? { username: key, ...window.ANNOTATION_USERS[key] } : null;
  }

  function showFatalError(error) {
    elements.loading.classList.add("hidden");
    elements.workspace.classList.add("hidden");
    elements.error.classList.remove("hidden");
    elements.errorMessage.textContent = error.message || "An unexpected error occurred.";
  }

  function roleLabel(role) {
    return role === "admin" ? "Admin" : "Annotation only";
  }

  function renderAccessRoles() {
    elements.accessList.replaceChildren();
    state.users.forEach((user) => {
      const item = document.createElement("div");
      item.className = "access-person";

      const identity = document.createElement("div");
      identity.className = "access-identity";
      const name = document.createElement("strong");
      name.textContent = user.displayName;
      const username = document.createElement("span");
      username.textContent = `@${user.username}`;
      identity.append(name, username);

      const role = document.createElement("span");
      role.className = `role-badge ${user.role === "admin" ? "admin" : "annotator"}`;
      role.textContent = roleLabel(user.role);
      item.append(identity, role);
      elements.accessList.append(item);
    });
  }

  function formatLastSave(timestamp) {
    if (!timestamp) return "Never";
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "Unknown";
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
  }

  function summarizeAnnotations(annotationMap) {
    const records = Array.from(annotationMap.values()).filter(
      (record) => state.questionIds.has(String(record.sample_id))
    );
    return {
      completed: records.length,
      yes: records.filter((record) => record.answer === "yes").length,
      no: records.filter((record) => record.answer === "no").length,
      flagged: records.filter((record) => Boolean(record.flag_for_review)).length,
      lastSave: records.reduce((latest, record) => {
        if (!record.timestamp) return latest;
        return !latest || record.timestamp > latest ? record.timestamp : latest;
      }, "")
    };
  }

  function determineStatus(user, summary, collaborators, invitations, invitationVisible) {
    const username = user.username.toLowerCase();
    if (invitations.has(username)) return { key: "pending", label: "Invitation pending" };
    if (summary.completed >= state.questionIds.size) return { key: "complete", label: "Complete" };
    if (summary.completed > 0) return { key: "active", label: "In progress" };
    if (username === config.githubOwner.toLowerCase() || collaborators.has(username)) {
      return { key: "ready", label: "Accepted / not started" };
    }
    if (!invitationVisible) return { key: "unknown", label: "Invite status unavailable" };
    return { key: "missing", label: "Access not granted" };
  }

  function appendTextCell(row, text, className = "") {
    const cell = document.createElement("td");
    if (className) cell.className = className;
    cell.textContent = text;
    row.append(cell);
    return cell;
  }

  function renderTable(rows) {
    elements.tableBody.replaceChildren();
    rows.forEach(({ user, summary, status }) => {
      const row = document.createElement("tr");

      const personCell = document.createElement("td");
      const person = document.createElement("div");
      person.className = "table-person";
      const name = document.createElement("strong");
      name.textContent = user.displayName;
      const username = document.createElement("span");
      username.textContent = `@${user.username}`;
      person.append(name, username);
      personCell.append(person);
      row.append(personCell);

      const statusCell = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = `status-badge ${status.key}`;
      badge.textContent = status.label;
      statusCell.append(badge);
      row.append(statusCell);

      const progressCell = document.createElement("td");
      progressCell.className = "progress-cell";
      const progressText = document.createElement("strong");
      progressText.textContent = `${summary.completed}/${state.questionIds.size}`;
      const track = document.createElement("span");
      track.className = "mini-progress-track";
      const fill = document.createElement("span");
      fill.className = "mini-progress-fill";
      fill.style.width = `${Math.round((summary.completed / state.questionIds.size) * 100)}%`;
      track.append(fill);
      progressCell.append(progressText, track);
      row.append(progressCell);

      appendTextCell(row, String(summary.yes), "number-cell");
      appendTextCell(row, String(summary.no), "number-cell");
      appendTextCell(row, String(summary.flagged), "number-cell");
      appendTextCell(row, formatLastSave(summary.lastSave), "last-save-cell");

      const actionCell = document.createElement("td");
      if (summary.completed > 0) {
        const link = document.createElement("a");
        link.className = "table-link";
        link.href = `https://github.com/${encodeURIComponent(config.githubOwner)}/` +
          `${encodeURIComponent(config.resultsRepo)}/blob/${encodeURIComponent(config.resultsBranch)}/` +
          `${encodeURIComponent(config.annotationsDirectory)}/${encodeURIComponent(user.username)}.jsonl`;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "View";
        actionCell.append(link);
      }
      row.append(actionCell);
      elements.tableBody.append(row);
    });
  }

  function showWarning(messages) {
    const filtered = messages.filter(Boolean);
    elements.warning.classList.toggle("hidden", filtered.length === 0);
    elements.warning.textContent = filtered.join(" ");
  }

  async function refreshDashboard() {
    if (state.refreshing) return;
    state.refreshing = true;
    elements.refresh.disabled = true;
    elements.refresh.textContent = "Refreshing...";

    try {
      const [collaboratorResult, invitationResult, annotationResults] = await Promise.all([
        client.listCollaborators(state.token).then(
          (value) => ({ ok: true, value }),
          (error) => ({ ok: false, error })
        ),
        client.listPendingInvitations(state.token).then(
          (value) => ({ ok: true, value }),
          (error) => ({ ok: false, error })
        ),
        Promise.all(state.users.map(async (user) => ({
          user,
          annotations: await client.loadAnnotations(user.username, state.token)
        })))
      ]);

      const collaborators = new Set(
        collaboratorResult.ok ? collaboratorResult.value.map((user) => user.login.toLowerCase()) : []
      );
      const invitations = new Set(
        invitationResult.ok ? invitationResult.value.map((invite) => invite.invitee.login.toLowerCase()) : []
      );
      const rows = annotationResults.map(({ user, annotations }) => {
        const summary = summarizeAnnotations(annotations);
        const status = determineStatus(user, summary, collaborators, invitations, invitationResult.ok);
        return { user, summary, status };
      });

      renderTable(rows);
      elements.summaryTeam.textContent = String(rows.length);
      elements.summaryActive.textContent = String(rows.filter((row) => row.status.key === "active").length);
      elements.summaryPending.textContent = invitationResult.ok
        ? String(rows.filter((row) => row.status.key === "pending").length)
        : "-";
      elements.summaryComplete.textContent = String(rows.filter((row) => row.status.key === "complete").length);

      const saved = rows.reduce((total, row) => total + row.summary.completed, 0);
      const possible = state.questionIds.size * rows.length;
      const percentage = possible ? Math.round((saved / possible) * 100) : 0;
      elements.totalProgress.textContent = `${saved} of ${possible} total annotations (${percentage}%)`;
      elements.updated.textContent = `Updated ${new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit"
      }).format(new Date())}`;

      const warnings = [];
      if (!collaboratorResult.ok) warnings.push("Repository access status could not be loaded.");
      if (!invitationResult.ok) {
        warnings.push("Pending invitations require Administration: Read-only permission on your GitHub token.");
      }
      showWarning(warnings);
    } catch (error) {
      showWarning([error.message || "Dashboard data could not be refreshed."]);
    } finally {
      state.refreshing = false;
      elements.refresh.disabled = false;
      elements.refresh.textContent = "Refresh";
    }
  }

  async function initialize() {
    try {
      state.token = client.getStoredToken();
      const sessionUsername = sessionStorage.getItem(config.currentUserStorageKey) || "";
      const sessionUser = approvedUser(sessionUsername);
      if (!state.token || !sessionUser) {
        window.location.replace("index.html");
        return;
      }
      if (sessionUser.role !== "admin") {
        throw new Error("This dashboard is available only to project administrators.");
      }

      const [githubUser, questionResponse] = await Promise.all([
        client.verifyAccess(state.token),
        fetch(config.questionsPath, { cache: "no-store" })
      ]);
      if (!questionResponse.ok) throw new Error("The questions file could not be loaded.");
      if (githubUser.login.toLowerCase() !== sessionUser.username.toLowerCase()) {
        throw new Error("The active GitHub token does not match the signed-in administrator.");
      }

      const questions = await questionResponse.json();
      state.questionIds = new Set(questions.map((question) => String(question.id)));
      state.username = sessionUser.username;
      state.users = Object.entries(window.ANNOTATION_USERS).map(([username, details]) => ({
        username,
        displayName: details.displayName,
        role: details.role || "annotator"
      }));

      elements.adminName.textContent = sessionUser.displayName;
      renderAccessRoles();
      elements.loading.classList.add("hidden");
      elements.error.classList.add("hidden");
      elements.workspace.classList.remove("hidden");
      await refreshDashboard();
    } catch (error) {
      showFatalError(error);
    }
  }

  elements.refresh.addEventListener("click", refreshDashboard);
  elements.retry.addEventListener("click", () => window.location.reload());
  elements.logout.addEventListener("click", () => {
    client.clearToken();
    sessionStorage.removeItem(config.currentUserStorageKey);
    sessionStorage.removeItem(config.currentIndexStorageKey);
    window.location.assign("index.html");
  });

  initialize();
})();
