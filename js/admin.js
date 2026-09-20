(function () {
  "use strict";

  const config = window.APP_CONFIG;
  const api = window.AnnotationApi;
  const elements = {
    loading: document.getElementById("admin-loading"),
    error: document.getElementById("admin-error"),
    errorMessage: document.getElementById("admin-error-message"),
    retry: document.getElementById("admin-retry"),
    workspace: document.getElementById("admin-workspace"),
    adminName: document.getElementById("admin-name"),
    datasetSelect: document.getElementById("admin-dataset-select"),
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
    users: [],
    datasetId: config.defaultDatasetId,
    statusByDataset: {},
    totalQuestions: 300,
    refreshing: false
  };

  function showFatalError(error) {
    elements.loading.classList.add("hidden");
    elements.workspace.classList.add("hidden");
    elements.error.classList.remove("hidden");
    if (error instanceof api.ApiError && error.status === 401) api.clearSession();
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
      username.textContent = user.username;
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

  function statusDetails(key) {
    if (key === "complete") return { key, label: "Complete" };
    if (key === "active") return { key, label: "In progress" };
    if (key === "signed_in") return { key: "ready", label: "Signed in / not started" };
    if (key === "disabled") return { key: "disabled", label: "Disabled" };
    return { key: "ready", label: "Account created" };
  }

  function appendTextCell(row, text, className = "") {
    const cell = document.createElement("td");
    if (className) cell.className = className;
    cell.textContent = text;
    row.append(cell);
  }

  function formatTaskCounts(counts) {
    return `${counts?.yes || 0} / ${counts?.no || 0}`;
  }

  function renderTable(rows) {
    elements.tableBody.replaceChildren();
    const rowsByDataset = Object.fromEntries(
      Object.entries(state.statusByDataset).map(([datasetId, data]) => [
        datasetId,
        new Map(data.rows.map((row) => [row.user.username, row]))
      ])
    );
    rows.forEach(({ user, summary, status: statusKey, resultsPath }) => {
      const row = document.createElement("tr");
      const personCell = document.createElement("td");
      const person = document.createElement("div");
      person.className = "table-person";
      const name = document.createElement("strong");
      name.textContent = user.displayName;
      const username = document.createElement("span");
      username.textContent = user.username;
      person.append(name, username);
      personCell.append(person);
      row.append(personCell);

      const details = statusDetails(statusKey);
      const statusCell = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = `status-badge ${details.key}`;
      badge.textContent = details.label;
      statusCell.append(badge);
      row.append(statusCell);

      const progressCell = document.createElement("td");
      progressCell.className = "progress-cell round-progress-cell";
      ["training", "test-validation"].forEach((datasetId) => {
        const roundRow = rowsByDataset[datasetId]?.get(user.username);
        if (!roundRow) return;
        const assignment = roundRow.user.assignment;
        const item = document.createElement("div");
        item.className = "round-progress-item";
        const heading = document.createElement("div");
        heading.className = "round-progress-heading";
        const label = document.createElement("span");
        label.textContent = config.datasets[datasetId].label;
        const progressText = document.createElement("strong");
        progressText.textContent = `${roundRow.summary.completed}/${assignment.total}`;
        heading.append(label, progressText);
        const assignmentRange = document.createElement("span");
        assignmentRange.className = "assignment-range";
        assignmentRange.textContent = `Samples ${assignment.start}-${assignment.end}`;
        const track = document.createElement("span");
        track.className = "mini-progress-track";
        const fill = document.createElement("span");
        fill.className = "mini-progress-fill";
        fill.style.width = `${Math.round((roundRow.summary.completed / assignment.total) * 100)}%`;
        track.append(fill);
        item.append(heading, assignmentRange, track);
        progressCell.append(item);
      });
      row.append(progressCell);

      appendTextCell(row, formatTaskCounts(summary.taskCounts?.hypothetical), "task-count-cell");
      appendTextCell(row, formatTaskCounts(summary.taskCounts?.certainty), "task-count-cell");
      appendTextCell(row, formatTaskCounts(summary.taskCounts?.coherence), "task-count-cell");
      appendTextCell(row, String(summary.flagged), "number-cell");
      appendTextCell(row, formatLastSave(summary.lastSave), "last-save-cell");
      appendTextCell(row, formatLastSave(summary.lastLogin), "last-save-cell");

      const actionCell = document.createElement("td");
      if (summary.savedRecords > 0) {
        const link = document.createElement("a");
        const fallbackPath = `${config.annotationsDirectory}/${user.username}/` +
          config.datasets[state.datasetId].resultsFile;
        const path = resultsPath || fallbackPath;
        link.className = "table-link";
        link.href = `https://github.com/${encodeURIComponent(config.githubOwner)}/` +
          `${encodeURIComponent(config.resultsRepo)}/blob/${encodeURIComponent(config.resultsBranch)}/` +
          path.split("/").map(encodeURIComponent).join("/");
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "View";
        actionCell.append(link);
      }
      row.append(actionCell);
      elements.tableBody.append(row);
    });
  }

  async function refreshDashboard() {
    if (state.refreshing) return;
    state.refreshing = true;
    elements.refresh.disabled = true;
    elements.datasetSelect.disabled = true;
    elements.refresh.textContent = "Refreshing...";
    elements.warning.classList.add("hidden");

    try {
      const [trainingData, validationData] = await Promise.all([
        api.loadAdminStatus("training"),
        api.loadAdminStatus("test-validation")
      ]);
      state.statusByDataset = {
        training: trainingData,
        "test-validation": validationData
      };
      const data = state.statusByDataset[state.datasetId];
      state.users = data.users;
      state.datasetId = data.dataset;
      state.totalQuestions = data.totalQuestions;
      elements.datasetSelect.value = data.dataset;
      renderAccessRoles();
      renderTable(data.rows);

      elements.summaryTeam.textContent = String(data.rows.length);
      elements.summaryActive.textContent = String(data.rows.filter((row) => row.status === "active").length);
      elements.summaryPending.textContent = String(data.rows.filter((row) => ["ready", "signed_in"].includes(row.status)).length);
      elements.summaryComplete.textContent = String(data.rows.filter((row) => row.status === "complete").length);

      const saved = data.rows.reduce((total, row) => total + row.summary.completed, 0);
      const possible = data.rows.reduce(
        (total, row) => total + (row.user.assignment?.total || state.totalQuestions),
        0
      );
      const percentage = possible ? Math.round((saved / possible) * 100) : 0;
      elements.totalProgress.textContent = `${data.datasetLabel}: ${saved} of ${possible} total annotations (${percentage}%)`;
      elements.updated.textContent = `${data.datasetLabel} details - Updated ${new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit"
      }).format(new Date(data.updatedAt))}`;
    } catch (error) {
      if (error instanceof api.ApiError && [401, 403].includes(error.status)) throw error;
      elements.warning.textContent = error.message || "Dashboard data could not be refreshed.";
      elements.warning.classList.remove("hidden");
    } finally {
      state.refreshing = false;
      elements.refresh.disabled = false;
      elements.datasetSelect.disabled = false;
      elements.refresh.textContent = "Refresh";
    }
  }

  async function initialize() {
    try {
      if (!api.getStoredToken()) {
        window.location.replace("index.html");
        return;
      }
      const session = await api.getSession();
      if (session.user.role !== "admin") throw new api.ApiError("This dashboard is available only to project administrators.", 403);
      sessionStorage.setItem(config.currentUserStorageKey, JSON.stringify(session.user));
      const storedDatasetId = sessionStorage.getItem(config.datasetStorageKey);
      state.datasetId = config.datasets[storedDatasetId] ? storedDatasetId : config.defaultDatasetId;
      elements.datasetSelect.value = state.datasetId;
      elements.adminName.textContent = session.user.displayName;
      elements.loading.classList.add("hidden");
      elements.error.classList.add("hidden");
      elements.workspace.classList.remove("hidden");
      await refreshDashboard();
    } catch (error) {
      showFatalError(error);
    }
  }

  elements.refresh.addEventListener("click", () => refreshDashboard().catch(showFatalError));
  elements.datasetSelect.addEventListener("change", () => {
    state.datasetId = elements.datasetSelect.value;
    sessionStorage.setItem(config.datasetStorageKey, state.datasetId);
    refreshDashboard().catch(showFatalError);
  });
  elements.retry.addEventListener("click", () => window.location.reload());
  elements.logout.addEventListener("click", () => {
    api.clearSession();
    sessionStorage.removeItem(config.currentIndexStorageKey);
    window.location.assign("index.html");
  });

  initialize();
})();
