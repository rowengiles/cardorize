// Readability-lite article extraction: fetch HTML, isolate the main content
// region, strip markup, decode common entities. Good enough for articles,
// wikis, whitepapers-as-HTML and most blog engines.
import { safeFetchText } from "./safefetch.js";

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…", rsquo: "'", lsquo: "'", rdquo: "”", ldquo: "“",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => ENTITIES[name] ?? m);
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function fetchArticle(url: string): Promise<{ title: string; text: string }> {
  const { text: html, contentType } = await safeFetchText(url);
  if (contentType.includes("application/pdf")) {
    throw new Error("That link is a PDF — download it and use file upload instead (PDF-by-URL is on the roadmap).");
  }
  if (!contentType.includes("html") && !contentType.includes("text") && contentType !== "") {
    // Plain text / markdown served directly
    return { title: url, text: html.slice(0, 400_000) };
  }

  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim().slice(0, 200) : url;

  // Prefer semantic containers; fall back to <body>.
  const regionMatch =
    /<article[^>]*>([\s\S]*?)<\/article>/i.exec(html) ??
    /<main[^>]*>([\s\S]*?)<\/main>/i.exec(html) ??
    /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  const region = regionMatch ? regionMatch[1] : html;

  const text = htmlToText(region).slice(0, 400_000);
  if (text.length < 200) {
    throw new Error(
      "Could not extract readable text from that page (it may be JavaScript-rendered or behind a login). Try copying the text in directly.",
    );
  }
  return { title, text };
}
