// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Organic Intelligence, Inc.
import type { Metadata } from "next";
import { Suspense } from "react";
import { getSession } from "@/lib/session";
import { operatorFor } from "@/lib/observability/operator";
import { ContentStudio } from "./content-studio";

export const metadata: Metadata = {
  title: "Content Studio",
  description: "An interactive workflow for researching, packaging, editing, and scripting videos in any niche.",
};

export default function Page() {
  return <Suspense fallback={<p role="status">Loading Content Studio…</p>}><StudioSession /></Suspense>;
}

async function StudioSession() {
  const session = await getSession();
  const owner = session && process.env.APP_DB_SCHEMA === "mahara" && (await operatorFor(session))?.owner;
  return <ContentStudio canLoadBrand={Boolean(owner)} signedIn={Boolean(session)} />;
}
