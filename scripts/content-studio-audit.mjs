// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Organic Intelligence, Inc.
import assert from "node:assert/strict";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Compile only the pure Content Studio modules against the repo's installed TypeScript.
const require = createRequire(import.meta.url);
const resolveModule = Module._resolveFilename;
Module._resolveFilename = function (request, ...options) {
  const local = request.startsWith("@/") ? fileURLToPath(new URL("../src/" + request.slice(2), import.meta.url)) : request;
  return resolveModule.call(this, local, ...options);
};
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

const { checkedStudioOutput, studioDecision, promptForStudioRun } = require("../src/lib/studio/run-output.ts");
const run = {
  kind: "workflow", phase: "running", input: { brief, script: "", spec: { keyword: brief.topic, type: "skit", ratio: "9:16", duration: 30 } },
  state: { stage: 0, taskId: "fixture-0", outputs: [] },
};
const finishedPlan = { title: "Hostage Talks", titleOptions: ["2 A.M. Talks", "The Thermostat Blinked", "Emergency Contact"],
  description: "A 30-second comedy about a late-night thermostat standoff.", caption: "Do you negotiate with your thermostat?", shots: [
  { end: 4, narration: "The thermostat blinked first.", visual: "Tight shot on the thermostat.", overlay: "2 A.M.", sound: "Click.", asset: "Owned footage." },
  { end: 30, narration: "The fan is my emergency contact.", visual: "Hold on her stare.", overlay: "MY TERMS", overlayPosition: "top", sound: "Fan hum.", asset: "Owned footage." },
] };
for (const [index] of stages.entries()) {
  assert.equal(run.state.stage, index);
  assert.equal(studioDecision(run, "approve", ""), null, "Running tasks cannot be approved.");
  const result = checkedStudioOutput(run, JSON.stringify(index === 6 ? finishedPlan : prior[index].result));
  const next = { ...run, ...result };
  if (stageRules[index].review) {
    assert.equal(next.phase, "review");
    const retry = studioDecision(next, "retry", "Revise it.");
    assert.equal(retry.state.stage, index);
    assert.equal(retry.state.taskId, undefined);
    assert.ok(retry.state.outputs.every(({ result: output }) => output.stage < index));
    Object.assign(run, studioDecision(next, "approve", ""));
  } else Object.assign(run, result);
  if (index < 6) {
    assert.equal(run.phase, "queued");
    run.phase = "running";
    run.state.taskId = `fixture-${index + 1}`;
  }
}
assert.equal(run.phase, "complete");
assert.equal(run.state.outputs.length, 6);
assert.deepEqual(run.state.plan, finishedPlan);
assert.throws(() => checkedStudioOutput(run, JSON.stringify({ ...finishedPlan, shots: finishedPlan.shots.slice(0, 1) })));
assert.equal(studioDecision(run, "retry", ""), null);
const single = { ...run, input: { ...run.input, singleStage: 2 }, state: { stage: 2, taskId: "fixture-2", outputs: [] } };
assert.equal(checkedStudioOutput(single, JSON.stringify(prior[2].result)).phase, "complete");
const withSuggestion = { ...run, input: { ...run.input, script: JSON.stringify(finishedPlan), suggestion: { action: "visual", shot: 1, direction: "Leave space for the face." } } };
assert.match(promptForStudioRun(withSuggestion), /Selected shot: 2/);
const layout = { label: "High title", text: "Frame her face below the top title.", reason: "Keeps the reaction visible.", overlay: "MY TERMS", overlayPosition: "top" };
assert.throws(() => checkedStudioOutput(withSuggestion, JSON.stringify({ alternatives: [layout] })));
assert.equal(checkedStudioOutput(withSuggestion, JSON.stringify({ alternatives: [layout, { ...layout, overlayPosition: "lower" }] })).phase, "complete");
console.log("PASS durable seven-stage handoffs, approval gates, retry, isolated stage, and visual suggestions");
