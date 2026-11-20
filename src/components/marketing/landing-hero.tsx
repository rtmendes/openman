// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Organic Intelligence, Inc.
"use client";

/** Landing page hero: a link card to the guide, the heading, "Continue with Orgo", a task box and starter chips. */
import { useRef, useState, type ComponentType, type KeyboardEvent, type SVGProps } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppWindow, ArrowUp, BarChart3, Plus, Presentation, Search } from "lucide-react";
import { useUI } from "@/lib/ui-store";
import { PENDING_PROMPT_KEY, stashPrompt } from "@/components/composer/handoff";
import { useSession } from "@/lib/supabase/client";
import { APP_HOME } from "@/lib/supabase/config";

/** The app's Home screen reads this key on load and sends the saved message as the first task. */
export { PENDING_PROMPT_KEY };

interface Chip {
  label: string;
  /** Text placed in the composer when the chip is picked. */
  starter: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  isNew?: boolean;
}

function ChipResearchIcon(props: SVGProps<SVGSVGElement>) {
  return <Search size={16} strokeWidth={1.7} aria-hidden {...props} />;
}

function ChipDataIcon(props: SVGProps<SVGSVGElement>) {
  return <BarChart3 size={16} strokeWidth={1.7} aria-hidden {...props} />;
}

function ChipWebsiteIcon(props: SVGProps<SVGSVGElement>) {
  return <AppWindow size={16} strokeWidth={1.7} aria-hidden {...props} />;
}

function ChipSlidesIcon(props: SVGProps<SVGSVGElement>) {
  return <Presentation size={16} strokeWidth={1.7} aria-hidden {...props} />;
}

/** Starters for work the agent does on its computer today: browsing, files, code and hosting. */
const chips: Chip[] = [
  { label: "Make a site", starter: "Make a website that ", Icon: ChipWebsiteIcon },
  { label: "Look into", starter: "Look into ", Icon: ChipResearchIcon },
  { label: "Draft a deck", starter: "Draft a slide deck on ", Icon: ChipSlidesIcon },
  { label: "Crunch numbers", starter: "Go through this data and ", Icon: ChipDataIcon },
];

const chipClass =
  "flex h-10 shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full border border-[var(--om-border)] px-[12px] py-[7px] transition-colors hover:bg-[var(--om-fill-subtle)]";

const MAX_TEXTAREA_HEIGHT = 200;

/** A small card above the heading that opens the getting-started guide. */
function GuideCard() {
  return (
    <Link
      href="/docs/getting-started"
      className="relative mx-auto mb-[64px] flex aspect-video w-[240px] max-w-full flex-col items-center justify-center overflow-hidden rounded-[12px] bg-black transition-opacity hover:opacity-95"
      style={{
        backgroundImage:
          "radial-gradient(ellipse 120% 90% at 10% 110% in oklab, #C7DCF0 0%, #7896C88C 30%, #00000000 60%), radial-gradient(ellipse 90% 80% at 95% 100% in oklab, #7F86E0 0%, #3C4FA8 35%, #00000000 70%), linear-gradient(180deg in oklab, #000000 0%, #05070F 40%, #1B2A5A 100%)",
      }}
    >
      <span className="text-center text-[12px] leading-[16px] text-white/80">Open source, on Orgo</span>
      <span className="text-center text-[17px] font-medium leading-[22px] text-white">Start in two minutes</span>
      <span className="mt-[10px] rounded-full bg-[#0000008C] px-[10px] py-[3px] text-[12px] leading-[16px] text-white">Open the guide →</span>
    </Link>
  );
}

export function LandingHero() {
  const router = useRouter();
  const openModal = useUI((state) => state.open);
  const { session, authDisabled } = useSession();
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canSend = text.trim().length > 0;

  function resize(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }

  function submit() {
    const message = text.trim();
    if (!message) return;
    // Storage can be unavailable (private mode); signing in still works, only the message is lost.
    stashPrompt(message, "send");
    if (session || authDisabled) {
      router.push(APP_HOME);
      return;
    }
    openModal("sign-in", { source: "composer" });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  function pickChip(chip: Chip) {
    setText(chip.starter);
    const element = textareaRef.current;
    if (!element) return;
    element.focus();
    requestAnimationFrame(() => {
      element.setSelectionRange(chip.starter.length, chip.starter.length);
      resize(element);
    });
  }

  return (
    <div className="mx-auto mt-[68px] w-full max-w-full pb-[64px] max-md:px-[16px] sm:min-w-[360px] sm:max-w-[768px]">
      <GuideCard />

      <h1 className="mb-[20px] text-center font-serif text-[36px] leading-[54px] text-[var(--om-text-1)]">
        Give it a job. Watch it work.
      </h1>
      <Link href="/content-studio" className="mx-auto mb-5 block w-fit text-sm text-[var(--om-text-accent)] hover:underline">
        Open Content Studio →
      </Link>

      <div className="mb-[28px] flex flex-col items-center gap-[8px]">
        {session || authDisabled ? (
          <button type="button" onClick={() => router.push(APP_HOME)} className="inline-flex h-[40px] cursor-pointer items-center justify-center rounded-full bg-[var(--om-btn-primary)] px-[20px] text-[15px] font-medium leading-[20px] text-white transition-opacity hover:opacity-90 active:opacity-80">
            Open the app
          </button>
        ) : (
          <>
            <button type="button" onClick={() => openModal("sign-in")} className="inline-flex h-[40px] cursor-pointer items-center justify-center rounded-full bg-[var(--om-btn-primary)] px-[20px] text-[15px] font-medium leading-[20px] text-white transition-opacity hover:opacity-90 active:opacity-80">
              Continue with Orgo
            </button>
            <p className="text-center text-[13px] leading-[18px] text-[var(--om-text-3)]">Runs on your Orgo account. New to Orgo? Create one free as you sign in.</p>
          </>
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="relative flex max-h-[300px] w-full flex-col gap-3 rounded-[22px] border border-black/8 bg-[var(--om-surface)] py-3 shadow-[0px_12px_32px_0px_rgba(0,0,0,0.02)] transition-all focus-within:border-black/20"
      >
        <div className="min-h-[66px] w-full overflow-auto pe-2 ps-4 pt-px">
          <textarea
            ref={textareaRef}
            rows={2}
            value={text}
            aria-label="Task"
            placeholder="Describe something you want done"
            onChange={(event) => {
              setText(event.target.value);
              resize(event.target);
            }}
            onKeyDown={onKeyDown}
            className="block w-full resize-none bg-transparent text-[15px] leading-[24px] text-[var(--om-text-1)] outline-none placeholder:text-[var(--om-text-disabled)] sm:text-[16px]"
          />
        </div>
        <div className="flex items-center justify-between gap-2 px-3">
          <button
            type="button"
            aria-label="Add files and more"
            onClick={() => (session || authDisabled ? router.push(APP_HOME) : openModal("sign-in"))}
            className="inline-flex size-[32px] shrink-0 cursor-pointer items-center justify-center rounded-full border border-[var(--om-border)] text-[var(--om-text-2)] transition-colors hover:bg-[var(--om-fill-subtle)]"
          >
            <Plus aria-hidden size={18} strokeWidth={1.8} className="text-[var(--om-icon-1)]" />
          </button>
          <button
            type="submit"
            aria-label="Send"
            disabled={!canSend}
            className="inline-flex size-[32px] shrink-0 cursor-pointer items-center justify-center rounded-full bg-[var(--om-btn-primary)] transition-colors hover:opacity-90 active:opacity-80 disabled:cursor-not-allowed disabled:bg-[var(--om-fill-strong)] disabled:hover:opacity-100"
          >
            <ArrowUp aria-hidden size={16} strokeWidth={2.2} className="text-white" />
          </button>
        </div>
      </form>

      {/* The chips sit on one line from 840px and wrap below that. */}
      <div className="mt-[20px] flex w-full flex-wrap items-center justify-center gap-2 min-[840px]:flex-nowrap">
        {chips.map((chip) => (
          <button key={chip.label} type="button" onClick={() => pickChip(chip)} className={chipClass}>
            <chip.Icon />
            <span className="flex items-center justify-start gap-1">
              <span className="text-[14px] font-normal leading-[20px] text-[var(--om-text-1)]">{chip.label}</span>
              {chip.isNew ? (
                <span className="inline-flex h-5 shrink-0 items-center rounded-[5px] bg-[var(--om-fill-accent)] px-1.5 text-[14px] leading-5 text-[var(--om-text-accent)]">
                  New
                </span>
              ) : null}
            </span>
          </button>
        ))}
        <button type="button" onClick={() => router.push("/features")} className={`${chipClass} text-[14px] leading-[20px] text-[var(--om-text-1)]`}>
          See all
        </button>
      </div>
    </div>
  );
}
