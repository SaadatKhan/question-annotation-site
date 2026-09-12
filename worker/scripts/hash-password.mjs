import { createHmac, randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { hiddenQuestion } from "./prompts.mjs";

const readline = createInterface({ input: stdin, output: stdout });
const username = (await readline.question("Username: ")).trim();
const displayName = (await readline.question("Display name: ")).trim();
const roleAnswer = (await readline.question("Role (admin/annotator): ")).trim().toLowerCase();
let password;
let confirmation;
let pepper = process.env.PASSWORD_PEPPER || "";
if (stdin.isTTY && typeof stdin.setRawMode === "function") {
  readline.close();
  if (!pepper) pepper = await hiddenQuestion("PASSWORD_PEPPER");
  password = await hiddenQuestion("Password");
  confirmation = await hiddenQuestion("Confirm password");
} else {
  readline.close();
  throw new Error("Run this command in an interactive terminal.");
}

if (!/^[A-Za-z0-9_-]{2,40}$/.test(username)) throw new Error("Username must be 2-40 letters, numbers, underscores, or hyphens.");
if (!displayName) throw new Error("Display name is required.");
if (!["admin", "annotator"].includes(roleAnswer)) throw new Error("Role must be admin or annotator.");
if (password.length < 12) throw new Error("Use a password containing at least 12 characters.");
if (password !== confirmation) throw new Error("The passwords do not match.");
if (pepper.length < 32) throw new Error("PASSWORD_PEPPER must contain at least 32 characters.");

const salt = randomBytes(16);
const passwordHash = createHmac("sha256", pepper).update(`${salt.toString("base64url")}:${password}`).digest();
const base64url = (value) => value.toString("base64url");

stdout.write("\nAdd this object to the AUTH_USERS_JSON secret:\n");
stdout.write(`${JSON.stringify({
  username,
  displayName,
  role: roleAnswer,
  enabled: true,
  salt: base64url(salt),
  passwordHash: base64url(passwordHash)
}, null, 2)}\n`);
