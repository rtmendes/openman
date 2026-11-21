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

const { draftResearchBrief, groupGoogleKeywords, groupSavedVideos, researchBriefEvidence, researchBriefsSchema } = require("../src/lib/studio/research-briefs.ts");
const { planningPrompt, videoTypes } = require("../src/app/content-studio/production.ts");
const researchContext = { topic: "Hostage Talks, 2 A.M.", audience: "Women experiencing perimenopause", duration: 30,
  format: videoTypes.skit.label, direction: videoTypes.skit.direction };
const sharedUrls = "https://www.example.com/a?test=1|https://example.com/b/|https://example.com/c#heading";
const samePages = "https://example.com/a|https://www.example.com/b|https://example.com/c/";
const distinctPages = "https://example.com/d|https://example.com/e|https://example.com/f";
const csv = `Keyword,Volume,Intent,SERP URLs\nhot flashes at night,200,I,${sharedUrls}|javascript:alert(1)\nnight sweats,100,I,${samePages}\nhot flashes at night product,80,C,${distinctPages}`;
const imported = importKeywordCsv(csv, "Ahrefs", "US", keyDate);
assert.equal(imported.rows[0].serpUrls.length, 3);
const groups = groupGoogleKeywords({ ...board, seed: "hot flashes at night", rows: [...imported.rows,
  { ...imported.rows[0], market: "GB" }, ...semrush.rows] }, researchContext);
const verified = groups.find(({ kind }) => kind === "google-results");
assert.deepEqual(verified.members.map(({ title }) => title), ["hot flashes at night", "night sweats"]);
assert.equal(verified.sources.length, 3);
assert.equal(groups.filter((group) => group.kind === "google-results").length, 1);
assert(groups.some((group) => group.scope === "GB" && group.members[0].title === "hot flashes at night"));
assert(groups.some((group) => group.kind === "google-terms" && group.members[0].title === "hot flashes at night product"));
const candidateBrief = draftResearchBrief(verified, researchContext, "3fa85f64-5717-4562-b3fc-2c963f66afa6");
assert.deepEqual(researchBriefsSchema.parse(JSON.parse(JSON.stringify([candidateBrief]))), [candidateBrief]);
assert.equal(researchBriefEvidence([candidateBrief]), "");
const configured = { ...originalProject.spec, brand: "Second Spring", type: "skit", ratio: "9:16", researchBriefs: [candidateBrief] };
assert.doesNotMatch(planningPrompt(configured, "Second Spring"), /Creator-selected research brief/);
assert.match(planningPrompt({ ...configured, activeResearchBriefId: candidateBrief.id }, "Second Spring"), /Creator-selected research brief.*night sweats/);
console.log("PASS saved SERP overlap, market and intent boundaries, brief roundtrip and opt-in prompt handoff");

if (process.argv[2]) {
  const saved = fs.readFileSync(process.argv[2], "utf8");
  const groups = groupSavedVideos(saved, researchContext.topic, researchContext.audience);
  const night = groups.find(({ label }) => label === "Late-night moments");
  assert(night?.members.length >= 2);
  assert(night.members.some(({ title }) => /after dark/i.test(title)));
  assert(night.members.some(({ title }) => /3am/i.test(title)));
  const brief = draftResearchBrief(night, researchContext, "1ec844cd-18c5-461b-a2b9-cbf540aa3f3a");
  assert.equal(brief.kind, "youtube");
  assert(brief.sources.every(({ url }) => /youtube\.com\/shorts\//.test(url)));
  assert.match(brief.beats, /^30s comedy skit/);
  assert.match(researchBriefEvidence([brief], brief.id), /original footage and dialogue/);
  console.log(`PASS saved Second Spring research → ${groups.length} themes → ${brief.title} with ${brief.sources.length} source videos → 30-second brief`);
}

const { emptyOffer, missingOfferFields, savedContentInventory, usableOffer } = require("../src/lib/studio/campaign-input.ts");
const { startStudioRunSchema } = require("../src/lib/studio/runs.ts");
const primaryId = "6902919c-a792-4dad-8b5c-3ed4da32a694";
const variantId = "8cfb02c4-2dfc-4eb7-a405-ea0af40bef57";
const customId = "1c9002e0-bd09-413f-837a-a3bf1a2bb648";
const offer = { ...emptyOffer, name: "Fixture only: bedtime routine worksheet", deliverable: "One printable page with spaces for a viewer’s own wind-down routine.",
  audienceMoment: "The viewer wants to prepare for bedtime without another complicated routine.", action: "See the worksheet" };
assert.equal(missingOfferFields(emptyOffer).length, 4);
assert.equal(usableOffer({ ...offer, proofUrl: "https://example.com/proof" }), undefined);
assert.equal(usableOffer({ ...offer, destination: "javascript:alert(1)" }), undefined);
assert.deepEqual(usableOffer(offer), offer);
const editorial = { ...originalProject, spec: { ...configured, id: primaryId, offer } };
const inventory = savedContentInventory(editorial, [editorial, { ...editorial, variationOf: primaryId, spec: { ...editorial.spec, id: variantId } },
  { ...editorial, kit: "custom", spec: { ...editorial.spec, id: customId } }]);
assert.deepEqual(inventory.map(({ id, status, variations }) => [id, status, variations]), [[primaryId, "script", 1]]);
assert(startStudioRunSchema.safeParse({ kind: "workflow", workflow: "offer", id: variantId, videoId: primaryId, revision: 10 }).success);
assert(!startStudioRunSchema.safeParse({ kind: "workflow", workflow: "offer", id: variantId, videoId: primaryId, revision: 10, stage: 2 }).success);

const campaign = { ...single, kind: "workflow", phase: "running", input: { brief, kit: editorial.kit, spec: editorial.spec, script: editorial.script,
  campaign: { offer, inventory, scan: process.argv[2] ? fs.readFileSync(process.argv[2], "utf8") : undefined } }, state: { stage: 0, taskId: "editor", outputs: [] } };
const intents = ["discover", "consider", "act"];
const strategy = { series: "The small bedtime reset", objective: "See whether the routine questions generate worksheet interest.",
  slots: intents.map((intent, index) => ({ intent, placement: `Week ${index + 1}`, topic: ["The thermostat truce", "Set up a nightstand", "Use the worksheet"][index],
    audienceQuestion: ["Who moved my blanket?", "What can I set up now?", "What comes with the worksheet?"][index],
    decision: index === 0 ? "refresh" : "create", projectIds: index === 0 ? [primaryId] : [], rationale: "Gives this audience a specific next step.",
    payoff: ["A sticky-note counteroffer", "One visible nightstand setup", "The actual printable page"][index],
    nextStep: index === 2 ? offer.action : "Watch the next piece", evidence: process.argv[2] ? ["video-1"] : [], assumption: "Confirm that the setup is easy to film." })) };
assert.match(promptForStudioRun(campaign), /Role: editorial strategist/);
if (process.argv[2]) assert.match(promptForStudioRun(campaign), /Perimenopause after dark/);
assert.throws(() => checkedStudioOutput(campaign, JSON.stringify({ ...strategy, slots: strategy.slots.map((row) => ({ ...row, evidence: ["invented-url"] })) })), /supplied evidence/);
const requestedPlan = checkedStudioOutput(campaign, JSON.stringify(strategy));
assert.equal(requestedPlan.phase, "review");
const approvedPlan = studioDecision({ ...campaign, ...requestedPlan }, "approve", "");
assert.equal(approvedPlan.phase, "queued");
assert.equal(approvedPlan.state.stage, 1);
const draftRun = { ...campaign, ...approvedPlan };
assert.match(promptForStudioRun(draftRun), /approved slot order/);
const creatives = { creatives: intents.map((intent, index) => ({ intent, treatment: ["Deadpan skit", "Nightstand demo", "Worksheet walkthrough"][index],
  firstFrame: ["A hand slides over a note", "An empty nightstand", "Close-up on the worksheet"][index], thumbnail: "BEDTIME RESET", thumbnailDirection: "Keep the note in the center with space above.",
  proofUsed: false, assumptions: [], plan: { ...finishedPlan, title: ["A Truce at 2 a.m.", "The Nightstand Reset", "One Page Before Bed"][index], shots: finishedPlan.shots.map((shot, shotIndex) =>
    intent === "act" && shotIndex === finishedPlan.shots.length - 1 ? { ...shot, narration: offer.action } : shot) } })) };
assert.throws(() => checkedStudioOutput(draftRun, JSON.stringify({ creatives: creatives.creatives.map((entry) => ({ ...entry, proofUsed: true })) })), /proof that was not supplied/);
const readyForReview = checkedStudioOutput(draftRun, JSON.stringify(creatives));
assert.equal(readyForReview.phase, "queued");
assert.equal(readyForReview.state.stage, 2);
assert.equal(readyForReview.state.taskId, undefined);
const reviewRun = { ...campaign, ...readyForReview };
assert.match(promptForStudioRun(reviewRun), /independent creative reviewer/);
const checks = intents.map((intent) => ({ intent, opening: 4, brandFit: 4, proof: 4, feasibility: 4, action: 4, note: "The first frame shows the promised object.", blockers: [] }));
const blocked = checkedStudioOutput(reviewRun, JSON.stringify({ checks: [{ ...checks[0], opening: 2, blockers: ["Shot 1: Replace the empty setup with the note."] }, ...checks.slice(1)] }));
assert.equal(blocked.phase, "blocked");
assert.equal(studioDecision({ ...reviewRun, ...blocked }, "approve", ""), null);
const retry = studioDecision({ ...reviewRun, ...blocked }, "retry", "Keep the humor dry.");
assert.equal(retry.state.stage, 1);
assert.match(retry.state.notes, /Shot 1.*note/);
const ready = checkedStudioOutput(reviewRun, JSON.stringify({ checks }));
assert.equal(studioDecision({ ...reviewRun, ...ready }, "approve", "").phase, "complete");
console.log("PASS same-brand inventory, offer preflight, approved editorial plan, three validated creatives, independent review, retry and final gate");
