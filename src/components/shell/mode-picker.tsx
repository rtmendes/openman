// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Organic Intelligence, Inc.
"use client";

/**
 * Agent mode picker in the top bar. While Max is selected the menu also lists effort and speed.
 * The fourth mode ("bring your own model key") is shown only when it is real: Orgo reports that the user's agent
 * calls Claude with their own Anthropic key from Orgo Secrets (model usage billed by Anthropic, not Orgo credits).
 */
import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { brand, type ModeId } from "@/config/brand";
import { getModelKey } from "@/lib/agent/client";
import { EFFORTS, SPEEDS, useComposerHydration, useComposerStore } from "@/components/composer/store";
import { ProBadge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { CheckIcon, ChevronDownIcon } from "@/components/ui/icons";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";

/** Modes that carry the "Pro" chip. */
const PRO_MODES: ReadonlySet<ModeId> = new Set<ModeId>(["max", "standard", "flex"]);
const PRIMARY_MODES: readonly ModeId[] = ["max", "standard", "lite"];

/** Menu row: 8 px padding (12 px at the start), 8 px radius, a 14 px title over a 12 px description. */
const MODE_ROW = "h-auto min-h-0 items-stretch gap-[16px] rounded-[8px] p-[8px] ps-[12px] data-[highlighted]:bg-[var(--om-fill-subtle)]";

function ModeItem({ id, selected, onSelect, keepOpen = false }: { id: ModeId; selected: boolean; onSelect: (id: ModeId) => void; keepOpen?: boolean }) {
  const { label, description } = brand.modes[id];
  return (
    <MenuItem
      onSelect={(event) => {
        // Max reveals its effort and speed options, so the menu stays open for them.
        if (keepOpen) event.preventDefault();
        onSelect(id);
      }}
      className={MODE_ROW}
    >
      <span className={cn("flex min-w-0 flex-1 flex-col items-start", id !== "lite" && id !== "flex" && "max-w-[220px]")}>
        <span className="flex items-center gap-[6px] text-[14px] leading-[20px] text-[var(--om-text-1)]">
          <span className="shrink-0 whitespace-nowrap">{label}</span>
          {PRO_MODES.has(id) ? <ProBadge /> : null}
        </span>
        <span className="text-[12px] leading-[16px] text-[var(--om-text-3)]">{description}</span>
      </span>
      <span className="ms-auto flex w-[26px] shrink-0 items-center justify-end self-center">{selected ? <CheckIcon size={18} className="me-[8px] text-[var(--om-icon-1)]" /> : null}</span>
    </MenuItem>
  );
}

const MODE_DIVIDER = "mx-[12px] my-[4px] h-px bg-[var(--om-border)]";

type ModelKey = { ownKey: boolean; model: string | null; manageUrl: string };
let modelKeyCache: Promise<ModelKey | null> | null = null;
/** Orgo's answer on whether the agent uses the user's own Anthropic key, asked once per page load. */
export function useModelKey(): ModelKey | null {
  const [state, setState] = useState<ModelKey | null>(null);
  useEffect(() => {
    let cancelled = false;
    modelKeyCache ??= getModelKey().catch(() => null);
    void modelKeyCache.then((v) => {
      if (!cancelled) setState(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

/** The bring-your-own-key mode as Orgo delivers it: the agent already calls Claude with the key in the user's Orgo Secrets. */
function FlexItem({ selected, onSelect, manageUrl }: { selected: boolean; onSelect: (id: ModeId) => void; manageUrl: string }) {
  return (
    <MenuItem onSelect={() => onSelect("flex")} className={MODE_ROW} data-mode-flex>
      <span className="flex min-w-0 flex-1 flex-col items-start">
        <span className="flex items-center gap-[6px] text-[14px] leading-[20px] text-[var(--om-text-1)]">
          <span className="shrink-0 whitespace-nowrap">{brand.modes.flex.label}</span>
          <span className="rounded-[4px] border border-[var(--om-border)] px-[5px] text-[11px] leading-[16px] text-[var(--om-text-2)]">Anthropic key</span>
        </span>
        <span className="text-[12px] leading-[16px] text-[var(--om-text-3)]">Claude runs on the Anthropic key saved in your Orgo Secrets. Anthropic bills that usage directly; no Orgo credits are spent.</span>
        <a
          href={manageUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          className="mt-[2px] inline-flex items-center gap-[2px] text-[12px] leading-[16px] text-[var(--om-text-accent)] hover:underline"
        >
          Change the key in Orgo
          <ArrowUpRight size={12} aria-hidden="true" />
        </a>
      </span>
      <span className="ms-auto flex w-[26px] shrink-0 items-center justify-end self-center">{selected ? <CheckIcon size={18} className="me-[8px] text-[var(--om-icon-1)]" /> : null}</span>
    </MenuItem>
  );
}

function OptionSection<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { id: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <>
      <MenuSeparator className={MODE_DIVIDER} />
      <MenuLabel className="px-[12px] pb-[2px] pt-[6px] text-[12px] leading-[16px]">{label}</MenuLabel>
      <MenuRadioGroup value={value} onValueChange={(next) => onChange(next as T)}>
        {options.map((option) => (
          <MenuRadioItem key={option.id} value={option.id} onSelect={(event) => event.preventDefault()} className="justify-between ps-[12px] data-[highlighted]:bg-[var(--om-fill-subtle)]">
            {option.label}
            {value === option.id ? <CheckIcon size={18} className="me-[8px] text-[var(--om-icon-1)]" /> : null}
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </>
  );
}

export function ModePicker({ className }: { className?: string }) {
  useComposerHydration();
  const mode = useComposerStore((s) => s.mode);
  const effort = useComposerStore((s) => s.effort);
  const speed = useComposerStore((s) => s.speed);
  const setMode = useComposerStore((s) => s.setMode);
  const setEffort = useComposerStore((s) => s.setEffort);
  const setSpeed = useComposerStore((s) => s.setSpeed);
  const modelKey = useModelKey();
  const flexReal = modelKey?.ownKey === true;
  // A stored "flex" from before is not offered when the user has no key of their own: fall back to the default.
  useEffect(() => {
    if (modelKey && !modelKey.ownKey && mode === "flex") setMode("standard");
  }, [modelKey, mode, setMode]);

  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={`Agent mode: ${brand.modes[mode].label}`}
          className={cn(
            "group flex h-[32px] min-w-0 cursor-pointer select-none items-center justify-center gap-[4px] rounded-[8px] py-[7px] pl-[6px] pr-[4px] outline-none transition-[background-color] duration-150 ease-out hover:bg-[var(--om-fill)] focus-visible:bg-[var(--om-fill)] data-[state=open]:bg-[var(--om-fill)] md:pl-[8px] md:pr-[6px]",
            className,
          )}
        >
          <span className="truncate text-[16px] font-medium leading-[22px] text-[var(--om-text-1)]">{brand.modes[mode].label}</span>
          <ChevronDownIcon size={16} className="text-[var(--om-text-3)] transition-transform duration-150 ease-out group-data-[state=open]:rotate-180" />
        </button>
      </MenuTrigger>
      <MenuContent align="start" sideOffset={4} className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-[366px] max-w-[var(--radix-dropdown-menu-content-available-width)] overflow-y-auto p-[4px] backdrop-blur-[40px]">
        {PRIMARY_MODES.map((id) => (
          <ModeItem key={id} id={id} selected={mode === id} onSelect={setMode} keepOpen={id === "max"} />
        ))}
        {flexReal ? (
          <>
            <MenuSeparator className={MODE_DIVIDER} />
            <FlexItem selected={mode === "flex"} onSelect={setMode} manageUrl={modelKey.manageUrl} />
          </>
        ) : null}
        {modelKey && !flexReal ? (
          <>
            <MenuSeparator className={MODE_DIVIDER} />
            {modelKey.model ? <MenuLabel className="break-all px-[12px] py-[4px] text-[12px]">Home computer model: {modelKey.model}</MenuLabel> : null}
            <MenuItem asChild className="gap-2 ps-[12px]">
              <a href={modelKey.manageUrl} target="_blank" rel="noreferrer">
                Manage Anthropic key in Orgo <ArrowUpRight size={14} aria-hidden="true" />
              </a>
            </MenuItem>
          </>
        ) : null}
        {mode === "max" ? (
          <>
            <OptionSection label="Effort" value={effort} options={EFFORTS} onChange={setEffort} />
            <OptionSection label="Speed" value={speed} options={SPEEDS} onChange={setSpeed} />
          </>
        ) : null}
      </MenuContent>
    </Menu>
  );
}
