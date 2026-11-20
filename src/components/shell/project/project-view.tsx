// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Organic Intelligence, Inc.
"use client";

/**
 * /app/project/[id]: mode picker and "..." in the header;
 * on the left the project's name, its recent tasks and a composer bound to it; on the right the cards for its
 * instructions and its files. `?created=1` opens the "Project created" add-ons dialog.
 */
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Download, FileText, FolderCheck, LogOut, Share2, Trash2, Upload, Users } from "lucide-react";
import { brand } from "@/config/brand";
import { Composer } from "@/components/composer";
import { ModalShell } from "@/components/modals/ModalShell";
import { ShareProjectModal } from "@/components/modals/ShareProjectModal";
import { cn } from "@/components/ui/cn";
import { ChevronRightIcon, MoreIcon, PlusIcon, ProjectBoxIcon } from "@/components/ui/icons";
import { toast } from "@/components/ui/toast";
import { useShellAccount } from "../account";
import { ModePicker } from "../mode-picker";
import { ProjectMenu } from "../project-menu";
import { canEditProject, deleteProjectFile, leaveProject, listProjectFiles, projectFileUrl, updateProject, uploadProjectFile, useProject, useProjectsStore, type Project, type ProjectFile } from "../projects-store";
import { taskHref, taskTime } from "../task-list";
import { TaskMenu } from "../task-menu";
import { useTasksStore, type SidebarTask } from "../tasks-store";
import { MarkdownPreview } from "./markdown-preview";

const CARD = "rounded-[16px] border border-[var(--om-border)] bg-[var(--om-card)]";
const OUTLINE_BUTTON =
  "inline-flex h-[32px] shrink-0 cursor-pointer items-center justify-center gap-[6px] rounded-[8px] border border-[var(--om-border-strong)] px-[10px] text-[14px] font-medium leading-[20px] text-[var(--om-text-1)] outline-none transition-colors hover:bg-[var(--om-fill-subtle)] focus-visible:bg-[var(--om-fill-subtle)] disabled:cursor-default disabled:opacity-50";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MARKDOWN_FILE = /\.(md|markdown)$/i;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** The project's reference files: list, upload (button or drop), download and delete. */
function useProjectFiles(projectId: string) {
  const [files, setFiles] = useState<ProjectFile[] | null>(null);
  const [uploading, setUploading] = useState(0);
  const reload = useCallback(() => {
    listProjectFiles(projectId)
      .then(setFiles)
      .catch(() => setFiles([]));
  }, [projectId]);
  useEffect(reload, [reload]);

  const upload = async (list: File[]) => {
    const ok = list.filter((f) => f.size <= MAX_FILE_BYTES);
    list.filter((f) => f.size > MAX_FILE_BYTES).forEach((f) => toast(`“${f.name}” is larger than 2 MB`, "error"));
    if (ok.length === 0) return;
    setUploading((n) => n + ok.length);
    for (const file of ok) {
      try {
        const added = await uploadProjectFile(projectId, file);
        setFiles((prev) => [added, ...(prev ?? [])]);
      } catch (err) {
        toast(err instanceof Error ? err.message : "Upload failed", "error");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };
  const remove = async (file: ProjectFile) => {
    setFiles((prev) => (prev ?? []).filter((f) => f.id !== file.id));
    try {
      await deleteProjectFile(projectId, file.id);
    } catch (err) {
      toast(err instanceof Error ? err.message : "The file could not be deleted.", "error");
      reload();
    }
  };
  return { files, uploading, upload, remove };
}

function InstructionsDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const [value, setValue] = useState(project.instructions);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await updateProject(project.id, { instructions: value });
      toast("Instructions saved", "success");
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save the instructions.", "error");
      setSaving(false);
    }
  };
  return (
    <ModalShell title="Instructions" onClose={onClose} className="flex w-[560px] max-w-[calc(100vw-32px)] flex-col gap-[16px] rounded-[16px] border border-[var(--om-border-strong)] bg-[var(--om-surface)] p-[24px] shadow-[0_24px_64px_rgba(0,0,0,0.5)]">
      <div className="flex flex-col gap-[4px] pe-[24px]">
        <h2 className="text-[18px] font-semibold leading-[24px]">Instructions</h2>
        <p className="text-[14px] leading-[20px] text-[var(--om-text-3)]">Standing notes {brand.name} follows in every task of this project.</p>
      </div>
      <textarea
        autoFocus
        aria-label="Project instructions"
        value={value}
        maxLength={20_000}
        onChange={(e) => setValue(e.target.value)}
        placeholder="e.g. Answer in British English and cite sources."
        className="h-[220px] w-full resize-none rounded-[12px] border border-[var(--om-border-strong)] bg-transparent px-[14px] py-[12px] text-[14px] leading-[20px] text-[var(--om-text-1)] outline-none placeholder:text-[var(--om-text-disabled)] focus:border-[var(--om-border-focus)]"
      />
      <div className="flex justify-end gap-[8px]">
        <button type="button" onClick={onClose} className={OUTLINE_BUTTON}>
          Cancel
        </button>
        <button type="button" disabled={saving} onClick={() => void save()} className="inline-flex h-[32px] cursor-pointer items-center rounded-[8px] bg-[var(--om-btn-primary)] px-[14px] text-[14px] font-medium text-[var(--om-text-inverse)] outline-none hover:opacity-90 disabled:opacity-50">
          Save
        </button>
      </div>
    </ModalShell>
  );
}

/** "Project created": optional instructions and files, then "Get started". */
function CreatedDialog({ project, onClose, onUpload }: { project: Project; onClose: () => void; onUpload: (files: File[]) => Promise<void> }) {
  const [instructions, setInstructions] = useState(project.instructions);
  const [picked, setPicked] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const finish = async () => {
    setBusy(true);
    try {
      if (instructions.trim() !== project.instructions.trim()) await updateProject(project.id, { instructions });
      if (picked.length) await onUpload(picked);
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "That did not go through.", "error");
      setBusy(false);
    }
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    setPicked((prev) => [...prev, ...Array.from(e.dataTransfer.files)]);
  };
  return (
    <ModalShell title="Project created" onClose={onClose} className="flex max-h-[calc(100vh-40px)] w-[480px] max-w-[calc(100vw-32px)] flex-col overflow-y-auto rounded-[20px] border border-[var(--om-border-strong)] bg-[var(--om-surface)] px-[20px] pb-[20px] pt-[48px] shadow-[0_24px_64px_rgba(0,0,0,0.5)]">
      <div className="flex flex-col items-center gap-[6px] pb-[24px]">
        <FolderCheck size={44} strokeWidth={1.4} aria-hidden="true" />
        <h2 className="text-[20px] font-semibold leading-[28px]">Project created</h2>
        <p className="text-[14px] leading-[20px] text-[var(--om-text-2)]">Both steps are optional. You can add them later.</p>
      </div>
      <label htmlFor="created-instructions" className="pb-[8px] text-[14px] font-medium leading-[20px]">
        Instructions
      </label>
      <textarea
        id="created-instructions"
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        placeholder="e.g. Answer in British English and cite sources."
        className="h-[96px] w-full resize-none rounded-[12px] border border-[var(--om-border-strong)] bg-transparent px-[14px] py-[10px] text-[14px] leading-[20px] outline-none placeholder:text-[var(--om-text-disabled)] focus:border-[var(--om-border-focus)]"
      />
      <span className="pb-[8px] pt-[20px] text-[14px] font-medium leading-[20px]">Project files</span>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn("flex flex-col items-center gap-[10px] rounded-[12px] border border-dashed border-[var(--om-border-strong)] px-[16px] py-[20px] text-[14px] text-[var(--om-text-3)]", dragging && "border-[var(--om-icon-accent)] bg-[var(--om-fill-accent)]")}
      >
        {picked.length ? (
          <ul className="flex w-full flex-col gap-[4px]">
            {picked.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-[8px] text-[13px] text-[var(--om-text-1)]">
                <FileText size={14} className="shrink-0 text-[var(--om-icon-2)]" />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="text-[var(--om-text-3)]">{formatSize(f.size)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span>Drop files here, or click to pick them</span>
        )}
        <button type="button" onClick={() => input.current?.click()} className={OUTLINE_BUTTON}>
          <PlusIcon size={16} />
          Add
        </button>
        <input ref={input} type="file" multiple hidden onChange={(e) => setPicked((prev) => [...prev, ...Array.from(e.target.files ?? [])])} />
      </div>
      <button type="button" disabled={busy} onClick={() => void finish()} className="mt-[24px] flex h-[40px] w-full cursor-pointer items-center justify-center rounded-[10px] bg-[var(--om-btn-primary)] text-[14px] font-medium text-[var(--om-text-inverse)] outline-none hover:opacity-90 disabled:opacity-60">
        Get started
      </button>
    </ModalShell>
  );
}

function CardTitle({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex cursor-pointer items-center gap-[2px] text-left text-[16px] font-medium leading-[22px] text-[var(--om-text-1)] outline-none hover:opacity-80">
      {children}
      <ChevronRightIcon size={16} className="text-[var(--om-icon-2)]" />
    </button>
  );
}

function RecentTask({ task }: { task: SidebarTask }) {
  return (
    <li className="group/recent relative">
      <Link href={taskHref(task.id)} className="flex h-[52px] items-center gap-[12px] rounded-[12px] pe-[44px] ps-[12px] outline-none transition-colors hover:bg-[var(--om-fill-subtle)] focus-visible:bg-[var(--om-fill-subtle)]">
        <span className="min-w-0 flex-1 truncate text-[14px] leading-[20px] text-[var(--om-text-1)]">{task.title || "New task"}</span>
        {task.status === "running" || task.status === "waking" ? <span className="size-[12px] shrink-0 animate-spin rounded-full border-2 border-[var(--om-fill-strong)] border-t-[var(--om-icon-accent)]" /> : null}
        <span className="shrink-0 text-[13px] leading-[18px] text-[var(--om-text-3)]">{taskTime(task.updatedAt)}</span>
      </Link>
      <TaskMenu task={task} variant="row" align="end">
        <button type="button" aria-label={`Task options for ${task.title}`} className="absolute end-[10px] top-1/2 flex size-[28px] -translate-y-1/2 cursor-pointer items-center justify-center rounded-[8px] text-[var(--om-icon-2)] opacity-0 outline-none hover:bg-[var(--om-fill)] focus-visible:opacity-100 group-hover/recent:opacity-100 data-[state=open]:opacity-100">
          <MoreIcon size={16} />
        </button>
      </TaskMenu>
    </li>
  );
}

export function ProjectView({ projectId }: { projectId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const project = useProject(projectId);
  const status = useProjectsStore((s) => s.status);
  const tasks = useTasksStore((s) => s.tasks).filter((t) => t.projectId === projectId);
  const tasksStatus = useTasksStore((s) => s.status);
  const account = useShellAccount();
  const { files, uploading, upload, remove } = useProjectFiles(projectId);
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const manusInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ProjectFile | null>(null);
  const created = params.get("created") === "1";
  const closeCreated = () => router.replace(pathname, { scroll: false });

  if (!project) {
    if (status === "idle") return <ProjectViewFallback />;
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-[12px] text-[14px] text-[var(--om-text-3)]">
        <p>This project is gone, or it never existed.</p>
        <Link href="/app" className={OUTLINE_BUTTON}>
          Go home
        </Link>
      </div>
    );
  }

  const editable = canEditProject(project);
  return (
    <div className="flex min-h-full flex-1 flex-col bg-[var(--om-bg)]">
      <header className="sticky top-0 z-10 flex h-[48px] shrink-0 items-center justify-between bg-[var(--om-bg)] pe-[16px] ps-[16px]">
        <ModePicker />
        <div className="flex items-center gap-[8px]">
          {project.shared ? (
            <button
              type="button"
              onClick={() => {
                if (!window.confirm(`Leave “${project.name}”? Your tasks in it stay yours.`)) return;
                leaveProject(project.id)
                  .then(() => {
                    toast(`You left “${project.name}”`, "success");
                    router.push("/app");
                  })
                  .catch((err: unknown) => toast(err instanceof Error ? err.message : "You could not leave the project.", "error"));
              }}
              className={OUTLINE_BUTTON}
            >
              <LogOut size={15} strokeWidth={1.8} />
              Leave
            </button>
          ) : (
            <>
              <button type="button" onClick={() => setSharing(true)} className={OUTLINE_BUTTON}>
                {project.memberCount ? <Users size={15} strokeWidth={1.8} /> : <Share2 size={15} strokeWidth={1.8} />}
                {project.memberCount ? `Shared · ${project.memberCount}` : "Share"}
              </button>
              <ProjectMenu project={project} align="end">
                <button type="button" aria-label="Project options" className="flex size-[32px] cursor-pointer items-center justify-center rounded-[8px] text-[var(--om-icon-2)] outline-none hover:bg-[var(--om-fill)] data-[state=open]:bg-[var(--om-fill)]">
                  <MoreIcon size={18} />
                </button>
              </ProjectMenu>
            </>
          )}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1200px] flex-1 gap-[40px] px-[24px] pb-[16px] max-lg:flex-col">
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-[12px] pt-[32px]">
            <span className="flex size-[48px] shrink-0 items-center justify-center rounded-[12px] bg-[var(--om-fill)]">
              <ProjectBoxIcon size={24} className="text-[var(--om-icon-1)]" />
            </span>
            <div className="flex min-w-0 flex-col gap-[2px]">
              <h1 className="truncate text-[20px] font-semibold leading-[28px] text-[var(--om-text-1)]">{project.name}</h1>
              <p className="text-[13px] leading-[18px] text-[var(--om-text-3)]">
                {project.shared ? (
                  <>
                    Shared by {project.sharedBy || "its owner"} · {project.role === "editor" ? "Editor" : "Member"} ·{" "}
                  </>
                ) : account.name ? (
                  <>Created by {account.name} · </>
                ) : null}
                Updated {shortDate(project.updatedAt)}
              </p>
            </div>
          </div>
          <h2 className="pb-[8px] pt-[32px] text-[14px] font-medium leading-[20px] text-[var(--om-text-3)]">Recent</h2>
          {tasks.length ? (
            <ul className="-mx-[12px] flex flex-col gap-px">
              {tasks.map((task) => (
                <RecentTask key={task.id} task={task} />
              ))}
            </ul>
          ) : tasksStatus === "idle" ? null : (
            <div className="flex flex-1 flex-col items-center justify-center gap-[10px] py-[48px] text-[14px] text-[var(--om-text-3)]">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2.5 2.5" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="3" />
              </svg>
              Create a new task to get started
            </div>
          )}
          <div className="sticky bottom-0 z-[5] mt-auto bg-[linear-gradient(to_bottom,transparent,var(--om-bg)_30%)] pt-[24px]">
            <Composer projectId={projectId} hideProjectPicker placeholder="New task in this project" />
          </div>
        </section>

        <aside aria-label="Project details" className="flex w-[375px] shrink-0 flex-col gap-[16px] pt-[24px] max-lg:w-full">
          <div className={cn(CARD, "flex flex-col gap-[12px] p-[20px]")}>
            <CardTitle onClick={() => (editable ? setEditing(true) : undefined)}>Instructions</CardTitle>
            {project.instructions.trim() ? (
              <p className="line-clamp-4 whitespace-pre-wrap text-[14px] leading-[20px] text-[var(--om-text-2)]">{project.instructions}</p>
            ) : (
              <p className="text-[14px] leading-[20px] text-[var(--om-text-3)]">Standing notes {brand.name} follows in every task of this project.</p>
            )}
            <div className={editable ? undefined : "hidden"}>
              <button type="button" onClick={() => setEditing(true)} className={OUTLINE_BUTTON}>
                {project.instructions.trim() ? (
                  "Edit"
                ) : (
                  <>
                    <PlusIcon size={16} />
                    Add
                  </>
                )}
              </button>
            </div>
          </div>

          <div className={cn(CARD, "flex flex-col gap-[12px] p-[20px]")}>
            <CardTitle onClick={() => (editable ? fileInput.current?.click() : undefined)}>Project files</CardTitle>
            <p className="text-[14px] leading-[20px] text-[var(--om-text-3)]">
              {editable ? <>Files every task here can read. New and removed files apply to tasks started after the change.</> : <>Files every task in this project can read.</>}
            </p>
            {files && files.length ? (
              <ul className="flex flex-col gap-px">
                {files.map((file) => (
                  <li key={file.id} className="group/file flex h-[36px] items-center gap-[8px] rounded-[8px] px-[6px] hover:bg-[var(--om-fill-subtle)]">
                    <FileText size={16} strokeWidth={1.7} className="shrink-0 text-[var(--om-icon-2)]" />
                    {MARKDOWN_FILE.test(file.name) ? (
                      <button type="button" title={file.name} onClick={() => setPreview(file)} className="min-w-0 flex-1 truncate text-left text-[14px] leading-[20px] underline-offset-2 hover:underline">{file.name}</button>
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-[14px] leading-[20px]">{file.name}</span>
                    )}
                    <span className="shrink-0 text-[12px] text-[var(--om-text-3)]">{formatSize(file.size)}</span>
                    <a href={projectFileUrl(projectId, file.id)} aria-label={`Download ${file.name}`} className="flex size-[28px] shrink-0 items-center justify-center rounded-[6px] text-[var(--om-icon-2)] hover:bg-[var(--om-fill)]">
                      <Download size={14} />
                    </a>
                    {editable ? <button type="button" aria-label={`Delete ${file.name}`} onClick={() => void remove(file)} className="flex size-[28px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-[var(--om-icon-2)] hover:bg-[var(--om-fill)]">
                      <Trash2 size={14} />
                    </button> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className={editable ? "flex flex-wrap gap-2" : "hidden"}>
              <button type="button" disabled={uploading > 0} onClick={() => fileInput.current?.click()} className={OUTLINE_BUTTON}>
                <Upload size={15} strokeWidth={1.8} />
                {uploading > 0 ? "Uploading…" : "Upload files"}
              </button>
              <button type="button" disabled={uploading > 0} onClick={() => manusInput.current?.click()} className={OUTLINE_BUTTON}>
                <FileText size={15} />
                Import Manus Markdown
              </button>
              <input
                ref={manusInput}
                type="file"
                accept=".md,.markdown,text/markdown"
                multiple
                hidden
                aria-label="Import Manus Markdown files"
                onChange={(event) => {
                  const selected = Array.from(event.currentTarget.files ?? []);
                  event.currentTarget.value = "";
                  const markdown = selected.filter((file) => MARKDOWN_FILE.test(file.name));
                  if (markdown.length !== selected.length) toast("Choose .md or .markdown files from Manus.", "error");
                  void upload(markdown);
                }}
              />
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                aria-label="Upload files to this project"
                onChange={(e) => {
                  const list = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  void upload(list);
                }}
              />
            </div>
          </div>
        </aside>
      </div>

      {preview ? <MarkdownPreview key={preview.id} projectId={projectId} file={preview} onClose={() => setPreview(null)} /> : null}
      {sharing ? <ShareProjectModal project={project} onClose={() => setSharing(false)} /> : null}
      {editing ? <InstructionsDialog project={project} onClose={() => setEditing(false)} /> : null}
      {created ? <CreatedDialog project={project} onClose={closeCreated} onUpload={upload} /> : null}
    </div>
  );
}

export function ProjectViewFallback() {
  return (
    <div aria-busy="true" className="flex flex-1 flex-col gap-[16px] px-[40px] pt-[80px]">
      <div className="h-[48px] w-[240px] animate-pulse rounded-[12px] bg-[var(--om-fill)]" />
      <div className="h-[20px] w-[120px] animate-pulse rounded-[6px] bg-[var(--om-fill)]" />
    </div>
  );
}
