// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Organic Intelligence, Inc.
import type { Metadata } from "next";
import { ContentStudio } from "./content-studio";

export const metadata: Metadata = {
  title: "Content Studio",
  description: "An interactive workflow for researching, packaging, editing, and scripting videos in any niche.",
};

export default function Page() {
  return <ContentStudio />;
}
