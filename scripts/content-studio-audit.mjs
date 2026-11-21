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
assert.deepEqual(stageRules.flatMap((rule, i) => rule.review ? [i] : []), [0, 1, 2, 3, 4, 6]);
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
const packaging = { patterns: "Use the opening joke. This scan is directional.", recommendation: 2,
  options: ["payoff", "reaction", "detail"].map((look, i) => ({
    title: finishedPlan.titleOptions[i], look, overlay: "THE FAN", composition: "Tight on the framing subject.", reason: "Illustrates the actual joke.",
  })),
};
for (const [index] of stages.entries()) {
  assert.equal(run.state.stage, index);
  assert.equal(studioDecision(run, "approve", ""), null, "Running tasks cannot be approved.");
  const result = checkedStudioOutput(run, JSON.stringify(index === 6 ? finishedPlan : index === 2 ? packaging : prior[index].result));
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
const single = { ...run, input: { ...run.input, singleStage: 2, script: JSON.stringify(finishedPlan) },
  state: { stage: 2, taskId: "fixture-2", outputs: [prior[1]] } };
assert.match(promptForStudioRun(single), /Fixture for outliers/);
const packaged = { ...single, ...checkedStudioOutput(single, "Here are the drafts.\n```json\n" + JSON.stringify(packaging) + "\n```") };
assert.equal(packaged.phase, "review");
assert.deepEqual(packaged.state.packaging, packaging);
assert.equal(studioDecision(packaged, "approve", "").phase, "complete");
assert.throws(() => checkedStudioOutput(single, JSON.stringify({ ...packaging, options: [packaging.options[0], packaging.options[0], packaging.options[2]] })));
const withSuggestion = { ...run, input: { ...run.input, script: JSON.stringify(finishedPlan), suggestion: { action: "visual", shot: 1, direction: "Leave space for the face." } } };
assert.match(promptForStudioRun(withSuggestion), /Selected shot: 2/);
const layout = { label: "High title", text: "Frame her face below the top title.", reason: "Keeps the reaction visible.", overlay: "MY TERMS", overlayPosition: "top" };
assert.throws(() => checkedStudioOutput(withSuggestion, JSON.stringify({ alternatives: [layout] })));
assert.equal(checkedStudioOutput(withSuggestion, JSON.stringify({ alternatives: [layout, { ...layout, overlayPosition: "lower" }] })).phase, "complete");
console.log("PASS durable seven-stage handoffs, approval gates, retry, isolated stage, and visual suggestions");

const { matchesStudioSource, studioSourceKey, isStudioRunOpen } = require("../src/lib/studio/runs.ts");
const originalProject = { kit: "second-spring", spec: { keyword: "Nighttime thermostat", duration: 30, voice: { style: "Dry and deadpan", rate: 1 } }, script: JSON.stringify(finishedPlan) };
const result = { input: { revision: 10, script: originalProject.script, sourceKey: studioSourceKey(originalProject) } };
const serverOrder = { ...originalProject, spec: { duration: 30, voice: { rate: 1, style: "Dry and deadpan" }, keyword: "Nighttime thermostat" } };
assert.equal(matchesStudioSource(result, serverOrder, 11), true, "Saving another project must not lock this project's result.");
assert.equal(matchesStudioSource(result, { ...originalProject, spec: { ...originalProject.spec, duration: 45 } }, 11), false);
assert.equal(matchesStudioSource(result, { ...originalProject, script: "An edited script" }, 11), false);
assert.equal(matchesStudioSource(result, { ...originalProject, kit: "custom" }, 11), false);
assert.equal(matchesStudioSource(result, originalProject), false, "Unsaved changes cannot be overwritten.");
assert.equal(matchesStudioSource({ input: { revision: 10, script: originalProject.script } }, originalProject, 11), false, "Old records need their source snapshot before applying to a new batch revision.");
assert.equal(isStudioRunOpen("review"), true);
assert.equal(isStudioRunOpen("blocked"), true);
assert.equal(isStudioRunOpen("complete"), false);
console.log("PASS project-specific bulk result application and stale edit protection");

const { productionFiles, productionZip } = require("../src/app/content-studio/production-package.ts");
const exported = productionFiles([{ spec: { ...run.input.spec, ratios: ["9:16", "16:9", "1:1"] }, plan: finishedPlan, brandContext: "Second Spring" }]);
assert.deepEqual(JSON.parse(exported["batch.json"]).projects, ["video-01", "video-02", "video-03"]);
for (const [index, [width, height]] of [[1080, 1920], [1920, 1080], [1080, 1080]].entries()) {
  const folder = `video-0${index + 1}`;
  assert.ok(exported[`${folder}/index.html`].includes(`data-width="${width}" data-height="${height}"`));
  assert.ok(exported[`${folder}/index.html`].includes('class="clip caption top"'));
  assert.ok(exported[`${folder}/draft-captions.srt`].includes("00:00:04,000 --> 00:00:30,000"));
}
const packed = Buffer.from(await productionZip(exported).arrayBuffer());
assert.equal(packed.readUInt32LE(0), 0x04034b50);
assert.equal(packed.readUInt32LE(packed.length - 22), 0x06054b50);
assert.equal(packed.readUInt16LE(packed.length - 12), Object.keys(exported).length);
console.log("PASS editable ZIP, vertical/landscape/square dimensions, timed captions, and applied overlay placement");
const story = productionFiles([{ spec: { ...run.input.spec, storyStyle: "stick-figure" }, plan: finishedPlan, brandContext: "Second Spring" }]);
assert.match(story["video-01/.opencode/skills/mahara-story-production/SKILL.md"], /name: mahara-story-production/);
assert.match(story["video-01/OPEN-CODE.md"], /NHEurGsycYM&t=237s/);
assert.match(story["video-01/MoraViral-brief.md"], /The thermostat blinked first/);
assert.equal(exported["video-01/OPEN-CODE.md"], undefined);
console.log("PASS optional OpenCode skill, tutorial checkpoints, and separate MoraViral handoff");

const { parseStorySubtitles, storyDraftCues, storyShotAt } = require("../src/app/content-studio/story-timeline.ts");
const srt = "1\r\n00:00:00,500 --> 00:00:03,000\r\nTalks begin.\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,500\r\nThe thermostat blinked.";
assert.equal(parseStorySubtitles(srt, 30)[1].end, 6.5);
assert.throws(() => parseStorySubtitles(srt.replace("00:00:04,000", "00:00:01,000"), 30), /overlaps/);
assert.throws(() => parseStorySubtitles(srt, 6), /runtime/);
assert.equal(storyShotAt(finishedPlan, 4), 1);
assert.equal(storyDraftCues(finishedPlan).at(-1).end, 30);
const pitchRun = { ...single, input: { ...single.input, script: "", suggestion: { action: "story-pitches", shot: 0, direction: "" } } };
assert.match(promptForStudioRun(pitchRun), /Fixture for outliers/);
const pitches = { alternatives: Array.from({ length: 10 }, (_, index) => ({
  label: `Pitch ${index}`, text: "First image, hook and ending.", overlay: "THERMOSTAT TALKS", reason: "Shared premise.", sourceToCheck: "Fictional scenario.",
})) };
assert.equal(checkedStudioOutput(pitchRun, JSON.stringify(pitches)).state.alternatives.length, 10);
assert.throws(() => checkedStudioOutput(pitchRun, JSON.stringify({ alternatives: pitches.alternatives.slice(1) })), /ten distinct/);
console.log("PASS story pitch count and evidence, SRT import, and shot timing");

const { importKeywordCsv, rankKeywords, keywordId, selectedKeywordEvidence, suggestedSearches } = require("../src/lib/studio/keyword-research.ts");
const keyDate = "2026-11-20";
const lowFruits = importKeywordCsv('Keyword,Volume,SD,# Weak Websites\r\n"perimenopause, at night","1,300",1,4\r\n', "LowFruits", "US", keyDate);
assert.equal(lowFruits.rows[0].volume, 1300);
assert.equal(lowFruits.rows[0].weakSites, 4);
assert.equal(lowFruits.rows[0].difficulty, 1);
const semrush = importKeywordCsv("Keyword;Volume;Keyword Difficulty %;Intent\nperimenopause questions;820;26%;I\nremote help;0;;N", "Semrush", "GB", keyDate);
assert.equal(semrush.rows[0].intent, "informational");
assert.equal(semrush.rows[1].volume, 0);
assert.equal(semrush.rows[1].difficulty, undefined);
const ahrefs = importKeywordCsv("Keyword\tVolume\tKD\nperimenopause questions\t900\t12", "Ahrefs", "GB", keyDate);
assert.equal(ahrefs.rows[0].difficulty, 12);
assert.notEqual(keywordId(semrush.rows[0]), keywordId(ahrefs.rows[0]));
assert.match(rankKeywords(semrush.rows, "perimenopause", "", "answer")[0].reason, /Matches perimenopause/);
const board = { seed: "perimenopause", objective: "answer", rows: [...lowFruits.rows, ...semrush.rows], shortlist: [keywordId(semrush.rows[0])] };
assert.match(selectedKeywordEvidence(board), /perimenopause questions/);
assert.doesNotMatch(selectedKeywordEvidence(board), /remote help/);
assert.match(suggestedSearches("perimenopause", "relate", "English")[1], /real experiences/);
assert.deepEqual(suggestedSearches("transición", "answer", "Spanish"), ["transición"]);
const { readDataForSeoKeywords, readSubscribrChannels, readSubscribrNarration, readSubscribrScripts } = require("../src/lib/studio/provider-results.ts");
const keywordReport = readDataForSeoKeywords({ status_code: 20000, cost: .01212,
  tasks: [{ status_code: 20000, result: [{ items: [{ keyword: "perimenopause questions", keyword_info: { search_volume: 400 },
    keyword_properties: { keyword_difficulty: null }, search_intent_info: { main_intent: "informational" } }] }] }] }, "US", "en", keyDate);
assert.equal(keywordReport.rows[0].difficulty, undefined);
assert.equal(keywordReport.cost, .01212);
assert.throws(() => readDataForSeoKeywords({ status_code: 20000, tasks: [{ status_code: 40100 }] }, "US", "en", keyDate));
assert.equal(readSubscribrChannels({ success: true, data: [{ id: 3, details: { title: "Studio channel" } }] }).entries[0].title, "Studio channel");
assert.equal(readSubscribrScripts({ success: true, data: [{ id: 3, title: "Script draft", has_script: false }] }).entries[0].hasScript, false);
const scriptAsset = { success: true, data: { script_id: 3, script: "Opening!", outline: "", content_version: 1 } };
assert.equal(readSubscribrNarration(scriptAsset, 3).script, "Opening!");
assert.throws(() => readSubscribrNarration(scriptAsset, 4));
console.log("PASS provider-specific CSV, relevance and shortlist handoff, DataForSEO response, and Subscribr imports");
