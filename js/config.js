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
      field: "certainty_assigned",
      question: "Which level of certainty does the inserted sentence express?",
      hint: "",
      options: Object.freeze([
        Object.freeze({ value: "C1", label: "Weak" }),
        Object.freeze({ value: "C2", label: "Moderate" }),
        Object.freeze({ value: "C3", label: "Strong" })
      ])
    }),
    Object.freeze({
      field: "is_hypothetical",
      question: "Does the inserted sentence present the possibility as unconfirmed, and add nothing else?",
      hint: "Unconfirmed: proposed, not established. Nothing else: no clinical detail the question did not already give. Test: cross the sentence out; only the possibility should be lost."
    }),
    Object.freeze({
      field: "fits_naturally",
      question: "Does the inserted sentence read as if it belongs in this question?",
      hint: "Check the kind of answer proposed, who is speaking, whether any source fits them, and whether the wording fits the vignette."
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
