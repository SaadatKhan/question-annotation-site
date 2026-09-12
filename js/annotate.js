(function () {
  "use strict";

  const config = window.APP_CONFIG;
  const client = window.GitHubClient;
  const elements = {
    loading: document.getElementById("loading-state"),
    error: document.getElementById("error-state"),
    errorMessage: document.getElementById("error-message"),
    retry: document.getElementById("retry-button"),
    workspace: document.getElementById("workspace"),
    appTitle: document.getElementById("app-title"),
    annotatorName: document.getElementById("annotator-name"),
    logout: document.getElementById("logout-button"),
    progressCount: document.getElementById("progress-count"),
    progressPercent: document.getElementById("progress-percent"),
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
    fieldset: document.getElementById("answer-fieldset"),
    annotationQuestion: document.getElementById("annotation-question"),
    annotationOptions: document.getElementById("annotation-options"),
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
    token: "",
    dirty: false,
    saving: false
  };

  function approvedUser(username) {
    const key = Object.keys(window.ANNOTATION_USERS).find(
      (candidate) => candidate.toLowerCase() === username.toLowerCase()
    );
    return key ? { username: key, ...window.ANNOTATION_USERS[key] } : null;
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
    if (error instanceof client.GitHubApiError && error.status === 401) {
      message = "Your GitHub token is invalid or expired. Return to sign in and provide a new token.";
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
      const id = String(question.id);
      if (seen.has(id)) throw new Error(`Duplicate question id: ${id}`);
      seen.add(id);
      return { ...question, id };
    });
  }

  function createAnswerOptions() {
    elements.annotationOptions.replaceChildren();
    config.annotationOptions.forEach((option, index) => {
      const label = document.createElement("label");
      label.className = "answer-option";
      label.htmlFor = `answer-${option.value}`;

      const input = document.createElement("input");
      input.type = "radio";
      input.name = "answer";
      input.id = `answer-${option.value}`;
      input.value = option.value;
      input.dataset.shortcut = String(index + 1);

      const text = document.createElement("span");
      text.textContent = option.label;
      label.append(input, text);
      elements.annotationOptions.append(label);
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

  function selectedAnswer() {
    const checked = elements.form.querySelector('input[name="answer"]:checked');
    return checked ? checked.value : "";
  }

  function currentQuestion() {
    return state.questions[state.currentIndex];
  }

  function updateCommentCount() {
    elements.commentCount.textContent = `${elements.comment.value.length} / ${config.maxCommentLength}`;
  }

  function updateSaveState() {
    const isSaved = state.annotations.has(currentQuestion().id);
    elements.saveState.className = "save-state";
    if (state.dirty) {
      elements.saveState.textContent = "Unsaved changes";
      elements.saveState.classList.add("unsaved");
    } else if (isSaved) {
      elements.saveState.textContent = "Saved";
      elements.saveState.classList.add("saved");
    } else {
      elements.saveState.textContent = "Not yet saved";
    }
  }

  function updateSaveButton() {
    elements.save.disabled = state.saving || !selectedAnswer();
  }

  function updateProgress() {
    const validIds = new Set(state.questions.map((question) => question.id));
    const completed = Array.from(state.annotations.keys()).filter((id) => validIds.has(id)).length;
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

    elements.samplePosition.textContent = `Sample ${state.currentIndex + 1} of ${state.questions.length}`;
    elements.sampleId.textContent = question.id;
    elements.jumpInput.max = String(state.questions.length);
    elements.jumpInput.value = String(state.currentIndex + 1);

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
    elements.comment.value = saved && typeof saved.comment === "string" ? saved.comment : "";
    elements.flag.checked = Boolean(saved && saved.flag_for_review);
    if (saved && saved.answer) {
      const answerInput = Array.from(elements.form.elements.answer || []).find(
        (input) => input.value === saved.answer
      );
      if (answerInput) answerInput.checked = true;
    }

    updateCommentCount();
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
      if (!state.annotations.has(state.questions[index].id)) return index;
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
    const answer = selectedAnswer();
    if (!answer || state.saving) return;

    const question = currentQuestion();
    const record = {
      sample_id: question.id,
      question_index: state.currentIndex,
      answer,
      comment: elements.comment.value.trim(),
      flag_for_review: elements.flag.checked,
      annotator: state.username,
      timestamp: new Date().toISOString()
    };

    state.saving = true;
    elements.fieldset.disabled = true;
    elements.comment.disabled = true;
    elements.flag.disabled = true;
    elements.previous.disabled = true;
    elements.next.disabled = true;
    elements.save.disabled = true;
    elements.save.textContent = "Saving...";
    setFormMessage("Saving to GitHub...");

    try {
      await client.saveAnnotation(state.username, record, state.token);
      state.annotations.set(question.id, record);
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
      elements.fieldset.disabled = false;
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
      const target = Number.parseInt(elements.jumpInput.value, 10) - 1;
      if (!Number.isInteger(target) || target < 0 || target >= state.questions.length) {
        setFormMessage(`Enter a sample number from 1 to ${state.questions.length}.`, "error");
        return;
      }
      goToQuestion(target);
    });
    elements.review.addEventListener("click", () => {
      elements.completion.classList.add("hidden");
      elements.panel.classList.remove("hidden");
      state.currentIndex = 0;
      renderQuestion();
    });
    elements.logout.addEventListener("click", () => {
      if (!confirmNavigation()) return;
      client.clearToken();
      sessionStorage.removeItem(config.currentUserStorageKey);
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
      if (state.saving || elements.panel.classList.contains("hidden")) return;
      const tagName = event.target.tagName;
      const isTyping = tagName === "INPUT" || tagName === "TEXTAREA";
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        if (selectedAnswer()) elements.form.requestSubmit();
        return;
      }
      if (isTyping) return;
      const option = elements.form.querySelector(`input[data-shortcut="${event.key}"]`);
      if (option) {
        option.checked = true;
        markDirty();
      } else if (event.key === "ArrowLeft") {
        goToQuestion(state.currentIndex - 1);
      } else if (event.key === "ArrowRight") {
        goToQuestion(state.currentIndex + 1);
      }
    });
  }

  async function initialize() {
    try {
      state.token = client.getStoredToken();
      const sessionUsername = sessionStorage.getItem(config.currentUserStorageKey) || "";
      const user = approvedUser(sessionUsername);
      if (!state.token || !user) {
        window.location.replace("index.html");
        return;
      }

      state.username = user.username;
      document.title = `${config.appTitle} - ${user.displayName}`;
      elements.appTitle.textContent = config.appTitle;
      elements.annotatorName.textContent = user.displayName;
      elements.annotationQuestion.textContent = config.annotationQuestion;
      elements.comment.maxLength = config.maxCommentLength;
      createAnswerOptions();
      bindEvents();

      const [githubUser, questionResponse] = await Promise.all([
        client.verifyAccess(state.token),
        fetch(config.questionsPath, { cache: "no-store" })
      ]);
      if (!questionResponse.ok) throw new Error("The questions file could not be loaded.");
      if (githubUser.login.toLowerCase() !== state.username.toLowerCase()) {
        throw new Error("The active GitHub token does not match the signed-in annotator.");
      }

      state.questions = normalizeQuestions(await questionResponse.json());
      state.annotations = await client.loadAnnotations(state.username, state.token);
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
