import { createHmac, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { hiddenQuestion } from "./prompts.mjs";

const automatic = process.argv.includes("--generate");

if (automatic) {
  const accounts = [
    { username: "SaadatKhan", displayName: "Saadat Khan", role: "admin" },
    ...Array.from({ length: 4 }, (_, index) => ({
      username: `Annotator${index + 1}`,
      displayName: `Annotator ${index + 1}`,
      role: "annotator"
    }))
  ];
  const pepper = randomBytes(48).toString("base64url");
  const credentials = [];
  const users = accounts.map((account) => {
    const password = randomBytes(18).toString("base64url");
    const salt = randomBytes(16).toString("base64url");
    const passwordHash = createHmac("sha256", pepper).update(`${salt}:${password}`).digest("base64url");
    credentials.push(`${account.displayName}\nUsername: ${account.username}\nPassword: ${password}\n`);
    return { ...account, enabled: true, salt, passwordHash };
  });
  await writeFile("auth-users.json", `${JSON.stringify(users, null, 2)}\n`, { mode: 0o600 });
  await writeFile(".password-pepper", `${pepper}\n`, { mode: 0o600 });
  await writeFile("account-credentials.txt", `${credentials.join("\n")}\n`, { mode: 0o600 });
  stdout.write("Created five accounts. Open account-credentials.txt to view and distribute the passwords.\n");
  process.exit(0);
}

const readline = createInterface({ input: stdin, output: stdout });

const seen = new Set();

async function askUsername(prompt, fallback = "") {
  while (true) {
    const answer = (await readline.question(`${prompt}${fallback ? ` [${fallback}]` : ""}: `)).trim() || fallback;
    const key = answer.toLowerCase();
    if (!/^[A-Za-z0-9_-]{2,40}$/.test(answer)) {
      stdout.write("Use 2-40 letters, numbers, underscores, or hyphens with no spaces.\n");
      continue;
    }
    if (seen.has(key)) {
      stdout.write("That username is already in use.\n");
      continue;
    }
    seen.add(key);
    return answer;
  }
}

async function askDisplayName(prompt, fallback = "") {
  while (true) {
    const answer = (await readline.question(`${prompt}${fallback ? ` [${fallback}]` : ""}: `)).trim() || fallback;
    if (answer && answer.length <= 100) return answer;
    stdout.write("Enter a display name containing no more than 100 characters.\n");
  }
}

const countAnswer = (await readline.question("Number of annotators, not including the admin [4]: ")).trim();
const annotatorCount = countAnswer ? Number.parseInt(countAnswer, 10) : 4;
if (!Number.isInteger(annotatorCount) || annotatorCount < 1 || annotatorCount > 19) {
  readline.close();
  throw new Error("Choose between 1 and 19 annotators.");
}

const accounts = [];
const adminUsername = await askUsername("Admin username", "SaadatKhan");
const adminName = await askDisplayName("Admin display name", "Saadat Khan");
accounts.push({ username: adminUsername, displayName: adminName, role: "admin" });

for (let index = 0; index < annotatorCount; index += 1) {
  stdout.write(`\nAnnotator ${index + 1}\n`);
  const username = await askUsername("Username", `Annotator${index + 1}`);
  const displayName = await askDisplayName("Display name", `Annotator ${index + 1}`);
  accounts.push({ username, displayName, role: "annotator" });
}
readline.close();

const pepper = randomBytes(48).toString("base64url");
const users = [];
for (const account of accounts) {
  stdout.write(`\nSet password for ${account.displayName} (${account.username})\n`);
  const password = await hiddenQuestion("Password");
  const confirmation = await hiddenQuestion("Confirm password");
  if (password.length < 12) throw new Error(`The password for ${account.username} must contain at least 12 characters.`);
  if (password !== confirmation) throw new Error(`The passwords for ${account.username} do not match.`);
  const salt = randomBytes(16).toString("base64url");
  const passwordHash = createHmac("sha256", pepper).update(`${salt}:${password}`).digest("base64url");
  users.push({ ...account, enabled: true, salt, passwordHash });
}

await writeFile("auth-users.json", `${JSON.stringify(users, null, 2)}\n`, { mode: 0o600 });
await writeFile(".password-pepper", `${pepper}\n`, { mode: 0o600 });
stdout.write("\nCreated auth-users.json and .password-pepper. Plaintext passwords were not saved.\n");
