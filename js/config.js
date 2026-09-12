window.APP_CONFIG = Object.freeze({
  githubOwner: "SaadatKhan",
  resultsRepo: "question-annotation-results",
  resultsBranch: "main",
  annotationsDirectory: "annotations",
  questionsPath: "data/questions.json",
  apiBaseUrl: "https://question-annotation-api.question-annotation-site.workers.dev",

  appTitle: "Annotating Hypothetical Injections",
  annotationQuestion: "Does the inserted statement fit naturally and coherently in the question?",
  annotationOptions: Object.freeze([
    Object.freeze({ value: "yes", label: "Yes" }),
    Object.freeze({ value: "no", label: "No" })
  ]),

  tokenStorageKey: "annotation_login_token",
  sessionTokenStorageKey: "annotation_session_token",
  currentUserStorageKey: "annotation_current_user",
  currentIndexStorageKey: "annotation_current_index",
  maxCommentLength: 2000
});
