// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Organic Intelligence, Inc.
/** Shared marketing header, page content, footer and sign-in modal. */
import { Suspense, type ReactNode } from "react";
import { libreBaskerville } from "./fonts";
import { InertLinkToasts } from "./inert-links";
import { PromoBanner } from "./promo-banner";
import { SignInModal } from "./sign-in-modal";
import { SignInParamWatcher } from "./sign-in-param";
import { SiteFooter } from "./site-footer";
import { SiteHeader, type HeaderVariant } from "./site-header";

export function MarketingShell({ variant = "site", children }: { variant?: HeaderVariant; children: ReactNode }) {
  return (
    <div
      data-marketing-root=""
      className={`${libreBaskerville.variable} flex w-full flex-1 flex-col bg-[var(--om-bg)] font-sans text-[var(--om-text-1)] antialiased`}
    >
      {/* The first screen fills at least the viewport, so the footer always starts below the fold. */}
      <div className="flex min-h-dvh w-full shrink-0 flex-col">
        <SiteHeader variant={variant} />
        {variant !== "landing" && <PromoBanner />}
        {children}
      </div>
      <SiteFooter />
      <SignInModal />
      <InertLinkToasts />
      {/* Reads the query string, so it sits behind its own boundary and the pages stay static. */}
      <Suspense fallback={null}>
        <SignInParamWatcher />
      </Suspense>
    </div>
  );
}
