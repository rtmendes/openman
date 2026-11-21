// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Organic Intelligence, Inc.
/**
 * Request bodies with a byte limit applied BEFORE they are buffered: a declared `Content-Length` over the limit is
 * refused at once, and the stream is read chunk by chunk and abandoned as soon as it passes the limit (so a client
 * that lies about, or omits, the length cannot make the server hold more than `max` bytes). Server only.
 */
export class BodyTooLarge extends Error {
  readonly status = 413;
  constructor(readonly max: number) {
    super(`The request is larger than ${max >= 1024 * 1024 ? `${Math.round(max / (1024 * 1024))} MB` : `${Math.round(max / 1024)} KB`}.`);
  }
}

export async function readLimited(req: Pick<Request, "headers" | "body">, max: number): Promise<Buffer> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) throw new BodyTooLarge(max);
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLarge(max);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** JSON body with a byte limit. Throws `BodyTooLarge` or `SyntaxError`. */
export async function readJsonLimited<T = unknown>(req: Pick<Request, "headers" | "body">, max: number): Promise<T> {
  const buf = await readLimited(req, max);
  return JSON.parse(buf.toString("utf8")) as T;
}

/** Multipart form with a byte limit on the whole body. */
export async function readFormLimited(req: Request, max: number): Promise<FormData> {
  const buf = await readLimited(req, max);
  return new Request("http://local/form", { method: "POST", headers: { "content-type": req.headers.get("content-type") ?? "" }, body: new Uint8Array(buf) }).formData();
}
