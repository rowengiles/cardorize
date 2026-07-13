// Thin fetch client. Relative paths only (cardorize.ai serves SPA + API from
// one origin); the session rides on an httpOnly cookie.

export class ApiError extends Error {
  status: number;
  requiresTotp: boolean;
  constructor(message: string, status: number, requiresTotp = false) {
    super(message);
    this.status = status;
    this.requiresTotp = requiresTotp;
  }
}

async function handle<T>(res: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const b = body as { error?: string; requiresTotp?: boolean } | null;
    throw new ApiError(b?.error ?? `Request failed (${res.status})`, res.status, !!b?.requiresTotp);
  }
  return body as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return fetch(path, { credentials: "same-origin" }).then((r) => handle<T>(r));
}

export function apiSend<T>(method: string, path: string, body?: unknown): Promise<T> {
  return fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => handle<T>(r));
}

export function apiUpload<T>(path: string, file: File, fields: Record<string, string>): Promise<T> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append("file", file, file.name);
  return fetch(path, { method: "POST", credentials: "same-origin", body: form }).then((r) => handle<T>(r));
}
