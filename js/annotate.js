(function () {
  "use strict";

  const config = window.APP_CONFIG;
  const client = window.AnnotationApi;
  const elements = {
    loading: document.getElementById("loading-state"),
    error: document.getElementById("error-state"),
    errorMessage: document.getElementById("error-message"),
    retry: document.getElementById("retry-button"),
    workspace: document.getElementById("workspace"),
    appTitle: document.getElementById("app-title"),
    annotatorName: document.getElementById("annotator-name"),
    adminLink: document.getElementById("admin-link"),
    guidelinesButton: document.getElementById("guidelines-button"),
    guidelinesBackdrop: document.getElementById("guidelines-backdrop"),
    guidelinesPanel: document.getElementById("guidelines-panel"),
    guidelinesClose: document.getElementById("guidelines-close"),
    guidelinesFrame: document.getElementById("guidelines-frame"),
    main: document.querySelector("main"),
    header: document.querySelector(".app-header"),
    logout: document.getElementById("logout-button"),
    progressCount: document.getElementById("progress-count"),
    progressRange: document.getElementById("progress-range"),
    progressPercent: document.getElementById("progress-percent"),
    itemTimer: document.getElementById("item-timer"),
    progressTrack: document.querySelector(".progress-track"),
    progressFill: document.getElementById("progress-fill"),
    completion: document.getElementById("completion-panel"),
    review: document.getElementById("review-button"),
    panel: document.getElementById("annotation-panel"),
    samplePosition: document.getElementById("sample-position"),
    saveState: document.getElementById("save-state"),
    jumpForm: document.getElementById("jump-form"),
    jumpInput: document.getElementById("jump-input"),
    sampleId: document.getElementById("sample-id"),
    injectedQuestion: document.getElementById("injected-question"),
    originalQuestion: document.getElementById("original-question"),
    questionOptions: document.getElementById("question-options"),
    form: document.getElementById("annotation-form"),
    tasks: document.getElementById("annotation-tasks"),
    comment: document.getElementById("comment"),
    commentCount: document.getElementById("comment-count"),
    flag: document.getElementById("flag-review"),
    formMessage: document.getElementById("form-message"),
    previous: document.getElementById("previous-button"),
    next: document.getElementById("next-button"),
    save: document.getElementById("save-button")
  };

  const state = {
    questions: [],
    annotations: new Map(),
    currentIndex: 0,
    username: "",
    assignment: { start: 1, end: 300, total: 300 },
    totalQuestions: 300,
    itemStartedAt: Date.now(),
    guidelinesOpenedAt: null,
    guidelinesReturnFocus: null,
    dirty: false,
    saving: false
  };

  const certaintyHints = {
    C1: "Written as Weak: one possibility among several. Examples: might be, could be, cannot be ruled out.",
    C2: "Written as Moderate: the leading candidate, still open. Examples: probably, seems likely.",
    C3: "Written as Strong: close to settled, still a judgment. Examples: almost certainly, strongly favors."
  };
  let guidelinesCloseTimer = null;

  function updateItemTimer() {
    const seconds = Math.floor(((state.guidelinesOpenedAt || Date.now()) - state.itemStartedAt) / 1000);
    elements.itemTimer.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function openGuidelines() {
    if (state.guidelinesOpenedAt !== null) return;
    if (guidelinesCloseTimer !== null) {
      clearTimeout(guidelinesCloseTimer);
      guidelinesCloseTimer = null;
    }
    state.guidelinesReturnFocus = document.activeElement;
    state.guidelinesOpenedAt = Date.now();
    if (!elements.guidelinesFrame.src) elements.guidelinesFrame.src = elements.guidelinesFrame.dataset.src;
    elements.guidelinesBackdrop.classList.remove("hidden");
    elements.guidelinesPanel.classList.remove("hidden");
    document.body.classList.add("guidelines-open");
    elements.main.inert = true;
    elements.header.inert = true;
    elements.guidelinesPanel.getBoundingClientRect();
    elements.guidelinesPanel.classList.add("is-open");
    elements.guidelinesClose.focus();
  }

  function closeGuidelines() {
    if (state.guidelinesOpenedAt === null) return;
    state.itemStartedAt += Date.now() - state.guidelinesOpenedAt;
    state.guidelinesOpenedAt = null;
    updateItemTimer();
    elements.guidelinesPanel.classList.remove("is-open");
    document.body.classList.remove("guidelines-open");
    elements.guidelinesBackdrop.classList.add("hidden");
    elements.main.inert = false;
    elements.header.inert = false;
    state.guidelinesReturnFocus?.focus();
    guidelinesCloseTimer = setTimeout(() => {
      elements.guidelinesPanel.classList.add("hidden");
      guidelinesCloseTimer = null;
    }, 240);
  }

  function setFormMessage(message, type = "") {
    elements.formMessage.textContent = message;
    elements.formMessage.className = `status${type ? ` ${type}` : ""}`;
  }

  function showFatalError(error) {
    elements.loading.classList.add("hidden");
    elements.workspace.classList.add("hidden");
    elements.error.classList.remove("hidden");
    let message = error.message || "An unexpected error occurred.";
    if (error instanceof client.ApiError && error.status === 401) {
      client.clearSession();
      message = "Your login session has expired. Return to sign in.";
    }
    elements.errorMessage.textContent = message;
  }

  function normalizeQuestions(payload) {
    if (!Array.isArray(payload) || payload.length === 0) {
      throw new Error("The questions file must contain a non-empty array.");
    }
    const seen = new Set();
    return payload.map((question, index) => {
      if (question.id === undefined || typeof question.text !== "string") {
        throw new Error(`Question ${index + 1} is missing its id or text.`);
      }
      if (!/^C[123]$/.test(question.certainty) || typeof question.certainty_label !== "string") {
        throw new Error(`Question ${index + 1} is missing its assigned certainty strength.`);
      }
      const id = String(question.id);
      const expectedId = `sample_${String(index).padStart(3, "0")}`;
      if (id !== expectedId) throw new Error(`Question ${index + 1} has an unexpected sample ID.`);
      if (seen.has(id)) throw new Error(`Duplicate question id: ${id}`);
      seen.add(id);
      return { ...question, id, questionIndex: index, sampleNumber: index + 1 };
    });
  }

  function createAnnotationTasks() {
    elements.tasks.replaceChildren();
    config.annotationTasks.forEach((task, taskIndex) => {
      const fieldset = document.createElement("fieldset");
      fieldset.className = "annotation-task";
      fieldset.dataset.task = task.field;

      const legend = document.createElement("legend");
      const number = document.createElement("span");
      number.className = "task-number";
      number.textContent = `${taskIndex + 1}. `;
      legend.append(number, document.createTextNode(task.question));
      fieldset.append(legend);

      if (task.hint !== undefined) {
        const hint = document.createElement("p");
        hint.className = "task-hint";
        if (task.field === "certainty_assigned") hint.id = "certainty-hint";
        hint.textContent = task.hint;
        fieldset.append(hint);
      }

      const options = document.createElement("div");
      options.className = "annotation-options";
      if (task.options) options.classList.add("three-options");
      (task.options || config.annotationOptions).forEach((option) => {
        const inputId = `${task.field}-${option.value}`;
        const label = document.createElement("label");
        label.className = "answer-option";
        label.htmlFor = inputId;
        const input = document.createElement("input");
        input.type = "radio";
        input.name = task.field;
        input.id = inputId;
        input.value = option.value;
        const text = document.createElement("span");
        text.textContent = option.label;
        label.append(input, text);
        options.append(label);
      });
      fieldset.append(options);
      elements.tasks.append(fieldset);
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

  function selectedAnswers() {
    return Object.fromEntries(config.annotationTasks.map((task) => {
      const checked = elements.form.querySelector(`input[name="${task.field}"]:checked`);
      return [task.field, checked ? checked.value : ""];
    }));
  }

  function allTasksAnswered() {
    const answers = selectedAnswers();
    return ["C1", "C2", "C3"].includes(answers.certainty_assigned) &&
      ["yes", "no"].includes(answers.is_hypothetical) &&
      ["yes", "no"].includes(answers.fits_naturally);
  }

  function isCompleteAnnotation(record) {
    return Boolean(record && ["C1", "C2", "C3"].includes(record.certainty_assigned) &&
      ["yes", "no"].includes(record.is_hypothetical) &&
      ["yes", "no"].includes(record.fits_naturally));
  }

  function savedTaskAnswer(saved, field) {
    if (!saved) return "";
    if (field === "fits_naturally" && !saved[field] && ["yes", "no"].includes(saved.answer)) {
      return saved.answer;
    }
    return saved[field] || "";
  }

  function currentQuestion() {
    return state.questions[state.currentIndex];
  }

  function updateCommentCount() {
    elements.commentCount.textContent = `${elements.comment.value.length} / ${config.maxCommentLength}`;
  }

  function updateSaveState() {
    const saved = state.annotations.get(currentQuestion().id);
    const isSaved = isCompleteAnnotation(saved);
    elements.saveState.className = "save-state";
    if (state.dirty) {
      elements.saveState.textContent = "Unsaved changes";
      elements.saveState.classList.add("unsaved");
    } else if (isSaved) {
      elements.saveState.textContent = "Saved";
      elements.saveState.classList.add("saved");
    } else if (saved) {
      elements.saveState.textContent = "Needs remaining answers";
      elements.saveState.classList.add("unsaved");
    } else {
      elements.saveState.textContent = "Not yet saved";
    }
  }

  function updateSaveButton() {
    elements.save.disabled = state.saving || !allTasksAnswered();
  }

  function updateProgress() {
    const validIds = new Set(state.questions.map((question) => question.id));
    const completed = Array.from(state.annotations.entries()).filter(
      ([id, record]) => validIds.has(id) && isCompleteAnnotation(record)
    ).length;
    const total = state.questions.length;
    const percent = total ? Math.round((completed / total) * 100) : 0;
    elements.progressCount.textContent = `${completed} of ${total} saved`;
    elements.progressPercent.textContent = `${percent}%`;
    elements.progressFill.style.width = `${percent}%`;
    elements.progressTrack.setAttribute("aria-valuemax", String(total));
    elements.progressTrack.setAttribute("aria-valuenow", String(completed));
    return completed;
  }

  function renderQuestion() {
    const question = currentQuestion();
    const saved = state.annotations.get(question.id);
    state.dirty = false;
    setFormMessage("");

    elements.samplePosition.textContent = `Sample ${question.sampleNumber} of ${state.totalQuestions}`;
    elements.sampleId.textContent = question.id;
    elements.jumpInput.min = String(state.assignment.start);
    elements.jumpInput.max = String(state.assignment.end);
    elements.jumpInput.value = String(question.sampleNumber);

    renderHighlightedText(elements.injectedQuestion, question.text, question.statement);
    elements.originalQuestion.textContent = question.original_text || "Original question unavailable.";
    elements.questionOptions.replaceChildren();
    (question.options || []).forEach((option) => {
      const item = document.createElement("li");
      item.textContent = option;
      elements.questionOptions.append(item);
    });
    elements.questionOptions.classList.toggle("hidden", !(question.options && question.options.length));

    elements.form.reset();
    const certaintyBadge = document.getElementById("assigned-certainty");
    certaintyBadge.textContent = ({ C1: "Weak", C2: "Moderate", C3: "Strong" })[question.certainty];
    document.getElementById("certainty-hint").textContent = certaintyHints[question.certainty];
    elements.comment.value = saved && typeof saved.comment === "string" ? saved.comment : "";
    elements.flag.checked = Boolean(saved && saved.flag_for_review);
    config.annotationTasks.forEach((task) => {
      const answer = savedTaskAnswer(saved, task.field);
      const answerInput = elements.form.querySelector(`input[name="${task.field}"][value="${answer}"]`);
      if (answerInput) answerInput.checked = true;
    });

    updateCommentCount();
    state.itemStartedAt = Date.now();
    updateItemTimer();
    updateSaveState();
    updateSaveButton();
    elements.previous.disabled = state.currentIndex === 0;
    elements.next.disabled = state.currentIndex === state.questions.length - 1;
    sessionStorage.setItem(config.currentIndexStorageKey, String(state.currentIndex));
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function confirmNavigation() {
    return !state.dirty || window.confirm("Discard the unsaved changes to this sample?");
  }

  function goToQuestion(index) {
    if (index < 0 || index >= state.questions.length || index === state.currentIndex) return;
    if (!confirmNavigation()) return;
    state.currentIndex = index;
    renderQuestion();
  }

  function findFirstUnanswered(startIndex = 0) {
    for (let offset = 0; offset < state.questions.length; offset += 1) {
      const index = (startIndex + offset) % state.questions.length;
      if (!isCompleteAnnotation(state.annotations.get(state.questions[index].id))) return index;
    }
    return -1;
  }

  function showCompletion() {
    elements.completion.classList.remove("hidden");
    elements.panel.classList.add("hidden");
  }

  function markDirty() {
    if (state.saving) return;
    state.dirty = true;
    updateSaveState();
    updateSaveButton();
    setFormMessage("");
  }

  async function saveCurrentAnnotation() {
    const answers = selectedAnswers();
    if (!allTasksAnswered() || state.saving) return;

    const question = currentQuestion();
    const record = {
      sample_id: question.id,
      question_index: question.questionIndex,
      certainty_intended: question.certainty,
      ms_on_item: Math.max(0, Date.now() - state.itemStartedAt),
      ...answers,
      comment: elements.comment.value.trim(),
      flag_for_review: elements.flag.checked,
      annotator: state.username,
      timestamp: new Date().toISOString()
    };

    state.saving = true;
    elements.tasks.querySelectorAll("fieldset").forEach((fieldset) => { fieldset.disabled = true; });
    elements.comment.disabled = true;
    elements.flag.disabled = true;
    elements.previous.disabled = true;
    elements.next.disabled = true;
    elements.save.disabled = true;
    elements.save.textContent = "Saving...";
    setFormMessage("Saving to GitHub...");

    try {
      const savedRecord = await client.saveAnnotation(record);
      state.annotations.set(question.id, savedRecord);
      state.dirty = false;
      updateProgress();
      setFormMessage("Saved to GitHub.", "success");

      const nextIndex = findFirstUnanswered(state.currentIndex + 1);
      if (nextIndex === -1) {
        showCompletion();
      } else {
        state.currentIndex = nextIndex;
        renderQuestion();
      }
    } catch (error) {
      setFormMessage(error.message || "The annotation could not be saved. Try again.", "error");
    } finally {
      state.saving = false;
      elements.tasks.querySelectorAll("fieldset").forEach((fieldset) => { fieldset.disabled = false; });
      elements.comment.disabled = false;
      elements.flag.disabled = false;
      elements.save.textContent = "Save & Next";
      if (!elements.panel.classList.contains("hidden")) {
        elements.previous.disabled = state.currentIndex === 0;
        elements.next.disabled = state.currentIndex === state.questions.length - 1;
        updateSaveButton();
        updateSaveState();
      }
    }
  }

  function bindEvents() {
    elements.guidelinesButton.addEventListener("click", openGuidelines);
    elements.guidelinesClose.addEventListener("click", closeGuidelines);
    elements.guidelinesBackdrop.addEventListener("click", closeGuidelines);
    elements.form.addEventListener("change", markDirty);
    elements.comment.addEventListener("input", () => {
      updateCommentCount();
      markDirty();
    });
    elements.form.addEventListener("submit", (event) => {
      event.preventDefault();
      saveCurrentAnnotation();
    });
    elements.previous.addEventListener("click", () => goToQuestion(state.currentIndex - 1));
    elements.next.addEventListener("click", () => goToQuestion(state.currentIndex + 1));
    elements.jumpForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const sampleNumber = Number.parseInt(elements.jumpInput.value, 10);
      if (!Number.isInteger(sampleNumber) || sampleNumber < state.assignment.start || sampleNumber > state.assignment.end) {
        setFormMessage(`Enter a sample number from ${state.assignment.start} to ${state.assignment.end}.`, "error");
        return;
      }
      goToQuestion(sampleNumber - state.assignment.start);
    });
    elements.review.addEventListener("click", () => {
      elements.completion.classList.add("hidden");
      elements.panel.classList.remove("hidden");
      state.currentIndex = 0;
      renderQuestion();
    });
    elements.logout.addEventListener("click", () => {
      if (!confirmNavigation()) return;
      client.clearSession();
      sessionStorage.removeItem(config.currentIndexStorageKey);
      window.location.assign("index.html");
    });
    elements.retry.addEventListener("click", () => window.location.reload());
    window.addEventListener("beforeunload", (event) => {
      if (!state.dirty) return;
      event.preventDefault();
      event.returnValue = "";
    });
    document.addEventListener("keydown", (event) => {
      if (state.guidelinesOpenedAt !== null) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeGuidelines();
        }
        return;
      }
      if (state.saving || elements.panel.classList.contains("hidden")) return;
      const tagName = event.target.tagName;
      const isTyping = tagName === "INPUT" || tagName === "TEXTAREA";
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        if (allTasksAnswered()) elements.form.requestSubmit();
        return;
      }
      if (isTyping) return;
      if (event.key === "ArrowLeft") {
        goToQuestion(state.currentIndex - 1);
      } else if (event.key === "ArrowRight") {
        goToQuestion(state.currentIndex + 1);
      }
    });
  }

  async function initialize() {
    try {
      if (!client.getStoredToken()) {
        window.location.replace("index.html");
        return;
      }

      const [session, questionResponse] = await Promise.all([
        client.getSession(),
        fetch(config.questionsPath, { cache: "no-store" })
      ]);
      if (!questionResponse.ok) throw new Error("The questions file could not be loaded.");

      const user = session.user;
      const assignment = user.assignment;
      if (!assignment || !Number.isInteger(assignment.start) || !Number.isInteger(assignment.end) ||
          !Number.isInteger(assignment.total) || assignment.total !== assignment.end - assignment.start + 1) {
        throw new Error("Your question assignment is invalid.");
      }
      state.username = user.username;
      state.assignment = assignment;
      sessionStorage.setItem(config.currentUserStorageKey, JSON.stringify(user));
      document.title = `${config.appTitle} - ${user.displayName}`;
      elements.appTitle.textContent = config.appTitle;
      elements.annotatorName.textContent = user.displayName;
      elements.adminLink.classList.toggle("hidden", user.role !== "admin");
      elements.comment.maxLength = config.maxCommentLength;
      createAnnotationTasks();
      bindEvents();
      window.setInterval(updateItemTimer, 1000);

      const allQuestions = normalizeQuestions(await questionResponse.json());
      state.totalQuestions = allQuestions.length;
      state.questions = allQuestions.slice(assignment.start - 1, assignment.end);
      if (state.questions.length !== assignment.total) throw new Error("Your assigned questions could not be loaded.");
      elements.progressRange.textContent = assignment.total === allQuestions.length
        ? `All samples ${assignment.start}-${assignment.end}`
        : `Assigned samples ${assignment.start}-${assignment.end}`;
      state.annotations = await client.loadAnnotations();
      const unansweredIndex = findFirstUnanswered();
      if (unansweredIndex === -1) {
        state.currentIndex = 0;
        showCompletion();
      } else {
        state.currentIndex = unansweredIndex;
        renderQuestion();
      }

      updateProgress();
      elements.loading.classList.add("hidden");
      elements.error.classList.add("hidden");
      elements.workspace.classList.remove("hidden");
    } catch (error) {
      showFatalError(error);
    }
  }

  initialize();
})();
