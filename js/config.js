window.APP_CONFIG = Object.freeze({
  githubOwner: "SaadatKhan",
  resultsRepo: "question-annotation-results",
  resultsBranch: "main",
  annotationsDirectory: "annotations",
  questionsPath: "data/questions.json",

  appTitle: "Injected Question Annotation",
  annotationQuestion: "Does the inserted statement fit naturally and coherently in the question?",
  annotationOptions: Object.freeze([
    Object.freeze({ value: "yes", label: "Yes" }),
    Object.freeze({ value: "no", label: "No" }),
    Object.freeze({ value: "unsure", label: "Unsure" })
  ]),

  tokenStorageKey: "annotation_github_token",
  sessionTokenStorageKey: "annotation_github_session_token",
  currentUserStorageKey: "annotation_current_user",
  currentIndexStorageKey: "annotation_current_index",
  maxCommentLength: 2000
});
