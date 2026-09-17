import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("guidelines drawer references a valid hosted PDF", async () => {
  const html = await readFile(new URL("../annotate.html", import.meta.url), "utf8");
  const path = "guidelines/annotation-guideline-2026-09-17.pdf";
  const pdf = await readFile(new URL(`../${path}`, import.meta.url));
  assert.ok(html.includes(`data-src="${path}"`));
  assert.ok(html.includes(`href="${path}"`));
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.ok(pdf.subarray(-128).toString("ascii").includes("%%EOF"));
});
