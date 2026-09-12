# Annotating Hypothetical Injections

A static research annotation application for 270 base-version questions. The site is hosted by GitHub Pages and writes one JSONL file per annotator to a separate private GitHub repository.

## Repository layout

```text
question-annotation-site/
|-- index.html                 Token sign-in
|-- annotate.html              Annotation workspace
|-- admin.html                 Admin-only progress dashboard
|-- css/style.css              Responsive research UI
|-- data/questions.json        Sanitized browser dataset
|-- js/config.js               Project and rubric configuration
|-- js/users.js                Approved GitHub annotators
|-- js/github.js               GitHub Contents API client
|-- js/login.js                Login and access verification
|-- js/annotate.js             Annotation workflow
|-- js/admin.js                Team status and progress reporting
`-- scripts/build-questions.mjs
```

Annotation output is stored in the private `SaadatKhan/question-annotation-results` repository as:

```text
annotations/<github-username>.jsonl
```

## Configure the study

Edit `js/config.js` to change:

- `appTitle`
- `annotationQuestion`
- `annotationOptions`
- the GitHub owner, results repository, or branch

Edit `js/users.js` to add approved annotators. Each key must exactly match a GitHub username:

```javascript
window.ANNOTATION_USERS = Object.freeze({
  SaadatKhan: Object.freeze({ displayName: "Saadat Khan", role: "admin" }),
  anotherGithubUser: Object.freeze({ displayName: "Annotator 2", role: "annotator" })
});
```

The token identifies the annotator through GitHub. The application does not contain passwords and will not accept a token belonging to a different allowlisted account.

## Build the questions file

The browser dataset is generated from the base-only JSONL file and omits `correct_answer`, `hypothesis_type`, and other study metadata that could reveal gold labels.

From this repository, run:

```powershell
node scripts/build-questions.mjs ../injected_270_base.jsonl
```

The script requires exactly 270 unique base records and writes `data/questions.json`.

## Create an annotator token

For the repository owner:

1. Open GitHub **Settings > Developer settings > Personal access tokens > Fine-grained tokens**.
2. Create a token with an expiration date.
3. Set the resource owner to `SaadatKhan`.
4. Select only `question-annotation-results`.
5. Grant repository **Contents: Read and write** permission.
6. For the admin dashboard, also grant **Administration: Read-only** permission.
7. Enter the token on the site's sign-in screen.

Do not commit a token to either repository. The site stores it only in that browser's local or session storage. Use a dedicated browser profile for shared or managed computers and sign out when finished.

## Run locally

Serve the repository over HTTP so the browser can load the dataset:

```powershell
node scripts/serve.mjs
```

Opening `index.html` directly with a `file:` URL will not work reliably because browsers restrict local `fetch` requests.

## Publish with GitHub Pages

1. Open the public repository's **Settings > Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select branch `main` and folder `/ (root)`.
4. Save and wait for the Pages deployment to finish.

The project site will be available at:

```text
https://saadatkhan.github.io/question-annotation-site/
```

## Save behavior

Each save fetches the latest annotator file, replaces the record with the same `sample_id`, and writes the full JSONL file using the current Git blob SHA. Conflicting updates are fetched and retried twice. The interface advances only after GitHub confirms the save.

Each record contains:

```json
{"sample_id":"sample_000","question_index":0,"answer":"yes","comment":"","flag_for_review":false,"annotator":"SaadatKhan","timestamp":"2026-09-12T15:32:07.000Z"}
```

## Admin dashboard

Users with `role: "admin"` can open `admin.html` from the annotation header. The page verifies the active GitHub identity before loading private data and shows:

- pending repository invitations
- accepted users who have not started
- completed records out of 270 for each annotator
- Yes, No, and flagged totals
- most recent save time
- a link to each existing private JSONL file

Pending invitation status requires **Administration: Read-only** repository permission. Without it, the rest of the dashboard remains available and displays a permission warning.

## Limitations

- The website and sanitized question dataset are public.
- GitHub Pages cannot keep browser-delivered source code or configuration secret.
- Tokens remain sensitive even when stored only in the browser.
- A personal-account results repository is simplest for the owner. Multi-annotator access should be reviewed before rollout because GitHub token choices differ for repository collaborators.
- The dashboard interface is restricted to configured admins, but GitHub collaborators can still browse all files in the private results repository. GitHub does not provide per-file collaborator permissions.
- This design is appropriate for a small trusted annotation team, not sensitive human-subject or regulated data.
