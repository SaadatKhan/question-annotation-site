# Annotating Hypothetical Injections

A small research annotation application with a 24-sample training round and a 300-sample test-validation set, all from the base arm. GitHub Pages hosts the interface, a Cloudflare Worker handles username/password authentication, and each annotation is saved directly to a private GitHub results repository.

## Architecture

```text
GitHub Pages (public interface)
        |
        | signed application session
        v
Cloudflare Worker (private credentials and GitHub token)
        |
        v
SaadatKhan/question-annotation-results (private JSONL files)
```

Annotators never receive a GitHub token and do not need access to the results repository. Passwords, password hashes, the password pepper, session secret, and GitHub token must never be committed to this repository.

## Repository layout

```text
question-annotation-site/
|-- index.html                 Username/password sign-in
|-- annotate.html              Annotation workspace
|-- admin.html                 Admin-only progress dashboard
|-- css/style.css              Responsive interface
|-- data/questions.json        Sanitized test-validation dataset
|-- data/training-questions.json  Sanitized training dataset
|-- guidelines/                Public annotation guideline PDF
|-- js/api.js                  Browser-to-Worker client
|-- js/config.js               Public application configuration
|-- js/login.js                Login workflow
|-- js/annotate.js             Annotation workflow
|-- js/admin.js                Admin dashboard
|-- worker/src/index.js        Authentication and GitHub API
|-- worker/scripts/            Local secret helpers
`-- wrangler.toml              Cloudflare Worker configuration
```

## Results

Annotations are separated by annotator and study set in the private results repository:

```text
annotations/<username>/training-round.jsonl
annotations/<username>/test-validation.jsonl
```

This separation supports independent inter-annotator agreement calculations for training and test-validation responses. A legacy `annotations/<username>.jsonl` remains readable as test-validation data and is migrated into the nested layout on the user's next save.

The first and most recent successful login are stored as:

```text
activity/<username>.json
```

The annotation workspace opens `guidelines/annotation-guideline-2026-09-17.pdf` in a slide-in viewer. Like the rest of the GitHub Pages site, this PDF is publicly accessible to anyone with its URL; it contains no account credentials or private annotation results.

Each completed sample records a three-level certainty judgment (`C1` Weak, `C2` Moderate, `C3` Strong) and two Yes/No judgments: whether the inserted possibility remains unconfirmed without introducing additional clinical detail, and whether the sentence fits the question. The optional comment and could-not-decide flag are available for every sample. The interface preserves line breaks embedded in question text.

For the test-validation set, `JonathanNebiyu` and `NathanQuan` receive samples 1-150, while `PariKansara` and `HaifaAbdulhamid` receive samples 151-300. For the training round, the same pairs receive samples 1-12 and 13-24 respectively. Administrators receive every sample in both sets. The Worker enforces these ranges in addition to the browser filtering them.

The public dataset combines the original 270 base records with 30 records selected from `dataset_59_val_base.jsonl`. The added source IDs are recorded in `scripts/question-selection.mjs`; none come from the distractor arm, and source IDs 4, 8, 25, 45, 51, and 54 are explicitly excluded. The selected records are balanced across patient/clinician roles and retain approximately proportional source and certainty classes. Gold answers and source metadata are removed from the browser dataset.

The training round uses 24 different records from `dataset_59_val_base.jsonl`. It does not overlap the 30 added test-validation records and excludes source IDs 24 and 36. Each 12-sample assignment contains six patient and six clinician perspectives with matching source-strength distributions. The exact ordered selection is also recorded in `scripts/question-selection.mjs`.

Every save reads the latest annotator file, replaces the record with the same `sample_id`, and commits the updated JSONL file. GitHub write conflicts are fetched and retried twice. Older records remain readable as partial annotations, but a sample counts as complete only after all three current judgments are saved. New records store the displayed and selected certainty levels, the two Yes/No answers, and milliseconds spent on the item.

## Initial setup

Install Node.js 22 or newer, then install the development dependency:

```powershell
npm.cmd install
```

Authenticate Wrangler with the Cloudflare account that will own the Worker:

```powershell
npx.cmd wrangler login
```

Create a fine-grained GitHub token owned by `SaadatKhan`, limited to `question-annotation-results`, with only **Contents: Read and write** permission. Store it as an encrypted Worker secret:

```powershell
npx.cmd wrangler secret put GITHUB_TOKEN
```

Generate and store a random session secret:

```powershell
npm.cmd run generate-secret
npx.cmd wrangler secret put SESSION_SECRET
```

Create the admin and annotator accounts locally. The passwords are hidden while you type and are never written to disk:

```powershell
npm.cmd run setup-users
```

This creates ignored local files containing keyed password hashes and a random password pepper. Upload both as encrypted Worker secrets:

```powershell
Get-Content -Raw .password-pepper | npx.cmd wrangler secret put PASSWORD_PEPPER
Get-Content -Raw auth-users.json | npx.cmd wrangler secret put AUTH_USERS_JSON
```

Deploy the Worker:

```powershell
npm.cmd run deploy:api
```

Copy the resulting `workers.dev` URL into `apiBaseUrl` in `js/config.js`. Do not publish the changed GitHub Pages login until the Worker is deployed and that URL has been updated.

## Account management

- Add a user by generating a password hash, adding the object to `auth-users.json`, and uploading `AUTH_USERS_JSON` again.
- Disable a user by setting `"enabled": false` and uploading the secret again.
- Change a password by generating a replacement user object with the same username.
- Invalidate every active login by replacing `SESSION_SECRET`.
- Usernames determine JSONL filenames and should not be changed after annotation begins.

The admin dashboard distinguishes accounts that have never signed in, users who signed in but have not saved, active annotators, completed annotators, and disabled accounts. Only a session whose server-side role is `admin` can request dashboard data.

## Local development

Create an ignored `.dev.vars` containing development-only values for `GITHUB_TOKEN`, `SESSION_SECRET`, `PASSWORD_PEPPER`, and `AUTH_USERS_JSON`, then run:

```powershell
npm run dev:api
node scripts/serve.mjs
```

The Worker runs at `http://localhost:8787` and the static site runs at `http://localhost:8080`. Temporarily set `apiBaseUrl` to the local Worker URL while testing, then restore the production Worker URL before publishing.

## Tests

```powershell
npm test
```

## Free-tier boundaries

This project uses the Workers Free plan and does not require D1, KV, paid hosting, or paid GitHub features. The login endpoint is limited to ten attempts per IP per minute. Monitor Worker usage and keep the account on the Free plan so exceeding a platform limit causes requests to fail instead of creating usage charges.

The static site and sanitized question dataset remain public. The Cloudflare Worker and private GitHub repository protect credentials and annotation results, but this design is intended for a small trusted research team rather than regulated or highly sensitive data.
