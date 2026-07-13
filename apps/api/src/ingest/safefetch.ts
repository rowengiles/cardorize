// Outbound fetch with SSRF guards: http(s) only, public IPs only,
// manual redirect handling with re-validation, response size cap.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_BODY_BYTES = 15 * 1024 * 1024;
const MAX_REDIRECTS = 4;

function ipIsPrivate(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const lower = ip.toLowerCase();
  return (
    lower === "::1" ||
    lower === "::" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb") ||
    lower.startsWith("::ffff:") // treat mapped IPv4 as suspect; re-check below
  );
}

async function assertPublicHost(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http(s) URLs are supported");
  }
  const host = url.hostname;
  if (isIP(host)) {
    if (ipIsPrivate(host)) throw new Error("URL resolves to a private address");
    return;
  }
  const addrs = await lookup(host, { all: true }).catch(() => {
    throw new Error("Could not resolve that hostname");
  });
  for (const a of addrs) {
    if (ipIsPrivate(a.address)) throw new Error("URL resolves to a private address");
  }
}

export async function safeFetchText(
  rawUrl: string,
  opts: { accept?: string; maxBytes?: number } = {},
): Promise<{ text: string; finalUrl: string; contentType: string }> {
  let url = new URL(rawUrl);
  const maxBytes = opts.maxBytes ?? MAX_BODY_BYTES;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url);
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) CardorizeBot/0.1 (+https://cardorize.ai)",
        accept: opts.accept ?? "text/html,application/xhtml+xml,application/json,text/plain,*/*;q=0.5",
        "accept-language": "en-US,en;q=0.8",
      },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error(`Redirect without location (${res.status})`);
      url = new URL(loc, url);
      continue;
    }
    if (!res.ok) throw new Error(`Fetch failed with HTTP ${res.status}`);

    const reader = res.body?.getReader();
    if (!reader) return { text: "", finalUrl: url.toString(), contentType: res.headers.get("content-type") ?? "" };
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        break; // keep what we have — plenty for text extraction
      }
      chunks.push(value);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    return { text, finalUrl: url.toString(), contentType: res.headers.get("content-type") ?? "" };
  }
  throw new Error("Too many redirects");
}
