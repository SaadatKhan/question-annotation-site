window.APP_CONFIG = Object.freeze({
  githubOwner: "SaadatKhan",
  resultsRepo: "question-annotation-results",
  resultsBranch: "main",
  annotationsDirectory: "annotations",
  questionsPath: "data/questions.json",
  apiBaseUrl: "https://question-annotation-api.question-annotation-site.workers.dev",

  appTitle: "Annotating Hypothetical Injections",
  annotationTasks: Object.freeze([
    Object.freeze({
      field: "is_hypothetical",
      question: "Does the inserted sentence express a hypothetical?"
    }),
    Object.freeze({
      field: "matches_certainty_strength",
      question: "Does the inserted sentence match the assigned certainty strength?",
      showCertainty: true
    }),
    Object.freeze({
      field: "fits_naturally",
      question: "Does the inserted sentence fit naturally and coherently in the question?"
    })
  ]),
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
