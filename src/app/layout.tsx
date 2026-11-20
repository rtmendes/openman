// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Organic Intelligence, Inc.
import type { Metadata } from "next";
import { Libre_Baskerville } from "next/font/google";
import { brand } from "@/config/brand";
import "./globals.css";

/** Serif used for headings; `font-serif` reads it through `--font-libre-baskerville`. Body text uses the system sans stack. */
const libreBaskerville = Libre_Baskerville({
  variable: "--font-libre-baskerville",
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: `${brand.name}: an agent with a computer of its own`,
  description: `${brand.name} is an open-source AI agent that browses, writes code, builds files and runs jobs on its own cloud computer, so you get finished work instead of instructions.`,
  applicationName: brand.name,
  icons: { apple: "/brand/app-192.png" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${libreBaskerville.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
