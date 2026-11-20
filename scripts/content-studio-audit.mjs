// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Organic Intelligence, Inc.
import assert from "node:assert/strict";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import ts from "typescript";

// Compile only the pure Content Studio modules against the repo's installed TypeScript.
const require = createRequire(import.meta.url);
Module._extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  module._compile(outputText, filename);
};
const { checkStageResult, stagePrompt, stageRules } = require("../src/app/content-studio/pipeline.ts");
const { stages, makePrompt, runtimes } = require("../src/app/content-studio/workflow.ts");

const brief = {
  topic: "Second Spring",
  audience: "Women experiencing perimenopause symptoms",
  language: "English",
  format: "Comedy skit",
  platforms: ["Instagram"],
  notes: "Use a fictional character and gentle humor. Avoid diagnostic or treatment claims.",
};
const prior = [];
assert.equal(stageRules.length, stages.length);
for (const [index, stage] of stages.entries()) {
  const fields = stageRules[index].fields;
  const handoff = Object.fromEntries(fields.map((name) => [name, "Fixture for " + name]));
  const valid = { stage: index, status: "ready", summary: "Audit fixture", handoff };
  const text = JSON.stringify(valid);
  assert.deepEqual(checkStageResult(text, index), valid);
  assert.deepEqual(checkStageResult("Summary\n```json\n" + text + "\n```", index), valid);
  for (const field of fields) {
    const incomplete = { ...handoff };
    delete incomplete[field];
    assert.throws(() => checkStageResult(JSON.stringify({ ...valid, handoff: incomplete }), index), /missing/);
  }
  assert.throws(() => checkStageResult(text, (index + 1) % stages.length), /different stage/);
  assert.throws(() => checkStageResult("no JSON", index), /JSON/);
  assert.equal(checkStageResult(JSON.stringify({ ...valid, status: "blocked", handoff: {} }), index).status, "blocked");
  for (const { value, label } of runtimes) {
    const input = { ...brief, runtimeSeconds: value ? Number(value) : undefined };
    const prompt = stagePrompt(input, index, prior, "Keep the humor gentle.");
    for (const expected of [stage.title, stage.output, brief.topic, brief.audience, brief.format, brief.notes, stageRules[index].check, "Keep the humor gentle."]) {
      assert.ok(prompt.includes(expected), "Missing prompt text: " + expected);
    }
    assert.ok(makePrompt(input, index).includes(value ? label : "Recommend a runtime"));
    if (prior.length) assert.ok(prompt.includes(prior.at(-1).taskId));
  }
  prior.push({ taskId: "fixture-" + index, result: valid });
  console.log("PASS " + stage.title);
}
assert.deepEqual(stageRules.flatMap((rule, i) => rule.review ? [i] : []), [0, 1, 3, 4, 6]);
console.log("PASS runtime presets, handoff checks, revision context, upstream outputs, and approval definitions");
