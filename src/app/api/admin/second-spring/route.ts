// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Organic Intelligence, Inc.
import { NextResponse } from "next/server";
import { db, fail } from "@/lib/db/client";
import { NotOperator, requireOperator } from "@/lib/observability/operator";
import { withErrorReporting } from "@/lib/observability/route";

export const GET = withErrorReporting("admin.second-spring", async () => {
  let operator;
  try {
    operator = await requireOperator();
  } catch (error) {
    if (error instanceof NotOperator) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    throw error;
  }
  if (!operator.owner || process.env.APP_DB_SCHEMA !== "mahara") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const { data, error } = await db().rpc("second_spring_context");
  if (error) fail("read Second Spring context", error);
  if (data == null) {
    return NextResponse.json({ error: "Second Spring context is unavailable." }, { status: 503 });
  }
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
});
