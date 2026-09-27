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
    tableBody: document.getElementById("status-table-body"),
    reviewBackdrop: document.getElementById("results-review-backdrop"),
    reviewPanel: document.getElementById("results-review-panel"),
    reviewClose: document.getElementById("results-review-close"),
    reviewRound: document.getElementById("results-review-round"),
    reviewTitle: document.getElementById("results-review-title"),
    reviewSubtitle: document.getElementById("results-review-subtitle"),
    reviewLoading: document.getElementById("results-review-loading"),
    reviewError: document.getElementById("results-review-error"),
    reviewContent: document.getElementById("results-review-content"),
    reviewPosition: document.getElementById("results-review-position"),
    reviewSampleId: document.getElementById("results-review-sample-id"),
    reviewPrevious: document.getElementById("results-review-previous"),
    reviewNext: document.getElementById("results-review-next"),
    reviewQuestion: document.getElementById("results-review-question"),
    reviewOptions: document.getElementById("results-review-options"),
    reviewOriginalQuestion: document.getElementById("results-review-original-question"),
    reviewAnswers: document.getElementById("results-review-answers"),
    reviewComment: document.getElementById("results-review-comment"),
    reviewFlag: document.getElementById("results-review-flag"),
    reviewTime: document.getElementById("results-review-time"),
    reviewSavedAt: document.getElementById("results-review-saved-at"),
    main: document.querySelector("main"),
    header: document.querySelector(".app-header")
  };

  const state = {
    users: [],
    datasetId: config.defaultDatasetId,
    statusByDataset: {},
    totalQuestions: 300,
    refreshing: false,
    review: {
      annotations: [],
      questionsById: new Map(),
      currentIndex: 0,
      returnFocus: null,
      requestId: 0,
      open: false
    }
  };

  let reviewCloseTimer = null;

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

  function normalizeQuestions(payload) {
    if (!Array.isArray(payload) || payload.length === 0) {
      throw new Error("The questions file must contain a non-empty array.");
    }
    return payload.map((question, index) => {
      const id = String(question?.id || "");
      const expectedId = `sample_${String(index).padStart(3, "0")}`;
      if (id !== expectedId || typeof question.text !== "string") {
        throw new Error(`Question ${index + 1} is invalid.`);
      }
      return { ...question, id, questionIndex: index, sampleNumber: index + 1 };
    });
  }

  function renderHighlightedText(container, text, highlight) {
    container.replaceChildren();
    if (!highlight) {
      container.textContent = text;
      return;
    }
    const index = text.toLocaleLowerCase().indexOf(highlight.toLocaleLowerCase());
    if (index < 0) {
      container.textContent = text;
      return;
    }
    container.append(document.createTextNode(text.slice(0, index)));
    const mark = document.createElement("mark");
    mark.textContent = text.slice(index, index + highlight.length);
    container.append(mark, document.createTextNode(text.slice(index + highlight.length)));
  }

  function certaintyLabel(value) {
    return ({ C1: "Weak", C2: "Moderate", C3: "Strong" })[value] || "Not recorded";
  }

  function yesNoLabel(value) {
    if (value === "yes") return "Yes";
    if (value === "no") return "No";
    return "Not recorded";
  }

  function formatDuration(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return "Time not recorded";
    const totalSeconds = Math.round(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `Time on sample: ${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function appendReviewAnswer(labelText, valueText, detailText, tone = "") {
    const item = document.createElement("div");
    item.className = "results-review-answer";
    const label = document.createElement("span");
    label.className = "results-review-label";
    label.textContent = labelText;
    const value = document.createElement("strong");
    value.className = `results-review-value${tone ? ` ${tone}` : ""}`;
    value.textContent = valueText;
    item.append(label, value);
    if (detailText) {
      const detail = document.createElement("span");
      detail.className = "results-review-detail";
      detail.textContent = detailText;
      item.append(detail);
    }
    elements.reviewAnswers.append(item);
  }

  function renderReview() {
    const record = state.review.annotations[state.review.currentIndex];
    const question = state.review.questionsById.get(String(record.sample_id));
    const assignedCertainty = record.certainty_assigned;
    const intendedCertainty = record.certainty_intended || question.certainty;
    const matchesCertainty = ["C1", "C2", "C3"].includes(assignedCertainty) &&
      assignedCertainty === intendedCertainty;

    elements.reviewPosition.textContent = `Saved response ${state.review.currentIndex + 1} of ${state.review.annotations.length}`;
    elements.reviewSampleId.textContent = `${record.sample_id} - Sample ${question.sampleNumber}`;
    renderHighlightedText(elements.reviewQuestion, question.text, question.statement);
    elements.reviewOptions.replaceChildren();
    (question.options || []).forEach((option) => {
      const item = document.createElement("li");
      item.textContent = option;
      elements.reviewOptions.append(item);
    });
    elements.reviewOptions.classList.toggle("hidden", !(question.options && question.options.length));
    elements.reviewOriginalQuestion.textContent = question.original_text || "Original question unavailable.";

    elements.reviewAnswers.replaceChildren();
    appendReviewAnswer(
      "1. Certainty strength selected",
      `${certaintyLabel(assignedCertainty)}${assignedCertainty ? ` (${assignedCertainty})` : ""}`,
      `Assigned in dataset: ${certaintyLabel(intendedCertainty)} (${intendedCertainty}) - ` +
        (matchesCertainty ? "matches" : "does not match"),
      matchesCertainty ? "yes" : "no"
    );
    appendReviewAnswer(
      "2. Hypothetical and unconfirmed",
      yesNoLabel(record.is_hypothetical),
      "Does the inserted sentence present only an unconfirmed possibility?",
      record.is_hypothetical
    );
    appendReviewAnswer(
      "3. Natural and coherent fit",
      yesNoLabel(record.fits_naturally || record.answer),
      "Does the inserted sentence read as if it belongs in the question?",
      record.fits_naturally || record.answer
    );

    elements.reviewComment.textContent = record.comment || "No comment provided.";
    elements.reviewComment.classList.toggle("empty", !record.comment);
    elements.reviewFlag.textContent = record.flag_for_review ? "Flagged for review" : "Not flagged";
    elements.reviewFlag.className = record.flag_for_review ? "flagged" : "";
    elements.reviewTime.textContent = formatDuration(Number(record.ms_on_item));
    elements.reviewSavedAt.textContent = `Saved ${formatLastSave(record.timestamp)}`;
    elements.reviewPrevious.disabled = state.review.currentIndex === 0;
    elements.reviewNext.disabled = state.review.currentIndex === state.review.annotations.length - 1;
    elements.reviewContent.scrollTop = 0;
  }

  async function openReview(user, trigger) {
    const datasetId = state.datasetId;
    const dataset = config.datasets[datasetId];
    const requestId = state.review.requestId + 1;
    state.review.requestId = requestId;
    state.review.returnFocus = trigger;
    state.review.open = true;
    state.review.currentIndex = 0;

    if (reviewCloseTimer !== null) {
      clearTimeout(reviewCloseTimer);
      reviewCloseTimer = null;
    }
    elements.reviewRound.textContent = dataset.label;
    elements.reviewTitle.textContent = `${user.displayName}'s saved responses`;
    elements.reviewSubtitle.textContent = `Reviewing ${user.username}`;
    elements.reviewLoading.classList.remove("hidden");
    elements.reviewError.classList.add("hidden");
    elements.reviewContent.classList.add("hidden");
    elements.reviewBackdrop.classList.remove("hidden");
    elements.reviewPanel.classList.remove("hidden");
    document.body.classList.add("results-review-open");
    elements.main.inert = true;
    elements.header.inert = true;
    elements.reviewPanel.getBoundingClientRect();
    elements.reviewPanel.classList.add("is-open");
    elements.reviewClose.focus();

    try {
      const [questionResponse, payload] = await Promise.all([
        fetch(dataset.questionsPath, { cache: "no-store" }),
        api.loadAdminAnnotations(user.username, datasetId)
      ]);
      if (!questionResponse.ok) throw new Error("The questions file could not be loaded.");
      const questions = normalizeQuestions(await questionResponse.json());
      const questionsById = new Map(questions.map((question) => [question.id, question]));
      const annotations = (payload.annotations || [])
        .filter((record) => record && questionsById.has(String(record.sample_id)))
        .sort((left, right) => left.question_index - right.question_index);
      if (requestId !== state.review.requestId || !state.review.open) return;
      if (annotations.length === 0) throw new Error(`${user.displayName} has no saved responses in ${dataset.label}.`);
      state.review.annotations = annotations;
      state.review.questionsById = questionsById;
      elements.reviewLoading.classList.add("hidden");
      elements.reviewContent.classList.remove("hidden");
      renderReview();
    } catch (error) {
      if (requestId !== state.review.requestId || !state.review.open) return;
      elements.reviewLoading.classList.add("hidden");
      elements.reviewError.textContent = error.message || "The saved responses could not be loaded.";
      elements.reviewError.classList.remove("hidden");
    }
  }

  function closeReview() {
    if (!state.review.open) return;
    state.review.open = false;
    state.review.requestId += 1;
    elements.reviewPanel.classList.remove("is-open");
    elements.reviewBackdrop.classList.add("hidden");
    document.body.classList.remove("results-review-open");
    elements.main.inert = false;
    elements.header.inert = false;
    state.review.returnFocus?.focus();
    reviewCloseTimer = setTimeout(() => {
      elements.reviewPanel.classList.add("hidden");
      reviewCloseTimer = null;
    }, 240);
  }

  function renderTable(rows) {
    elements.tableBody.replaceChildren();
    const rowsByDataset = Object.fromEntries(
      Object.entries(state.statusByDataset).map(([datasetId, data]) => [
        datasetId,
        new Map(data.rows.map((row) => [row.user.username, row]))
      ])
    );
    rows.forEach(({ user, summary, status: statusKey }) => {
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
        const button = document.createElement("button");
        button.className = "table-link";
        button.type = "button";
        button.textContent = "Review";
        button.addEventListener("click", () => openReview(user, button));
        actionCell.append(button);
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
    closeReview();
    state.datasetId = elements.datasetSelect.value;
    sessionStorage.setItem(config.datasetStorageKey, state.datasetId);
    refreshDashboard().catch(showFatalError);
  });
  elements.retry.addEventListener("click", () => window.location.reload());
  elements.reviewClose.addEventListener("click", closeReview);
  elements.reviewBackdrop.addEventListener("click", closeReview);
  elements.reviewPrevious.addEventListener("click", () => {
    if (state.review.currentIndex === 0) return;
    state.review.currentIndex -= 1;
    renderReview();
  });
  elements.reviewNext.addEventListener("click", () => {
    if (state.review.currentIndex >= state.review.annotations.length - 1) return;
    state.review.currentIndex += 1;
    renderReview();
  });
  document.addEventListener("keydown", (event) => {
    if (!state.review.open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeReview();
    } else if (event.key === "ArrowLeft" && document.activeElement?.tagName !== "BUTTON") {
      elements.reviewPrevious.click();
    } else if (event.key === "ArrowRight" && document.activeElement?.tagName !== "BUTTON") {
      elements.reviewNext.click();
    }
  });
  elements.logout.addEventListener("click", () => {
    api.clearSession();
    sessionStorage.removeItem(config.currentIndexStorageKey);
    window.location.assign("index.html");
  });

  initialize();
})();
