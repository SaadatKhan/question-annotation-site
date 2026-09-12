import { stdin, stdout } from "node:process";

export function hiddenQuestion(prompt) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("Run this command in an interactive terminal.");
  }
  return new Promise((resolve, reject) => {
    let value = "";
    let settled = false;
    stdout.write(`${prompt}: `);
    stdin.setRawMode(true);
    stdin.resume();

    const finish = (result, error) => {
      if (settled) return;
      settled = true;
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      stdout.write("\n");
      if (error) reject(error);
      else resolve(result);
    };

    const onData = (chunk) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") {
          finish("", new Error("Cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish(value);
          return;
        }
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else value += character;
      }
    };

    stdin.on("data", onData);
  });
}
