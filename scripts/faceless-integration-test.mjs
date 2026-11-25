// Offline: no credentials, database, network or paid providers.
import assert from "node:assert/strict";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
const require = createRequire(import.meta.url);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...options) {
  return resolve.call(this, request.startsWith("@/") ? fileURLToPath(new URL("../src/" + request.slice(2), import.meta.url)) : request, ...options);
};
Module._extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
};
const { appendFaceless, copyFacelessSource, readFacelessExport, mapFaceless, currentFaceless, agentPacket, applyAgent, exportFaceless, facelessSchema, sourceToPlan, asWorkspace } = require("../src/lib/studio/faceless/integration.ts");
const { readVideoPlan } = require("../src/app/content-studio/production.ts");
const { reverseReportSchema, cutsFromFrames, compareReports } = require("../src/lib/studio/faceless/reverse.ts");
const channel = { name: "Fixture channel", niche: "Practical systems", audience: "Creators", promise: "One practical action", url: "", rules: "Use original examples.", style: "Simple", cta: "Try one action", offer: "", setup: {} };
const scenes = Array.from({ length: 41 }, (_, i) => ({ id: `scene-${i}`, title: `Scene ${i}`, text: `This is original sentence number ${i}.`, visual: `Original scene detail ${i}`, duration: 4 }));
const project = { id: "fixture-source-1", title: "Original source", format: "Narrated explainer", minutes: 3, status: "Rendered",
  script: scenes.map((s) => s.text).join(" "), scenes, style: "cinematic", ideas: [], research: [], titles: ["Source title"], description: "Original description",
  thumbnailText: "A simple action", checks: { render: true, publish: true }, date: "", notes: "Full source notes", results: [] };
const workspace = { channel, projects: [project], active: project.id, instructions: { script: "Preserve nuance." },
  metrics: { subscribers: 0, hours: 0, shorts: 0, uploads: 0, views: 0, rpm: 4, ctr: 1, conversion: 2, price: 29, cost: 0, revenue: 0 }, logs: [],
  settings: { model: "unused", imageModel: "", voice: "", voiceModel: "", maxTokens: 6000, apiKey: "discard-this-fixture-value" } };
const sourceJson = JSON.stringify(workspace);
const sources = readFacelessExport(sourceJson);
assert.equal(sources.length, 1);
assert.deepEqual(readFacelessExport(JSON.stringify({ workspace, revision: 8 }))[0].project, sources[0].project);
assert.ok(!JSON.stringify(sources).includes("discard-this-fixture-value"));
assert.throws(() => readFacelessExport("{}"), /valid/);
assert.throws(() => readFacelessExport("{"), /complete JSON/);
assert.throws(() => readFacelessExport("x".repeat(2_500_001)), /2.5 MB/);
assert.throws(() => readFacelessExport(JSON.stringify({ ...workspace, projects: [project, project] })), /valid/);
const item = mapFaceless(sources[0]);
assert.equal(item.kit, "custom");
assert.equal(item.organization.stage, "review");
assert.equal(item.approved, undefined);
assert.equal(item.renders, undefined);
assert.equal(item.faceless.project.scenes.length, 41);
assert.deepEqual(item.faceless.originalSource.project, project);
const plan = readVideoPlan(item.script, item.spec.duration);
assert.equal(plan.shots.length, 21);
assert.equal(plan.shots.map((s) => s.narration).join(" "), project.script);
assert.equal(plan.shots.at(-1).end, 180);
assert.equal(currentFaceless(item).project.scenes.length, 41);
const copy = { ...item, spec: { ...item.spec, id: crypto.randomUUID() } };
copy.faceless = copyFacelessSource(item, copy.spec);
assert.notEqual(copy.faceless.sourceProjectId, item.faceless.sourceProjectId);
assert.equal(copy.faceless.originalSource.project.id, project.id);
assert.equal(currentFaceless(copy).project.scenes.length, 41);
assert.equal(readFacelessExport(exportFaceless([item, copy])).length, 2);
assert.equal(item.faceless.project.id, project.id);
const secondSource = { ...sources[0], sourceProjectId: "second", project: { ...project, id: "second" } };
assert.equal(appendFaceless([item], sources).length, 1);
assert.equal(appendFaceless([item], [secondSource]).length, 2);
assert.throws(() => appendFaceless(Array.from({ length: 100 }, () => item), [secondSource]), /100/);
assert.deepEqual(readFacelessExport(exportFaceless([item]))[0], item.faceless);
assert.equal(readFacelessExport(JSON.stringify(asWorkspace(item.faceless)))[0].project.scenes.length, 41);
const mediaItem = mapFaceless({ ...sources[0], project: { ...project, voiceUrl: "/api/assets/11111111-1111-4111-8111-111111111111" } });
assert.equal(mediaItem.spec.media, undefined);
assert.ok(mediaItem.faceless.warnings.some((w) => w.includes("not transferred")));
assert.equal(mapFaceless({ ...sources[0], project: { ...project, minutes: 8 } }).script, "");
assert.equal(mapFaceless({ ...sources[0], project: { ...project, format: "Wordless short film" } }).script, "");
assert.throws(() => sourceToPlan({ ...project, script: "Different script" }, 180), /cover/);
assert.equal(JSON.stringify(workspace), sourceJson);
console.log("PASS workspace import, ID deduplication, source preservation, 41→21 shot narration coverage, timeline validation, limits, asset isolation, export round trip");

const outputs = {
  channel: { name: "Updated channel", niche: "Systems", audience: "Creators", promise: "Clear steps", rules: "No invented facts", style: "Simple", cta: "Try it", notes: "Review" },
  ideas: { ideas: [{ title: "Fresh idea", angle: "Specific example", hook: "Try this", evidence: "Hypothesis", priority: "high" }] },
  script: { script: "First original narration. Second original narration.", claims: [], notes: "New draft" },
  storyboard: { scenes: scenes.map(({ id, ...scene }) => scene) },
  package: { titles: ["Original title"], description: "Original description", thumbnailText: "Try it", concepts: ["Show the object"] },
  critique: { notes: "Review required", issues: [{ severity: "review", location: "opening", fix: "Test the opening" }], ready: false },
  strategy: { notes: "Insufficient actual metrics", experiments: [{ hypothesis: "Specificity helps", change: "Opening", metric: "Retention", successCriterion: "Measure actual change" }] },
};
for (const [task, output] of Object.entries(outputs)) {
  const packet = agentPacket(item, task, "Owner direction");
  assert.equal(packet.task, task);
  assert.equal(packet.context.actualMetrics.revenue, 0);
  assert.equal(packet.context.scenarioAssumptions.rpm, 4);
  const snapshot = JSON.stringify(item);
  const data = applyAgent(item, task, output, snapshot);
  assert.equal(data.project.results[0].task, task);
  assert.equal(facelessSchema.safeParse(data).success, true);
  assert.equal(JSON.stringify(item), snapshot, "Agent application must not mutate prior source");
  assert.throws(() => applyAgent({ ...item, script: item.script + " " }, task, output, snapshot), /changed/);
  assert.throws(() => applyAgent(item, task, {}, snapshot));
  assert.deepEqual(data.originalSource.project, project);
  if (task === "script") {
    const updated = { ...item, faceless: data };
    assert.equal(currentFaceless(updated).project.script, output.script, "Next agent sees the saved handoff, not the old editor plan");
    assert.equal(currentFaceless(updated).project.scenes.length, 0);
    const changedNative = { ...updated, script: JSON.stringify({ ...plan, title: "Native edit" }) };
    assert.equal(currentFaceless(changedNative).project.script, project.script, "Native edits invalidate the previous snapshot");
  }
  console.log(`PASS ${task}: strict output, unchanged source, current snapshot, archived original`);
}
const report = { version: 1, id: "reference", created: "fixture", name: "Known cuts", mode: "local", duration: 6, start: 0, end: 6,
  width: 320, height: 180, sampleFps: 2, threshold: 0.18, frames: [0, .5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5].map((t) => ({ t, difference: t === 2 || t === 4 ? .8 : 0, color: "#ff0000" })),
  cuts: [], palette: ["#ff0000"], audio: null, transcript: "", transcriptSource: "Unavailable", findings: [], style: "Original interpretation", limits: ["Approximate"] };
report.cuts = cutsFromFrames(report.frames, report.threshold, report.sampleFps);
assert.deepEqual(report.cuts.map((c) => c.t), [2, 4]);
assert.equal(reverseReportSchema.safeParse(report).success, true);
assert.equal(reverseReportSchema.safeParse({ ...report, end: 7 }).success, false);
assert.equal(reverseReportSchema.safeParse({ ...report, cuts: [{ t: 8, strength: 1, source: "manual" }] }).success, false);
assert.equal(compareReports(report, { ...report, id: "rebuild" }).matches, 2);
assert.equal(compareReports(report, { ...report, mode: "model" }), null);
console.log("PASS reverse-report bounds, known-cut detection, matched and incompatible comparisons");
