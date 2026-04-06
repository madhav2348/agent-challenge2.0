/**
 * Screenshot OCR Plugin for ElizaOS — v3
 *
 * Pipeline:
 *   1. Accept image via attachment or file path
 *   2. OCR via Claude Vision  →  extract all visible text
 *   3. AI pass               →  identify & classify media titles
 *   4. TMDB + OMDB           →  enrich with metadata (rating, genres, cast, etc.)
 *   5. Deduplication         →  skip titles already in catalog
 *   6. XLSX catalog          →  append new rows (auto-creates file on first run)
 *   7. Response              →  rich formatted summary back to user
 *
 * Sheets written:
 *   • Media Catalog  – one row per unique title
 *   • Scan Log       – one row per screenshot processed
 *   • Stats          – live formula-driven summary counts
 *
 * Required env / character secrets:
 *   TMDB_API_KEY   (free at themoviedb.org)
 *   OMDB_API_KEY   (free at omdbapi.com)
 *   CATALOG_PATH   (default: <cwd>/media_catalog.xlsx)
 *
 * Optional dependency for XLSX writing:
 *   npm install xlsx
 */

import {
  type Plugin,
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
} from "@elizaos/core";
import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type MediaType = "movie" | "series" | "animation" | "anime" | "documentary" | "unknown";
export type Confidence = "high" | "medium" | "low";

export interface MediaTitle {
  title: string;
  type: MediaType;
  confidence: Confidence;
  year?: string;
  additionalInfo?: string;
}

export interface MediaSearchResult {
  // Identity
  title: string;
  originalTitle?: string;
  type: string;
  subGenre?: string;
  // Release
  year?: string;
  releaseDate?: string;
  endYear?: string;
  // Locale
  country?: string;
  language?: string;
  // Ratings
  imdbRating?: string;
  imdbVotes?: string;
  tmdbScore?: string;
  rottenTomatoes?: string;
  metascore?: string;
  // Series details
  status?: string;
  seasons?: number;
  episodes?: number;
  avgEpMins?: number;
  // Production
  studio?: string;
  director?: string;
  cast?: string;        // top 3 actors, comma-separated
  genres?: string[];
  // Content
  overview?: string;
  tagline?: string;
  posterUrl?: string;
  ageRating?: string;   // PG, R, TV-MA, etc.
  // Source
  source: "TMDB" | "OMDB" | "TMDB+OMDB" | "AI_ENRICHED";
}

export interface OCRResult {
  rawText: string;
  mediaTitles: MediaTitle[];
  searchResults: MediaSearchResult[];
}

export interface ScreenshotPluginConfig {
  tmdbApiKey?: string;
  omdbApiKey?: string;
  catalogPath?: string;
}

export interface CatalogStats {
  totalTitles: number;
  totalScans: number;
  fileSizeKb: string;
  byType: Record<string, number>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// NETWORK HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function fetchUrl(url: string, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(data));
      res.on("error", reject);
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error("Request timed out")); });
    req.on("error", reject);
  });
}

function imageFileToBase64(filePath: string): { data: string; mediaType: string } {
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase().replace(".", "");
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    gif: "image/gif", webp: "image/webp",
  };
  return { data: buffer.toString("base64"), mediaType: map[ext] || "image/png" };
}

function safeStr(val: unknown, fallback = ""): string {
  return (val && String(val) !== "N/A") ? String(val) : fallback;
}

// ═══════════════════════════════════════════════════════════════════════════════
// API LOOKUPS
// ═══════════════════════════════════════════════════════════════════════════════

export async function searchTMDB(title: string, apiKey: string): Promise<MediaSearchResult | null> {
  try {
    const searchUrl = `https://api.themoviedb.org/3/search/multi?api_key=${apiKey}&query=${encodeURIComponent(title)}&language=en-US&page=1`;
    const data = JSON.parse(await fetchUrl(searchUrl));
    if (!data.results?.length) return null;

    const item = data.results[0];
    const tmdbType = item.media_type === "tv" ? "series" : item.media_type === "movie" ? "movie" : "unknown";
    const releaseDate = item.release_date || item.first_air_date || "";
    const year = releaseDate ? releaseDate.split("-")[0] : undefined;

    // Fetch full details for genres, tagline, status, cast
    const detailEndpoint = item.media_type === "tv"
      ? `https://api.themoviedb.org/3/tv/${item.id}?api_key=${apiKey}&append_to_response=credits`
      : `https://api.themoviedb.org/3/movie/${item.id}?api_key=${apiKey}&append_to_response=credits`;

    let detail: Record<string, unknown> = {};
    try { detail = JSON.parse(await fetchUrl(detailEndpoint)); } catch { /* skip */ }

    const genres: string[] = ((detail.genres || item.genre_ids) as {name:string}[] | number[])
      ?.filter((g): g is {name:string} => typeof g === "object")
      .map((g) => g.name) || [];

    const castList = ((detail as {credits?:{cast?:{name:string}[]}}).credits?.cast || [])
      .slice(0, 3).map((a) => a.name).join(", ");

    const seasons   = (detail as {number_of_seasons?:number}).number_of_seasons;
    const episodes  = (detail as {number_of_episodes?:number}).number_of_episodes;
    const status    = safeStr((detail as {status?:string}).status) || undefined;
    const tagline   = safeStr((detail as {tagline?:string}).tagline) || undefined;
    const studio    = ((detail as {production_companies?:{name:string}[]}).production_companies || [])[0]?.name;
    const network   = ((detail as {networks?:{name:string}[]}).networks || [])[0]?.name;
    const runtime   = (detail as {runtime?:number;episode_run_time?:number[]}).runtime
                   || (detail as {runtime?:number;episode_run_time?:number[]}).episode_run_time?.[0];
    const originCountry = ((detail as {origin_country?:string[]}).origin_country || [])[0];
    const origLang  = safeStr((detail as {original_language?:string}).original_language) || undefined;

    return {
      title: safeStr(item.title || item.name, title),
      originalTitle: safeStr(item.original_title || item.original_name) || undefined,
      type: tmdbType,
      year,
      releaseDate: releaseDate || undefined,
      country: originCountry || undefined,
      language: origLang,
      tmdbScore: item.vote_average ? String(item.vote_average.toFixed(1)) : undefined,
      status,
      seasons,
      episodes,
      avgEpMins: typeof runtime === "number" ? runtime : undefined,
      studio: studio || network || undefined,
      director: undefined,   // filled from OMDB merge if available
      cast: castList || undefined,
      genres,
      overview: item.overview?.slice(0, 280) || undefined,
      tagline,
      posterUrl: item.poster_path ? `https://image.tmdb.org/t/p/w300${item.poster_path}` : undefined,
      source: "TMDB",
    };
  } catch (e) {
    console.warn(`[TMDB] lookup failed for "${title}":`, (e as Error).message);
    return null;
  }
}

export async function searchOMDB(title: string, apiKey: string): Promise<MediaSearchResult | null> {
  try {
    const data = JSON.parse(await fetchUrl(`http://www.omdbapi.com/?t=${encodeURIComponent(title)}&apikey=${apiKey}`));
    if (data.Response === "False") return null;

    const typeMap: Record<string, string> = { movie: "movie", series: "series", episode: "series" };
    const seasons = data.totalSeasons ? parseInt(data.totalSeasons, 10) : undefined;

    const ratings: Record<string, string> = {};
    (data.Ratings || []).forEach((r: {Source:string;Value:string}) => { ratings[r.Source] = r.Value; });

    return {
      title: safeStr(data.Title, title),
      type: typeMap[data.Type] || "unknown",
      year: safeStr(data.Year) || undefined,
      releaseDate: safeStr(data.Released) || undefined,
      endYear: safeStr(data.Year?.includes("–") ? data.Year.split("–")[1] : "") || undefined,
      country: safeStr(data.Country) || undefined,
      language: safeStr(data.Language?.split(",")[0]?.trim()) || undefined,
      imdbRating: safeStr(data.imdbRating) || undefined,
      imdbVotes: safeStr(data.imdbVotes) || undefined,
      rottenTomatoes: ratings["Rotten Tomatoes"] || undefined,
      metascore: safeStr(data.Metascore) || undefined,
      status: seasons ? (seasons > 1 ? "Ongoing" : "Ended") : "Released",
      seasons,
      avgEpMins: data.Runtime ? parseInt(String(data.Runtime), 10) : undefined,
      studio: safeStr(data.Production) || undefined,
      director: safeStr(data.Director) || undefined,
      cast: safeStr(data.Actors) || undefined,
      genres: safeStr(data.Genre) ? data.Genre.split(", ") : [],
      overview: safeStr(data.Plot) || undefined,
      posterUrl: safeStr(data.Poster) || undefined,
      ageRating: safeStr(data.Rated) || undefined,
      source: "OMDB",
    };
  } catch (e) {
    console.warn(`[OMDB] lookup failed for "${title}":`, (e as Error).message);
    return null;
  }
}

/** Merge TMDB and OMDB results — prefer TMDB for scores, OMDB for cast/director/ratings */
function mergeResults(tmdb: MediaSearchResult, omdb: MediaSearchResult): MediaSearchResult {
  return {
    ...tmdb,
    imdbRating:    omdb.imdbRating    || tmdb.imdbRating,
    imdbVotes:     omdb.imdbVotes     || tmdb.imdbVotes,
    rottenTomatoes:omdb.rottenTomatoes,
    metascore:     omdb.metascore,
    director:      omdb.director      || tmdb.director,
    cast:          omdb.cast          || tmdb.cast,
    ageRating:     omdb.ageRating     || tmdb.ageRating,
    country:       omdb.country       || tmdb.country,
    language:      omdb.language      || tmdb.language,
    studio:        tmdb.studio        || omdb.studio,
    genres:        tmdb.genres?.length ? tmdb.genres : omdb.genres,
    overview:      tmdb.overview      || omdb.overview,
    status:        tmdb.status        || omdb.status,
    seasons:       tmdb.seasons       ?? omdb.seasons,
    episodes:      tmdb.episodes      ?? omdb.episodes,
    source: "TMDB+OMDB",
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// OCR + EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════════

export async function performOCRAndExtract(
  imagePath: string,
  _runtime: IAgentRuntime
): Promise<OCRResult> {
  const client = new Anthropic();

  // ── Step 1: Vision OCR ──────────────────────────────────────────────────────
  const { data: imageData, mediaType } = imageFileToBase64(imagePath);
  const ocrRes = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 2048,
    messages: [{
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data: imageData,
          },
        },
        {
          type: "text",
          text: `Extract EVERY piece of visible text from this screenshot exactly as it appears.
Include: titles, labels, buttons, descriptions, ratings, metadata, subtitles, overlays.
Preserve line breaks. Return only the raw extracted text — no commentary.`,
        },
      ],
    }],
  });
  const rawText = ocrRes.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n");

  // ── Step 2: Media title extraction ─────────────────────────────────────────
  const extractRes = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 2048,
    messages: [{
      role: "user",
      content: `Analyze this text extracted from a screenshot and identify every movie, TV series,
animation, anime, or documentary title present — including partially visible ones.

TEXT:
${rawText}

Rules:
- Include titles you recognise as real media even if context is minimal.
- For each title guess the sub-genre if possible (e.g. "Crime Drama", "Sci-Fi Thriller").
- Confidence: "high" = clearly a known title, "medium" = likely a title, "low" = uncertain.
- Include year only if it appears in the text alongside the title.

Return ONLY a valid JSON array. Each element:
{
  "title": string,
  "type": "movie"|"series"|"animation"|"anime"|"documentary"|"unknown",
  "confidence": "high"|"medium"|"low",
  "year": string|null,
  "additionalInfo": string|null
}

Return [] if nothing found. No markdown fences, no prose.`,
    }],
  });

  let mediaTitles: MediaTitle[] = [];
  try {
    const raw = extractRes.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");
    mediaTitles = JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch {
    mediaTitles = [];
  }

  return { rawText, mediaTitles, searchResults: [] };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENRICHMENT
// ═══════════════════════════════════════════════════════════════════════════════

export async function enrichMediaTitles(
  mediaTitles: MediaTitle[],
  config: ScreenshotPluginConfig
): Promise<MediaSearchResult[]> {
  const results: MediaSearchResult[] = [];

  for (const m of mediaTitles) {
    let tmdbResult: MediaSearchResult | null = null;
    let omdbResult: MediaSearchResult | null = null;

    if (config.tmdbApiKey) tmdbResult = await searchTMDB(m.title, config.tmdbApiKey);
    if (config.omdbApiKey) omdbResult = await searchOMDB(m.title, config.omdbApiKey);

    let found: MediaSearchResult;
    if (tmdbResult && omdbResult) {
      found = mergeResults(tmdbResult, omdbResult);
    } else if (tmdbResult) {
      found = tmdbResult;
    } else if (omdbResult) {
      found = omdbResult;
    } else {
      found = {
        title: m.title,
        type: m.type,
        year: m.year || undefined,
        source: "AI_ENRICHED",
      };
    }

    results.push(found);
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEDUPLICATION — skip titles already in the catalog
// ═══════════════════════════════════════════════════════════════════════════════

async function getExistingTitles(catalogPath: string): Promise<Set<string>> {
  const existing = new Set<string>();
  if (!fs.existsSync(catalogPath)) return existing;
  try {
    const XLSX = await import("xlsx");
    const wb = XLSX.readFile(catalogPath);
    const ws = wb.Sheets["Media Catalog"];
    if (!ws) return existing;
    const rows = XLSX.utils.sheet_to_json<{ Title?: string }>(ws);
    rows.forEach((r) => { if (r.Title) existing.add(r.Title.toLowerCase().trim()); });
  } catch { /* xlsx not installed — skip dedup */ }
  return existing;
}

// ═══════════════════════════════════════════════════════════════════════════════
// XLSX CATALOG WRITER
// ═══════════════════════════════════════════════════════════════════════════════

const CATALOG_HEADERS = [
  "ID", "Title", "Original Title", "Type", "Sub-Genre",
  "Release Year", "Release Date", "End Year",
  "Country", "Language", "Age Rating",
  "IMDB Rating", "IMDB Votes", "TMDB Score", "Rotten Tomatoes", "Metascore",
  "Status", "Seasons", "Episodes", "Avg Ep Mins",
  "Studio / Network", "Director", "Top Cast", "Genres",
  "Tagline", "Overview", "Poster URL",
  "Scanned From", "Date Scanned", "Confidence", "Data Source",
];

const SCAN_HEADERS = [
  "Scan #", "Screenshot File", "Date Scanned",
  "Titles Found", "New Titles Added", "Duplicates Skipped",
  "Raw OCR Snippet", "Status",
];

export async function appendToCatalog(
  catalogPath: string,
  scanFile: string,
  ocrResult: OCRResult,
  mediaTitles: MediaTitle[],
  skippedCount: number
): Promise<void> {
  let XLSX: typeof import("xlsx");
  try {
    XLSX = await import("xlsx");
  } catch {
    console.warn("[screenshot-ocr-plugin] 'xlsx' not installed — skipping Excel export. Run: npm install xlsx");
    return;
  }

  const { searchResults, rawText } = ocrResult;
  const dateStr = new Date().toISOString().split("T")[0];

  // ── Load or create workbook ─────────────────────────────────────────────────
  let wb: import("xlsx").WorkBook;
  if (fs.existsSync(catalogPath)) {
    wb = XLSX.readFile(catalogPath);
  } else {
    wb = XLSX.utils.book_new();
    // Stats sheet (formula-driven)
    const statsWs = XLSX.utils.aoa_to_sheet([
      ["Metric", "Value"],
      ["Total Titles",    { f: "COUNTA('Media Catalog'!A2:A1048576)" }],
      ["Total Scans",     { f: "COUNTA('Scan Log'!A2:A1048576)" }],
      ["Movies",          { f: "COUNTIF('Media Catalog'!D:D,\"Movie\")" }],
      ["Series",          { f: "COUNTIF('Media Catalog'!D:D,\"Series\")" }],
      ["Animations",      { f: "COUNTIF('Media Catalog'!D:D,\"Animation\")" }],
      ["Anime",           { f: "COUNTIF('Media Catalog'!D:D,\"Anime\")" }],
      ["Documentaries",   { f: "COUNTIF('Media Catalog'!D:D,\"Documentary\")" }],
      ["High Confidence", { f: "COUNTIF('Media Catalog'!AD:AD,\"High\")" }],
      ["Avg IMDB Rating", { f: "IFERROR(AVERAGE(IF('Media Catalog'!L2:L1048576<>\"\",VALUE('Media Catalog'!L2:L1048576))),\"N/A\")" }],
    ]);
    XLSX.utils.book_append_sheet(wb, statsWs, "Stats");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([CATALOG_HEADERS]), "Media Catalog");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([SCAN_HEADERS]), "Scan Log");
  }

  const catalogWs = wb.Sheets["Media Catalog"] || XLSX.utils.aoa_to_sheet([CATALOG_HEADERS]);
  const scanWs    = wb.Sheets["Scan Log"]       || XLSX.utils.aoa_to_sheet([SCAN_HEADERS]);

  const existingRowCount = (XLSX.utils.sheet_to_json(catalogWs) as unknown[]).length;
  let nextId = existingRowCount + 1;

  // ── Build new catalog rows ──────────────────────────────────────────────────
  const newRows = searchResults.map((res, i) => {
    const m = mediaTitles[i];
    const row = [
      nextId++,
      res.title,
      res.originalTitle || "",
      capitalise(res.type),
      res.subGenre || m.additionalInfo || "",
      res.year || "",
      res.releaseDate || "",
      res.endYear || "",
      res.country || "",
      res.language || "",
      res.ageRating || "",
      res.imdbRating || "",
      res.imdbVotes || "",
      res.tmdbScore || "",
      res.rottenTomatoes || "",
      res.metascore || "",
      res.status || "",
      res.seasons ?? "",
      res.episodes ?? "",
      res.avgEpMins ?? "",
      res.studio || "",
      res.director || "",
      res.cast || "",
      (res.genres || []).join(", "),
      res.tagline || "",
      res.overview || "",
      res.posterUrl || "",
      scanFile,
      dateStr,
      capitalise(m?.confidence || "low"),
      res.source,
    ];
    return row;
  });

  if (newRows.length > 0) {
    XLSX.utils.sheet_add_aoa(catalogWs, newRows, { origin: -1 });
    wb.Sheets["Media Catalog"] = catalogWs;
  }

  // ── Append scan log row ─────────────────────────────────────────────────────
  const scanCount = (XLSX.utils.sheet_to_json(scanWs) as unknown[]).length;
  XLSX.utils.sheet_add_aoa(scanWs, [[
    scanCount + 1,
    scanFile,
    dateStr,
    mediaTitles.length + skippedCount,   // total titles detected
    newRows.length,                       // new rows added
    skippedCount,                         // duplicates skipped
    rawText.slice(0, 140).replace(/\n/g, " | "),
    "Complete",
  ]], { origin: -1 });
  wb.Sheets["Scan Log"] = scanWs;

  XLSX.writeFile(wb, catalogPath);
  console.log(
    `[screenshot-ocr-plugin] Catalog updated → ${catalogPath}` +
    `  (+${newRows.length} new, ${skippedCount} skipped, scan #${scanCount + 1})`
  );
}

function capitalise(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CATALOG STATS READER
// ═══════════════════════════════════════════════════════════════════════════════

export async function readCatalogStats(catalogPath: string): Promise<CatalogStats | null> {
  if (!fs.existsSync(catalogPath)) return null;
  try {
    const XLSX = await import("xlsx");
    const wb = XLSX.readFile(catalogPath);
    const catalogWs = wb.Sheets["Media Catalog"];
    const scanWs    = wb.Sheets["Scan Log"];
    const rows = catalogWs ? XLSX.utils.sheet_to_json<{ Type?: string }>(catalogWs) : [];
    const scanRows = scanWs ? XLSX.utils.sheet_to_json(scanWs) as unknown[] : [];
    const byType: Record<string, number> = {};
    rows.forEach((r) => {
      const t = r.Type || "Unknown";
      byType[t] = (byType[t] || 0) + 1;
    });
    return {
      totalTitles: rows.length,
      totalScans: scanRows.length,
      fileSizeKb: (fs.statSync(catalogPath).size / 1024).toFixed(1),
      byType,
    };
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RESPONSE FORMATTER
// ═══════════════════════════════════════════════════════════════════════════════

export function formatMediaResults(
  ocrResult: OCRResult,
  catalogPath?: string,
  skippedCount = 0
): string {
  const { mediaTitles, searchResults } = ocrResult;

  if (mediaTitles.length === 0 && skippedCount === 0) {
    return "📸 Screenshot processed — no movie, series, or animation titles detected in the visible text.";
  }

  const emoji: Record<string, string> = {
    movie: "🎬", series: "📺", animation: "🎨", anime: "⛩️",
    documentary: "🎥", unknown: "🎞️",
  };

  const newCount = searchResults.length;
  let resp = `📸 **Screenshot OCR Complete**\n`;
  resp += `Found **${newCount + skippedCount}** title(s)`;
  if (skippedCount > 0) resp += ` · **${skippedCount}** already in catalog (skipped)`;
  if (newCount > 0)     resp += ` · **${newCount}** new`;
  resp += "\n\n";

  searchResults.forEach((r) => {
    const icon = emoji[r.type.toLowerCase()] || "🎞️";
    resp += `${icon} **${r.title}**`;
    if (r.year) resp += ` (${r.year})`;
    resp += "\n";

    // Ratings line
    const ratings: string[] = [];
    if (r.imdbRating)     ratings.push(`IMDB ${r.imdbRating}`);
    if (r.tmdbScore)      ratings.push(`TMDB ${r.tmdbScore}`);
    if (r.rottenTomatoes) ratings.push(`RT ${r.rottenTomatoes}`);
    resp += `   **${capitalise(r.type)}**`;
    if (ratings.length)   resp += ` · ${ratings.join(" · ")}`;
    if (r.ageRating)      resp += ` · ${r.ageRating}`;
    resp += "\n";

    if (r.director) resp += `   Dir: ${r.director}`;
    if (r.cast)     resp += `  Cast: ${r.cast}`;
    if (r.director || r.cast) resp += "\n";

    if (r.overview) resp += `   ${r.overview.slice(0, 180)}…\n`;

    const meta: string[] = [];
    if (r.genres?.length) meta.push(r.genres.join(", "));
    if (r.country)        meta.push(r.country);
    if (r.seasons)        meta.push(`${r.seasons} season${r.seasons > 1 ? "s" : ""}`);
    if (r.episodes)       meta.push(`${r.episodes} eps`);
    if (meta.length)      resp += `   ${meta.join(" · ")}\n`;

    resp += "\n";
  });

  if (catalogPath && newCount > 0) {
    resp += `📊 **${newCount} title(s) saved** → \`${catalogPath}\``;
  }

  return resp.trim();
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED CONFIG BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

function buildConfig(runtime: IAgentRuntime): ScreenshotPluginConfig {
  return {
    tmdbApiKey:  (runtime.getSetting("TMDB_API_KEY") as string)  || process.env.TMDB_API_KEY,
    omdbApiKey:  (runtime.getSetting("OMDB_API_KEY") as string)  || process.env.OMDB_API_KEY,
    catalogPath: (runtime.getSetting("CATALOG_PATH") as string)  || process.env.CATALOG_PATH
                 || path.join(process.cwd(), "media_catalog.xlsx"),
  };
}

function resolveImagePath(message: Memory): string | null {
  const content = message.content as {
    text?: string;
    attachments?: Array<{ url?: string; path?: string; filePath?: string }>;
  };
  if (content.attachments?.length) {
    const a = content.attachments[0];
    return a.filePath || a.path || a.url || null;
  }
  if (content.text) {
    const m = content.text.match(/(?:\/[\w.\-/]+\.(png|jpg|jpeg|webp|gif))/i);
    if (m) return m[0];
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION: ANALYZE_SCREENSHOT
// ═══════════════════════════════════════════════════════════════════════════════

const analyzeScreenshotAction: Action = {
  name: "ANALYZE_SCREENSHOT",
  description:
    "Full pipeline: OCR a screenshot → extract all text → identify media titles → enrich with " +
    "TMDB + OMDB metadata → deduplicate against existing catalog → append new rows to XLSX.",
  similes: [
    "SCREENSHOT_OCR", "READ_SCREENSHOT", "IDENTIFY_TITLES", "DETECT_MOVIES",
    "SCAN_SCREENSHOT", "SCREENSHOT_TITLES", "MEDIA_DETECTION", "FIND_TITLES",
    "SCAN_IMAGE", "ANALYZE_IMAGE",
  ],

  validate: async (_runtime, message) => {
    const hasAttachment = !!(message.content as { attachments?: unknown[] }).attachments?.length;
    const text = (message.content.text || "").toLowerCase();
    const kw = ["screenshot", "screen", "image", "picture", "photo", "scan", ".png", ".jpg", ".jpeg", ".webp"];
    return hasAttachment || kw.some((k) => text.includes(k));
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _opts: Record<string, unknown>,
    callback: HandlerCallback
  ): Promise<boolean> => {
    try {
      const imagePath = resolveImagePath(message);
      if (!imagePath) {
        await callback({ text: "🖼️ Please provide a screenshot or image file path to analyze.", content: {} });
        return false;
      }
      if (!imagePath.startsWith("http") && !fs.existsSync(imagePath)) {
        await callback({ text: `❌ Image not found: \`${imagePath}\`\nPlease check the path and try again.`, content: {} });
        return false;
      }

      await callback({ text: "🔍 Analyzing screenshot — extracting text and detecting media titles…", content: { status: "processing" } });

      const config = buildConfig(runtime);

      // OCR + extraction
      const ocrResult = await performOCRAndExtract(imagePath, runtime);

      let skippedCount = 0;

      if (ocrResult.mediaTitles.length > 0) {
        // Deduplication
        const existing = await getExistingTitles(config.catalogPath!);
        const newTitles = ocrResult.mediaTitles.filter((m) => !existing.has(m.title.toLowerCase().trim()));
        skippedCount = ocrResult.mediaTitles.length - newTitles.length;

        // Enrich only new titles
        ocrResult.searchResults = await enrichMediaTitles(newTitles, config);

        // Write to XLSX
        if (ocrResult.searchResults.length > 0 || skippedCount > 0) {
          await appendToCatalog(config.catalogPath!, imagePath, ocrResult, newTitles, skippedCount);
        }
      }

      const text = formatMediaResults(ocrResult, config.catalogPath, skippedCount);
      await callback({
        text,
        content: {
          status: "complete",
          rawText: ocrResult.rawText,
          mediaTitles: ocrResult.mediaTitles,
          searchResults: ocrResult.searchResults,
          skippedDuplicates: skippedCount,
          catalogPath: config.catalogPath,
        },
      });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[ANALYZE_SCREENSHOT] error:", msg);
      await callback({ text: `❌ Error analyzing screenshot: ${msg}`, content: { error: msg } });
      return false;
    }
  },

  examples: [
    [
      { user: "{{user1}}", content: { text: "Scan /home/user/netflix.png for movie titles" } },
      { user: "MyAgent",   content: { text: "🔍 Analyzing screenshot — extracting text and detecting media titles…", action: "ANALYZE_SCREENSHOT" } },
    ],
    [
      { user: "{{user1}}", content: { text: "What titles are on this screenshot?" } },
      { user: "MyAgent",   content: { text: "🔍 Analyzing screenshot — extracting text and detecting media titles…", action: "ANALYZE_SCREENSHOT" } },
    ],
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION: CATALOG_STATUS
// ═══════════════════════════════════════════════════════════════════════════════

const catalogStatusAction: Action = {
  name: "CATALOG_STATUS",
  description: "Report the current state of the media catalog XLSX: path, title count, scan count, breakdown by type.",
  similes: [
    "EXPORT_CATALOG", "SHOW_CATALOG", "CATALOG_INFO", "XLSX_STATUS",
    "SPREADSHEET_STATUS", "CATALOG_STATS", "HOW_MANY_TITLES",
  ],

  validate: async (_r, message) => {
    const t = (message.content.text || "").toLowerCase();
    return (
      t.includes("catalog") || t.includes("xlsx") || t.includes("spreadsheet") ||
      t.includes("how many") || t.includes("stats") || t.includes("summary")
    );
  },

  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State,
    _opts: Record<string, unknown>,
    callback: HandlerCallback
  ): Promise<boolean> => {
    const config = buildConfig(runtime);
    const stats = await readCatalogStats(config.catalogPath!);

    if (!stats) {
      await callback({
        text: `📊 No catalog found yet at \`${config.catalogPath}\`.\nScan a screenshot first and it will be created automatically.`,
        content: {},
      });
      return true;
    }

    const typeLines = Object.entries(stats.byType)
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `   ${t}: **${n}**`)
      .join("\n");

    await callback({
      text: [
        `📊 **Media Catalog Status**`,
        `Path: \`${config.catalogPath}\``,
        `Size: ${stats.fileSizeKb} KB`,
        ``,
        `📈 **${stats.totalTitles}** titles across **${stats.totalScans}** scans`,
        ``,
        `**By type:**`,
        typeLines,
      ].join("\n"),
      content: { catalogPath: config.catalogPath, ...stats },
    });
    return true;
  },

  examples: [[
    { user: "{{user1}}", content: { text: "How many titles are in the catalog?" } },
    { user: "MyAgent",   content: { text: "📊 **Media Catalog Status**\nPath: `./media_catalog.xlsx`\n…", action: "CATALOG_STATUS" } },
  ]],
};

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION: SEARCH_CATALOG
// ═══════════════════════════════════════════════════════════════════════════════

const searchCatalogAction: Action = {
  name: "SEARCH_CATALOG",
  description: "Search the local XLSX catalog for titles by name, type, genre, year, or rating.",
  similes: ["FIND_IN_CATALOG", "CATALOG_SEARCH", "LOOKUP_TITLE", "SEARCH_TITLES"],

  validate: async (_r, message) => {
    const t = (message.content.text || "").toLowerCase();
    return (t.includes("search") || t.includes("find") || t.includes("look up")) &&
           (t.includes("catalog") || t.includes("my") || t.includes("saved"));
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _opts: Record<string, unknown>,
    callback: HandlerCallback
  ): Promise<boolean> => {
    const config = buildConfig(runtime);
    const query = (message.content.text || "").toLowerCase();

    if (!fs.existsSync(config.catalogPath!)) {
      await callback({ text: "📊 Catalog is empty — scan some screenshots first.", content: {} });
      return true;
    }

    let XLSX: typeof import("xlsx");
    try { XLSX = await import("xlsx"); }
    catch {
      await callback({ text: "❌ xlsx package not installed — run `npm install xlsx`.", content: {} });
      return false;
    }

    type CatalogRow = { Title?: string; Type?: string; Genres?: string; "Release Year"?: string; "IMDB Rating"?: string; Overview?: string };
    const wb = XLSX.readFile(config.catalogPath!);
    const rows = XLSX.utils.sheet_to_json<CatalogRow>(wb.Sheets["Media Catalog"] || {});

    // Simple keyword filter across Title, Type, Genres
    const keywords = query.replace(/search|find|look up|catalog|my|saved|in the|titles/g, "").trim().split(/\s+/).filter(Boolean);
    const matches = rows.filter((r) => {
      const haystack = [r.Title, r.Type, r.Genres, r["Release Year"], r.Overview].join(" ").toLowerCase();
      return keywords.every((k) => haystack.includes(k));
    });

    if (matches.length === 0) {
      await callback({ text: `🔍 No titles found in catalog matching: **${keywords.join(", ")}**`, content: {} });
      return true;
    }

    const lines = matches.slice(0, 10).map((r) =>
      `• **${r.Title}** (${r["Release Year"] || "?"}) — ${r.Type}` +
      (r["IMDB Rating"] ? ` · IMDB ${r["IMDB Rating"]}` : "") +
      (r.Genres ? ` · ${r.Genres}` : "")
    );

    const extra = matches.length > 10 ? `\n…and ${matches.length - 10} more` : "";
    await callback({
      text: `🔍 Found **${matches.length}** match(es):\n\n${lines.join("\n")}${extra}`,
      content: { matches },
    });
    return true;
  },

  examples: [[
    { user: "{{user1}}", content: { text: "Search my catalog for anime" } },
    { user: "MyAgent",   content: { text: "🔍 Found 3 match(es):\n\n• **Demon Slayer** …", action: "SEARCH_CATALOG" } },
  ]],
};

// ═══════════════════════════════════════════════════════════════════════════════
// PLUGIN EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

export const screenshotOCRPlugin: Plugin = {
  name: "screenshot-ocr-plugin",
  description:
    "Screenshot → OCR → media title detection → TMDB+OMDB enrichment → dedup → persistent XLSX catalog. " +
    "Three actions: ANALYZE_SCREENSHOT, CATALOG_STATUS, SEARCH_CATALOG.",
  actions: [analyzeScreenshotAction, catalogStatusAction, searchCatalogAction],
  providers: [
    {
      name: "SCREENSHOT_OCR_CONTEXT",
      description: "Informs the agent about screenshot OCR and catalog capabilities",
      get: async (_runtime, _message) => ({
        text: `SCREENSHOT OCR CAPABILITIES:
You can analyze images/screenshots to detect media titles (movies, series, anime, animations, documentaries).
Workflow: OCR → title detection → TMDB+OMDB enrichment → dedup → XLSX catalog append.

CATALOG COLUMNS (media_catalog.xlsx / "Media Catalog" sheet):
ID | Title | Original Title | Type | Sub-Genre | Release Year | Release Date | End Year |
Country | Language | Age Rating | IMDB Rating | IMDB Votes | TMDB Score | Rotten Tomatoes | Metascore |
Status | Seasons | Episodes | Avg Ep Mins | Studio/Network | Director | Top Cast | Genres |
Tagline | Overview | Poster URL | Scanned From | Date Scanned | Confidence | Data Source

ACTIONS AVAILABLE:
• ANALYZE_SCREENSHOT — triggered by image/screenshot keywords or attachments
• CATALOG_STATUS     — triggered by "catalog", "xlsx", "how many titles", "stats"
• SEARCH_CATALOG     — triggered by "search/find in catalog/my titles"

SETUP: Set TMDB_API_KEY and OMDB_API_KEY in secrets for full metadata. CATALOG_PATH sets the xlsx location.`,
      }),
    },
  ],
  evaluators: [],
};

export default screenshotOCRPlugin;