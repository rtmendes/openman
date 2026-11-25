"use client";

import { useState } from "react";
import { agentTasks } from "@/lib/studio/faceless/agents";
import { agentPacket, applyAgent, currentFaceless, jsonInput, type AgentTask, type FacelessData, type IntegratedItem } from "@/lib/studio/faceless/integration";
import { downloadStudioJson } from "./faceless-import";

export function FacelessAgents({ item, locked, onSave, onUsePlan }: {
  item: IntegratedItem; locked: boolean; onSave: (data: FacelessData, task: AgentTask) => void; onUsePlan: () => void;
}) {
  const [task, setTask] = useState<AgentTask>("script");
  const [instructions, setInstructions] = useState(item.faceless?.instructions?.script ?? "");
  const [packet, setPacket] = useState<{ text: string; snapshot: string; task: AgentTask }>();
  const [result, setResult] = useState("");
  const [message, setMessage] = useState("");
  const current = currentFaceless(item);
  const stale = packet && packet.snapshot !== JSON.stringify(item);
  return <details className="content-studio-runState faceless-agents">
    <summary>Faceless workspace · ChatGPT agents</summary>
    <p>Prepare a task, run it in your ChatGPT conversation, then paste the result here. These controls make no model API calls. Website background runs still use the configured agent provider.</p>
    <fieldset disabled={locked}>
      <label>Agent<select value={task} onChange={(event) => { setTask(event.target.value as AgentTask); setInstructions(current.instructions?.[event.target.value] ?? ""); setPacket(undefined); setResult(""); setMessage(""); }}>
        {Object.entries(agentTasks).map(([key, agent]) => <option key={key} value={key}>{agent.name}</option>)}
      </select></label>
      <details><summary>Agent instructions and output requirements</summary><p>{agentTasks[task].instruction}</p></details>
      <label>Instructions for this handoff<textarea rows={3} maxLength={12000} value={instructions} onChange={(event) => { setInstructions(event.target.value); setPacket(undefined); }} /></label>
      <button type="button" onClick={() => {
        const text = JSON.stringify(agentPacket(item, task, instructions), null, 2);
        setPacket({ text, snapshot: JSON.stringify(item), task }); setResult(""); setMessage("Task prepared. Copy it into ChatGPT, then bring its JSON response back here.");
      }}>Prepare ChatGPT task</button>
      {packet && <>
        <label>Task packet<textarea rows={5} readOnly value={packet.text} /></label>
        <div className="production-actions"><button type="button" onClick={async () => {
          try { await navigator.clipboard.writeText(packet.text); setMessage("Task copied."); } catch { setMessage("Select and copy the task packet above."); }
        }}>Copy task</button><button type="button" onClick={() => downloadStudioJson("chatgpt-task.json", packet.text)}>Download task</button></div>
        {stale && <p role="alert">The project changed. Prepare a fresh task before applying a result.</p>}
        <label>ChatGPT result JSON<textarea rows={5} value={result} maxLength={2_500_000} onChange={(event) => setResult(event.target.value)} /></label>
        <button type="button" disabled={Boolean(stale) || !result.trim()} onClick={() => {
          try { const data = applyAgent(item, packet.task, jsonInput(result), packet.snapshot); data.instructions = { ...data.instructions, [packet.task]: instructions }; onSave(data, packet.task); setPacket(undefined); setResult(""); setMessage("Validated result added to the project. Review the source and use its storyboard when ready."); }
          catch (error) { setMessage(error instanceof Error && !error.message.startsWith("[") ? error.message : "The result is missing required fields. Check the agent's output requirements and retry."); }
        }}>Validate and save result</button>
      </>}
    </fieldset>
    <p role="status">{message}</p>
    {item.faceless && <>
      {!!item.faceless.warnings.length && <ul>{item.faceless.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
      <div className="production-actions"><button type="button" disabled={locked} onClick={onUsePlan}>Use source storyboard in editor</button>
        <button type="button" onClick={() => downloadStudioJson("faceless-project.json", JSON.stringify({ source: "faceless-director", version: 1, projects: [item.faceless] }, null, 2))}>Export source project</button></div>
      <details><summary>Source script, scenes, research and channel</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 500, overflow: "auto" }}>{JSON.stringify({ channel: item.faceless.channel, project: item.faceless.project }, null, 2)}</pre></details>
      {item.faceless.originalSource && <details><summary>Original imported source · preserved</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 500, overflow: "auto" }}>{JSON.stringify(item.faceless.originalSource, null, 2)}</pre></details>}
    </>}
    {!!current.project.results.length && <details><summary>Agent result history · {current.project.results.length}</summary>
      {current.project.results.map((entry, i) => <details key={i}><summary>{entry.task} · {entry.generatedAt || "Imported result"}</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(entry.output, null, 2)}</pre></details>)}
    </details>}
  </details>;
}
