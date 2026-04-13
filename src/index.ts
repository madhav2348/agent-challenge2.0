/**
 * Screenshot OCR Plugin for ElizaOS — v4
 *
 * Pipeline per scan:
 *   1. Accept image via attachment or file path
 *   2. OCR via Claude Vision        → extract all visible text
 *   3. AI classification            → identify & type media titles
 *   4. TMDB + OMDB enrichment       → ratings, cast, genres, metadata
 *   5. Deduplication                → skip titles already cataloged
 *   6. XLSX write                   → append to local media_catalog.xlsx
 *   7. Google Sheets sync           → append same rows to Google Sheet (parallel)
 *   8. Response                     → rich summary sent back to user
 *
 * Google Sheets sheets created/used:
 *   • Media Catalog  — one row per unique title (31 columns)
 *   • Scan Log       — one row per screenshot processed
 *   • Stats          — ARRAYFORMULA-driven live summary
 *
 * Required secrets / env vars:
 *   TMDB_API_KEY              (free — themoviedb.org)
 *   OMDB_API_KEY              (free — omdbapi.com)
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL   (from GCP service account JSON)
 *   GOOGLE_PRIVATE_KEY             (from GCP service account JSON — include \n newlines)
 *   GOOGLE_SHEET_ID                (the spreadsheet ID from its URL)
 *   CATALOG_PATH              (optional, default: <cwd>/media_catalog.xlsx)
 *
 * npm dependencies:
 *   npm install xlsx googleapis
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
import * as fs   from "fs";
import * as path from "path";
import * as https from "https";
import * as http  from "http";
import { MediaSearchResult, MediaTitle, OCRResult, ScreenshotPluginConfig, SceneContext } from "./type";
import { buildConfig } from "./config";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════════
// COLUMN SCHEMA  (shared by XLSX + Google Sheets — order matters)
// ═══════════════════════════════════════════════════════════════════════════════

export const CATALOG_HEADERS = [
  "ID", "Title", "Original Title", "Type", "Sub-Genre",
  "Release Year", "Release Date", "End Year",
  "Country", "Language", "Age Rating",
  "IMDB Rating", "IMDB Votes", "TMDB Score", "Rotten Tomatoes", "Metascore",
  "Status", "Seasons", "Episodes", "Avg Ep Mins",
  "Studio / Network", "Director", "Top Cast", "Genres",
  "Tagline", "Overview", "Poster URL",
  "Scene Description", "Scanned From", "Date Scanned", "Confidence", "Data Source",
];

export const SCAN_HEADERS = [
  "Scan #", "Screenshot File", "Date Scanned",
  "Titles Found", "New Titles Added", "Duplicates Skipped",
  "Raw OCR Snippet", "Status",
];

// ═══════════════════════════════════════════════════════════════════════════════
// NETWORK HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function fetchUrl(url: string, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(data));
      res.on("error", reject);
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error("Timeout")); });
    req.on("error", reject);
  });
}

function imageFileToBase64(filePath: string): { data: string; mediaType: string } {
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase().replace(".", "");
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    gif: "image/gif",  webp: "image/webp",
  };
  return { data: buffer.toString("base64"), mediaType: map[ext] || "image/png" };
}

function safeStr(val: unknown, fallback = ""): string {
  return val && String(val) !== "N/A" ? String(val) : fallback;
}

function capitalise(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MULTI-SOURCE LOOKUPS (TMDB, OMDB, Spotify, etc.)
// ═══════════════════════════════════════════════════════════════════════════════

export async function searchTMDB(title: string, apiKey: string): Promise<MediaSearchResult | null> {
  try {
    const data = JSON.parse(
      await fetchUrl(`https://api.themoviedb.org/3/search/multi?api_key=${apiKey}&query=${encodeURIComponent(title)}&language=en-US&page=1`)
    );
    if (!data.results?.length) return null;

    const item      = data.results[0];
    const tmdbType  = item.media_type === "tv" ? "series" : item.media_type === "movie" ? "movie" : "unknown";
    const releaseDate = item.release_date || item.first_air_date || "";

    const detailUrl = item.media_type === "tv"
      ? `https://api.themoviedb.org/3/tv/${item.id}?api_key=${apiKey}&append_to_response=credits`
      : `https://api.themoviedb.org/3/movie/${item.id}?api_key=${apiKey}&append_to_response=credits`;

    let detail: Record<string, unknown> = {};
    try { detail = JSON.parse(await fetchUrl(detailUrl)); } catch { /* skip */ }

    const genres   = ((detail.genres as {name:string}[]) || []).map(g => g.name);
    const castList = ((detail as {credits?:{cast?:{name:string}[]}}).credits?.cast || []).slice(0,3).map(a => a.name).join(", ");
    const studio   = ((detail as {production_companies?:{name:string}[]}).production_companies || [])[0]?.name;
    const network  = ((detail as {networks?:{name:string}[]}).networks || [])[0]?.name;
    const runtime  = (detail as {runtime?:number; episode_run_time?:number[]}).runtime
                  || (detail as {runtime?:number; episode_run_time?:number[]}).episode_run_time?.[0];

    return {
      title:         safeStr(item.title || item.name, title),
      originalTitle: safeStr(item.original_title || item.original_name) || undefined,
      type:          tmdbType,
      year:          releaseDate ? releaseDate.split("-")[0] : undefined,
      releaseDate:   releaseDate || undefined,
      country:       ((detail as {origin_country?:string[]}).origin_country || [])[0] || undefined,
      language:      safeStr((detail as {original_language?:string}).original_language) || undefined,
      tmdbScore:     item.vote_average ? String(item.vote_average.toFixed(1)) : undefined,
      status:        safeStr((detail as {status?:string}).status) || undefined,
      seasons:       (detail as {number_of_seasons?:number}).number_of_seasons,
      episodes:      (detail as {number_of_episodes?:number}).number_of_episodes,
      avgEpMins:     typeof runtime === "number" ? runtime : undefined,
      studio:        studio || network || undefined,
      cast:          castList || undefined,
      genres,
      overview:      item.overview?.slice(0, 280) || undefined,
      tagline:       safeStr((detail as {tagline?:string}).tagline) || undefined,
      posterUrl:     item.poster_path ? `https://image.tmdb.org/t/p/w300${item.poster_path}` : undefined,
      source:        "TMDB",
    };
  } catch (e) {
    console.warn(`[TMDB] "${title}":`, (e as Error).message);
    return null;
  }
}

export async function searchOMDB(title: string, apiKey: string): Promise<MediaSearchResult | null> {
  try {
    const data = JSON.parse(await fetchUrl(`http://www.omdbapi.com/?t=${encodeURIComponent(title)}&apikey=${apiKey}`));
    if (data.Response === "False") return null;
    const typeMap: Record<string,string> = { movie:"movie", series:"series", episode:"series" };
    const seasons = data.totalSeasons ? parseInt(data.totalSeasons, 10) : undefined;
    const ratings: Record<string,string> = {};
    (data.Ratings || []).forEach((r:{Source:string;Value:string}) => { ratings[r.Source] = r.Value; });
    return {
      title:          safeStr(data.Title, title),
      type:           typeMap[data.Type] || "unknown",
      year:           safeStr(data.Year) || undefined,
      releaseDate:    safeStr(data.Released) || undefined,
      endYear:        data.Year?.includes("–") ? data.Year.split("–")[1]?.trim() : undefined,
      country:        safeStr(data.Country) || undefined,
      language:       safeStr(data.Language?.split(",")[0]?.trim()) || undefined,
      ageRating:      safeStr(data.Rated) || undefined,
      imdbRating:     safeStr(data.imdbRating) || undefined,
      imdbVotes:      safeStr(data.imdbVotes) || undefined,
      rottenTomatoes: ratings["Rotten Tomatoes"] || undefined,
      metascore:      safeStr(data.Metascore) || undefined,
      status:         seasons ? (seasons > 1 ? "Ongoing" : "Ended") : "Released",
      seasons,
      avgEpMins:      data.Runtime ? parseInt(String(data.Runtime), 10) : undefined,
      studio:         safeStr(data.Production) || undefined,
      director:       safeStr(data.Director) || undefined,
      cast:           safeStr(data.Actors) || undefined,
      genres:         safeStr(data.Genre) ? data.Genre.split(", ") : [],
      overview:       safeStr(data.Plot) || undefined,
      posterUrl:      safeStr(data.Poster) || undefined,
      source:         "OMDB",
    };
  } catch (e) {
    console.warn(`[OMDB] "${title}":`, (e as Error).message);
    return null;
  }
}

function mergeResults(tmdb: MediaSearchResult, omdb: MediaSearchResult): MediaSearchResult {
  return {
    ...tmdb,
    imdbRating:     omdb.imdbRating     || tmdb.imdbRating,
    imdbVotes:      omdb.imdbVotes      || tmdb.imdbVotes,
    rottenTomatoes: omdb.rottenTomatoes,
    metascore:      omdb.metascore,
    ageRating:      omdb.ageRating      || tmdb.ageRating,
    director:       omdb.director       || tmdb.director,
    cast:           omdb.cast           || tmdb.cast,
    country:        omdb.country        || tmdb.country,
    language:       omdb.language       || tmdb.language,
    studio:         tmdb.studio         || omdb.studio,
    genres:         tmdb.genres?.length ? tmdb.genres : (omdb.genres || []),
    overview:       tmdb.overview       || omdb.overview,
    status:         tmdb.status         || omdb.status,
    seasons:        tmdb.seasons        ?? omdb.seasons,
    episodes:       tmdb.episodes       ?? omdb.episodes,
    source:         "TMDB+OMDB",
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
  const { data: imageData, mediaType } = imageFileToBase64(imagePath);

  // Step 1 — Vision OCR
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
            media_type: mediaType as "image/jpeg"|"image/png"|"image/gif"|"image/webp",
            data: imageData,
          },
        },
        {
          type: "text",
          text: "Extract EVERY piece of visible text from this screenshot exactly as it appears — titles, labels, buttons, ratings, descriptions, overlays, subtitles. Preserve line breaks. Return only the raw text.",
        },
      ],
    }],
  });
  const rawText = ocrRes.content
    .filter(b => b.type === "text")
    .map(b => (b as {type:"text";text:string}).text)
    .join("\n");

  // Step 2 — Media title extraction (all types)
  const extractRes = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 2048,
    messages: [{
      role: "user",
      content: `Identify EVERY title visible in this text, including:
• Movies, TV series, documentaries
• Anime, animation, manga, webtoons, comics
• Music: artists, albums, songs, bands
• Podcasts, audiobooks
• Video games, board games
• Books, novels, light novels
• Any other media/entertainment titles

Include partially visible titles you can recognize.

TEXT:
${rawText}

Return ONLY a valid JSON array — no prose, no fences:
[{"title":string,"type":"movie"|"series"|"animation"|"anime"|"documentary"|"music"|"album"|"artist"|"podcast"|"episode"|"game"|"book"|"manga"|"comic"|"webtoon"|"unknown","confidence":"high"|"medium"|"low","year":string|null,"additionalInfo":string|null}]
Return [] if nothing found.`,
    }],
  });

  let mediaTitles: MediaTitle[] = [];
  try {
    const raw = extractRes.content.filter(b => b.type === "text").map(b => (b as {type:"text";text:string}).text).join("");
    mediaTitles = JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch { mediaTitles = []; }

  // Step 3 — Scene context extraction
  let sceneContext: SceneContext | undefined;
  try {
    const sceneRes = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 512,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType as "image/jpeg"|"image/png"|"image/gif"|"image/webp",
              data: imageData,
            },
          },
          {
            type: "text",
            text: `Analyze this screenshot and describe the scene in 1-2 sentences. Include:
- What's happening (action/mood)
- Setting/location if visible
- Any notable characters or elements

Return ONLY valid JSON (no prose):
{"description":string,"setting":string|null,"mood":string|null,"characters":string[]|null}`,
          },
        ],
      }],
    });
    const sceneRaw = sceneRes.content.filter(b => b.type === "text").map(b => (b as {type:"text";text:string}).text).join("");
    sceneContext = JSON.parse(sceneRaw.replace(/```json|```/g, "").trim());
  } catch { /* skip scene extraction on error */ }

  return { rawText, mediaTitles, searchResults: [], sceneContext };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENRICHMENT (handles all media types)
// ═══════════════════════════════════════════════════════════════════════════════

export async function enrichMediaTitles(
  mediaTitles: MediaTitle[],
  config: ScreenshotPluginConfig
): Promise<MediaSearchResult[]> {
  const results: MediaSearchResult[] = [];
  for (const m of mediaTitles) {
    let result: MediaSearchResult | null = null;

    // Route to appropriate API based on media type
    switch (m.type) {
      case "music":
      case "album":
      case "artist":
        // For music, use basic AI enrichment (Spotify API would require auth)
        result = await enrichMusicTitle(m);
        break;

      case "podcast":
      case "episode":
        // For podcasts, use basic AI enrichment
        result = await enrichPodcastTitle(m);
        break;

      case "game":
        // For games, use basic AI enrichment (IGDB would require auth)
        result = await enrichGameTitle(m);
        break;

      case "book":
      case "manga":
      case "comic":
      case "webtoon":
        // For books/manga, use basic AI enrichment
        result = await enrichBookTitle(m);
        break;

      default:
        // For movies, series, anime, documentaries - use TMDB + OMDB
        let tmdb: MediaSearchResult | null = null;
        let omdb: MediaSearchResult | null = null;
        if (config.tmdbApiKey) tmdb = await searchTMDB(m.title, config.tmdbApiKey);
        if (config.omdbApiKey) omdb = await searchOMDB(m.title, config.omdbApiKey);
        
        if (tmdb && omdb) result = mergeResults(tmdb, omdb);
        else if (tmdb) result = tmdb;
        else if (omdb) result = omdb;
        else result = { title: m.title, type: m.type, year: m.year, source: "AI_ENRICHED" };
    }

    if (result) results.push(result);
  }
  return results;
}

// ── Music enrichment (AI-based) ──────────────────────────────────────────────

async function enrichMusicTitle(m: MediaTitle): Promise<MediaSearchResult> {
  return {
    title: m.title,
    type: m.type,
    year: m.year,
    additionalInfo: m.additionalInfo,
    genres: m.additionalInfo ? [m.additionalInfo] : [],
    source: "AI_ENRICHED",
  };
}

// ── Podcast enrichment (AI-based) ────────────────────────────────────────────

async function enrichPodcastTitle(m: MediaTitle): Promise<MediaSearchResult> {
  return {
    title: m.title,
    type: m.type,
    year: m.year,
    additionalInfo: m.additionalInfo,
    genres: ["podcast"],
    source: "AI_ENRICHED",
  };
}

// ── Game enrichment (AI-based) ───────────────────────────────────────────────

async function enrichGameTitle(m: MediaTitle): Promise<MediaSearchResult> {
  return {
    title: m.title,
    type: m.type,
    year: m.year,
    additionalInfo: m.additionalInfo,
    genres: m.additionalInfo ? [m.additionalInfo] : ["game"],
    source: "AI_ENRICHED",
  };
}

// ── Book/Manga enrichment (AI-based) ─────────────────────────────────────────

async function enrichBookTitle(m: MediaTitle): Promise<MediaSearchResult> {
  return {
    title: m.title,
    type: m.type,
    year: m.year,
    additionalInfo: m.additionalInfo,
    genres: m.additionalInfo ? [m.additionalInfo] : [],
    source: "AI_ENRICHED",
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROW BUILDER  (shared for XLSX + Google Sheets)
// ═══════════════════════════════════════════════════════════════════════════════

export function buildCatalogRow(
  id: number,
  res: MediaSearchResult,
  m: MediaTitle,
  scanFile: string,
  dateStr: string,
  sceneDesc?: string
): (string | number)[] {
  return [
    id,
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
    sceneDesc || "",
    scanFile,
    dateStr,
    capitalise(m?.confidence || "low"),
    res.source,
  ];
}

export function buildScanRow(
  scanId: number,
  scanFile: string,
  dateStr: string,
  totalFound: number,
  newAdded: number,
  skipped: number,
  rawText: string
): (string | number)[] {
  return [
    scanId,
    scanFile,
    dateStr,
    totalFound,
    newAdded,
    skipped,
    rawText.slice(0, 140).replace(/\n/g, " | "),
    "Complete",
  ];
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEDUPLICATION — reads existing titles from catalog (XLSX preferred, Sheet fallback)
// ═══════════════════════════════════════════════════════════════════════════════

async function getExistingTitles(catalogPath: string): Promise<Set<string>> {
  const existing = new Set<string>();
  if (!fs.existsSync(catalogPath)) return existing;
  try {
    const XLSX = await import("xlsx");
    const wb   = XLSX.readFile(catalogPath);
    const ws   = wb.Sheets["Media Catalog"];
    if (!ws) return existing;
    (XLSX.utils.sheet_to_json<{Title?:string}>(ws)).forEach(r => {
      if (r.Title) existing.add(r.Title.toLowerCase().trim());
    });
  } catch { /* xlsx not installed */ }
  return existing;
}

// ═══════════════════════════════════════════════════════════════════════════════
// XLSX WRITER
// ═══════════════════════════════════════════════════════════════════════════════

export async function appendToXLSX(
  catalogPath: string,
  scanFile: string,
  ocrResult: OCRResult,
  mediaTitles: MediaTitle[],
  skippedCount: number
): Promise<void> {
  let XLSX: typeof import("xlsx");
  try { XLSX = await import("xlsx"); }
  catch {
    console.warn("[XLSX] 'xlsx' not installed — run: npm install xlsx");
    return;
  }

  const { searchResults, rawText, sceneContext } = ocrResult;
  const dateStr = new Date().toISOString().split("T")[0];
  const sceneDesc = sceneContext?.description || "";

  let wb: import("xlsx").WorkBook;
  if (fs.existsSync(catalogPath)) {
    wb = XLSX.readFile(catalogPath);
  } else {
    wb = XLSX.utils.book_new();
    const statsWs = XLSX.utils.aoa_to_sheet([
      ["Metric", "Value"],
      ["Total Titles",    { f: "COUNTA('Media Catalog'!A2:A1048576)" }],
      ["Total Scans",     { f: "COUNTA('Scan Log'!A2:A1048576)" }],
      ["Movies",          { f: "COUNTIF('Media Catalog'!D:D,\"Movie\")" }],
      ["Series",          { f: "COUNTIF('Media Catalog'!D:D,\"Series\")" }],
      ["Animations",      { f: "COUNTIF('Media Catalog'!D:D,\"Animation\")" }],
      ["Anime",           { f: "COUNTIF('Media Catalog'!D:D,\"Anime\")" }],
      ["Documentaries",   { f: "COUNTIF('Media Catalog'!D:D,\"Documentary\")" }],
    ]);
    XLSX.utils.book_append_sheet(wb, statsWs, "Stats");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([CATALOG_HEADERS]), "Media Catalog");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([SCAN_HEADERS]), "Scan Log");
  }

  const catalogWs = wb.Sheets["Media Catalog"] || XLSX.utils.aoa_to_sheet([CATALOG_HEADERS]);
  const scanWs    = wb.Sheets["Scan Log"]       || XLSX.utils.aoa_to_sheet([SCAN_HEADERS]);

  const existingRows = (XLSX.utils.sheet_to_json(catalogWs) as unknown[]).length;
  let nextId = existingRows + 1;

  const newRows = searchResults.map((res, i) =>
    buildCatalogRow(nextId++, res, mediaTitles[i], scanFile, dateStr, sceneDesc)
  );
  if (newRows.length > 0) {
    XLSX.utils.sheet_add_aoa(catalogWs, newRows, { origin: -1 });
    wb.Sheets["Media Catalog"] = catalogWs;
  }

  const scanCount = (XLSX.utils.sheet_to_json(scanWs) as unknown[]).length;
  XLSX.utils.sheet_add_aoa(scanWs, [
    buildScanRow(scanCount + 1, scanFile, dateStr, mediaTitles.length + skippedCount, newRows.length, skippedCount, rawText)
  ], { origin: -1 });
  wb.Sheets["Scan Log"] = scanWs;

  XLSX.writeFile(wb, catalogPath);
  console.log(`[XLSX] +${newRows.length} new, ${skippedCount} skipped → ${catalogPath}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// GOOGLE SHEETS WRITER
// ═══════════════════════════════════════════════════════════════════════════════
//
//  Authentication: Google Service Account (server-to-server, no OAuth browser flow)
//  Steps to set up:
//    1. GCP Console → IAM & Admin → Service Accounts → Create
//    2. Create key → JSON → download
//    3. Share your Google Sheet with the service account email (Editor)
//    4. Copy email + private_key into character secrets
//
//  Sheet structure created automatically on first run:
//    Tab "Media Catalog"  — header row + data rows
//    Tab "Scan Log"       — header row + data rows
//    Tab "Stats"          — COUNTIF/AVERAGE formula dashboard

interface SheetsClient {
  getAuthToken(): Promise<string>;
  sheetId: string;
}

// ── JWT / OAuth2 for service accounts (pure Node, no googleapis needed) ───────

async function getGoogleAccessToken(email: string, privateKey: string): Promise<string> {
  // Build JWT
  const now   = Math.floor(Date.now() / 1000);
  const claim = {
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const header  = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claim)).toString("base64url");
  const sigInput = `${header}.${payload}`;

  // Sign with RS256 using Node built-in crypto
  const { createSign } = await import("crypto");
  const sign = createSign("RSA-SHA256");
  sign.update(sigInput);
  // Handle escaped newlines from env vars
  const pem = privateKey.replace(/\\n/g, "\n");
  const signature = sign.sign(pem, "base64url");
  const jwt = `${sigInput}.${signature}`;

  // Exchange JWT for access token
  const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
  const tokenData = await new Promise<string>((resolve, reject) => {
    const postData = Buffer.from(body);
    const req = https.request(
      {
        hostname: "oauth2.googleapis.com",
        path: "/token",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": postData.length,
        },
      },
      (res) => {
        let d = "";
        res.on("data", c => (d += c));
        res.on("end", () => resolve(d));
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.write(postData);
    req.end();
  });

  const parsed = JSON.parse(tokenData);
  if (!parsed.access_token) throw new Error(`Google auth failed: ${tokenData}`);
  return parsed.access_token;
}

// ── Sheets REST API helpers ───────────────────────────────────────────────────

async function sheetsRequest(
  token: string,
  method: string,
  endpoint: string,
  bodyObj?: unknown
): Promise<unknown> {
  const bodyStr = bodyObj ? JSON.stringify(bodyObj) : undefined;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "sheets.googleapis.com",
        path: `/v4/spreadsheets${endpoint}`,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {}),
        },
      },
      (res) => {
        let d = "";
        res.on("data", c => (d += c));
        res.on("end", () => {
          try { resolve(JSON.parse(d)); }
          catch { resolve(d); }
        });
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Ensure tabs exist with header rows ───────────────────────────────────────

async function ensureSheetTabs(token: string, sheetId: string): Promise<void> {
  const spreadsheet = await sheetsRequest(token, "GET", `/${sheetId}`) as {
    sheets: { properties: { title: string; sheetId: number } }[];
  };

  const existingTabs = new Set(spreadsheet.sheets.map(s => s.properties.title));
  const tabsToCreate = ["Media Catalog", "Scan Log", "Stats"].filter(t => !existingTabs.has(t));

  if (tabsToCreate.length > 0) {
    await sheetsRequest(token, "POST", `/${sheetId}:batchUpdate`, {
      requests: tabsToCreate.map(title => ({ addSheet: { properties: { title } } })),
    });
  }

  // Write header rows if tabs were just created
  const valuesToSet: { range: string; values: (string | number)[][] }[] = [];

  if (!existingTabs.has("Media Catalog")) {
    valuesToSet.push({ range: "'Media Catalog'!A1", values: [CATALOG_HEADERS] });
  }
  if (!existingTabs.has("Scan Log")) {
    valuesToSet.push({ range: "'Scan Log'!A1", values: [SCAN_HEADERS] });
  }
  if (!existingTabs.has("Stats")) {
    valuesToSet.push({
      range: "'Stats'!A1",
      values: [
        ["Metric", "Value"],
        ["Total Titles",    `=COUNTA('Media Catalog'!A2:A)`],
        ["Total Scans",     `=COUNTA('Scan Log'!A2:A)`],
        ["Movies",          `=COUNTIF('Media Catalog'!D:D,"Movie")`],
        ["Series",          `=COUNTIF('Media Catalog'!D:D,"Series")`],
        ["Animations",      `=COUNTIF('Media Catalog'!D:D,"Animation")`],
        ["Anime",           `=COUNTIF('Media Catalog'!D:D,"Anime")`],
        ["Documentaries",   `=COUNTIF('Media Catalog'!D:D,"Documentary")`],
        ["High Confidence", `=COUNTIF('Media Catalog'!AD:AD,"High")`],
        ["Avg IMDB",        `=IFERROR(AVERAGE(IFERROR(VALUE('Media Catalog'!L2:L),)),"-")`],
      ],
    });
  }

  if (valuesToSet.length > 0) {
    await sheetsRequest(token, "POST", `/${sheetId}/values:batchUpdate`, {
      valueInputOption: "USER_ENTERED",
      data: valuesToSet,
    });
  }
}

// ── Get last used row in a sheet tab ─────────────────────────────────────────

async function getLastRow(token: string, sheetId: string, tabName: string): Promise<number> {
  const res = await sheetsRequest(token, "GET", `/${sheetId}/values/'${encodeURIComponent(tabName)}'!A:A`) as {
    values?: string[][];
  };
  return res.values ? res.values.length : 1; // 1 = header row only
}

// ── Append rows to a specific tab ────────────────────────────────────────────

async function appendRowsToSheet(
  token: string,
  sheetId: string,
  tabName: string,
  rows: (string | number)[][]
): Promise<void> {
  if (rows.length === 0) return;
  await sheetsRequest(
    token, "POST",
    `/${sheetId}/values/${encodeURIComponent(`'${tabName}'`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { values: rows }
  );
}

// ── Format header row (bold + frozen) ────────────────────────────────────────

async function formatHeaderRow(token: string, sheetId: string, spreadsheet: {
  sheets: { properties: { title: string; sheetId: number } }[];
}): Promise<void> {
  const requests: unknown[] = [];
  for (const tab of ["Media Catalog", "Scan Log", "Stats"]) {
    const sheet = spreadsheet.sheets.find(s => s.properties.title === tab);
    if (!sheet) continue;
    const sid = sheet.properties.sheetId;
    requests.push(
      // Bold header
      {
        repeatCell: {
          range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.157, green: 0.118, blue: 0.294 },
              textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
            },
          },
          fields: "userEnteredFormat(backgroundColor,textFormat)",
        },
      },
      // Freeze header row
      {
        updateSheetProperties: {
          properties: { sheetId: sid, gridProperties: { frozenRowCount: 1 } },
          fields: "gridProperties.frozenRowCount",
        },
      }
    );
  }
  if (requests.length > 0) {
    await sheetsRequest(token, "POST", `/${sheetId}:batchUpdate`, { requests });
  }
}

// ── Main Google Sheets sync function ─────────────────────────────────────────

export async function syncToGoogleSheets(
  config: ScreenshotPluginConfig,
  scanFile: string,
  ocrResult: OCRResult,
  mediaTitles: MediaTitle[],
  skippedCount: number,
  existingRowCount: number
): Promise<string | null> {
  const { googleServiceAccountEmail, googlePrivateKey, googleSheetId } = config;
  if (!googleServiceAccountEmail || !googlePrivateKey || !googleSheetId) {
    console.log("[Sheets] Missing credentials — skipping Google Sheets sync.");
    return null;
  }

  try {
    const token = await getGoogleAccessToken(googleServiceAccountEmail, googlePrivateKey);
    await ensureSheetTabs(token, googleSheetId);

    const { searchResults, rawText, sceneContext } = ocrResult;
    const dateStr = new Date().toISOString().split("T")[0];
    const sceneDesc = sceneContext?.description || "";

    // Get current row counts for IDs
    const catalogLastRow = await getLastRow(token, googleSheetId, "Media Catalog");
    const scanLastRow    = await getLastRow(token, googleSheetId, "Scan Log");

    let nextId = catalogLastRow; // row 1 = header, so row 2 = ID 1, etc.

    // Build catalog rows
    const catalogRows = searchResults.map((res, i) =>
      buildCatalogRow(nextId++, res, mediaTitles[i], scanFile, dateStr, sceneDesc) as (string|number)[]
    );

    // Append to Media Catalog
    await appendRowsToSheet(token, googleSheetId, "Media Catalog", catalogRows);

    // Append to Scan Log
    await appendRowsToSheet(token, googleSheetId, "Scan Log", [
      buildScanRow(
        scanLastRow,
        scanFile,
        dateStr,
        mediaTitles.length + skippedCount,
        catalogRows.length,
        skippedCount,
        rawText
      ) as (string|number)[]
    ]);

    // Apply formatting on first write (when tabs were just created)
    if (catalogLastRow === 1) {
      const spreadsheet = await sheetsRequest(token, "GET", `/${googleSheetId}`) as {
        sheets: { properties: { title: string; sheetId: number } }[];
      };
      await formatHeaderRow(token, googleSheetId, spreadsheet);
    }

    const sheetUrl = `https://docs.google.com/spreadsheets/d/${googleSheetId}`;
    console.log(`[Sheets] +${catalogRows.length} rows synced → ${sheetUrl}`);
    return sheetUrl;
  } catch (e) {
    console.error("[Sheets] sync failed:", (e as Error).message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CATALOG STATS
// ═══════════════════════════════════════════════════════════════════════════════

export async function readCatalogStats(
  catalogPath: string,
  googleSheetId?: string
): Promise<CatalogStats | null> {
  if (!fs.existsSync(catalogPath)) return null;
  try {
    const XLSX     = await import("xlsx");
    const wb       = XLSX.readFile(catalogPath);
    const rows     = wb.Sheets["Media Catalog"]
      ? XLSX.utils.sheet_to_json<{Type?:string}>(wb.Sheets["Media Catalog"])
      : [];
    const scanRows = wb.Sheets["Scan Log"]
      ? (XLSX.utils.sheet_to_json(wb.Sheets["Scan Log"]) as unknown[])
      : [];
    const byType: Record<string,number> = {};
    rows.forEach(r => { const t = r.Type || "Unknown"; byType[t] = (byType[t] || 0) + 1; });
    return {
      totalTitles: rows.length,
      totalScans:  scanRows.length,
      fileSizeKb:  (fs.statSync(catalogPath).size / 1024).toFixed(1),
      byType,
      sheetUrl: googleSheetId ? `https://docs.google.com/spreadsheets/d/${googleSheetId}` : undefined,
    };
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RESPONSE FORMATTER
// ═══════════════════════════════════════════════════════════════════════════════

export function formatMediaResults(
  ocrResult: OCRResult,
  catalogPath?: string,
  sheetUrl?: string | null,
  skippedCount = 0
): string {
  const { mediaTitles, searchResults } = ocrResult;
  if (mediaTitles.length === 0 && skippedCount === 0) {
    return "📸 Screenshot processed — no media titles detected in the visible text.";
  }

  const emoji: Record<string,string> = {
    movie:"🎬", series:"📺", animation:"🎨", anime:"⛩️", documentary:"🎥",
    music:"🎵", album:"💿", artist:"🎤", podcast:"🎙️", episode:"📻",
    game:"🎮", book:"📖", manga:"📚", comic:"💭", webtoon:"📱",
    unknown:"🎞️",
  };

  const newCount = searchResults.length;
  let resp = `📸 **Screenshot OCR Complete**\n`;
  resp += `Found **${newCount + skippedCount}** title(s)`;
  if (skippedCount > 0) resp += ` · **${skippedCount}** already cataloged (skipped)`;
  if (newCount > 0)     resp += ` · **${newCount}** new`;
  resp += "\n\n";

  searchResults.forEach(r => {
    const icon = emoji[r.type?.toLowerCase()] || "🎞️";
    resp += `${icon} **${r.title}**`;
    if (r.year) resp += ` (${r.year})`;
    resp += "\n";

    const ratings: string[] = [];
    if (r.imdbRating)     ratings.push(`IMDB ${r.imdbRating}`);
    if (r.tmdbScore)      ratings.push(`TMDB ${r.tmdbScore}`);
    if (r.rottenTomatoes) ratings.push(`RT ${r.rottenTomatoes}`);
    resp += `   **${capitalise(r.type)}**`;
    if (ratings.length)   resp += ` · ${ratings.join(" · ")}`;
    if (r.ageRating)      resp += ` · ${r.ageRating}`;
    resp += "\n";

    if (r.director || r.cast) {
      if (r.director) resp += `   Dir: ${r.director}`;
      if (r.cast)     resp += `  Cast: ${r.cast}`;
      resp += "\n";
    }
    if (r.overview) resp += `   ${r.overview.slice(0, 180)}…\n`;

    const meta: string[] = [];
    if (r.genres?.length) meta.push(r.genres.join(", "));
    if (r.country)        meta.push(r.country);
    if (r.seasons)        meta.push(`${r.seasons} season${r.seasons > 1 ? "s" : ""}`);
    if (r.episodes)       meta.push(`${r.episodes} eps`);
    if (meta.length)      resp += `   ${meta.join(" · ")}\n`;
    resp += "\n";
  });

  // Storage summary
  if (newCount > 0) {
    const destinations: string[] = [];
    if (catalogPath) destinations.push(`📁 Local: \`${catalogPath}\``);
    if (sheetUrl)    destinations.push(`🌐 Google Sheet: ${sheetUrl}`);
    if (destinations.length) resp += destinations.join("  \n");
  }

  return resp.trim();
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED HELPERS
// ═══════════════════════════════════════════════════════════════════════════════


function resolveImagePath(message: Memory): string | null {
  const content = message.content as {
    text?: string;
    attachments?: Array<{url?:string; path?:string; filePath?:string}>;
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
    "Full pipeline: OCR screenshot → detect media titles → TMDB+OMDB enrichment → deduplicate → " +
    "write to local XLSX + sync to Google Sheets in parallel.",
  similes: [
    "SCREENSHOT_OCR", "READ_SCREENSHOT", "IDENTIFY_TITLES", "DETECT_MOVIES",
    "SCAN_SCREENSHOT", "SCREENSHOT_TITLES", "MEDIA_DETECTION", "FIND_TITLES",
    "SCAN_IMAGE", "ANALYZE_IMAGE",
  ],

  validate: async (_runtime, message) => {
    const hasAttachment = !!(message.content as {attachments?:unknown[]}).attachments?.length;
    const text = (message.content.text || "").toLowerCase();
    const kw = ["screenshot","screen","image","picture","photo","scan",".png",".jpg",".jpeg",".webp"];
    return hasAttachment || kw.some(k => text.includes(k));
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
        await callback({ text: `❌ Image not found: \`${imagePath}\``, content: {} });
        return false;
      }

      await callback({
        text: "🔍 Analyzing screenshot — extracting text and detecting media titles…",
        content: { status: "processing" },
      });

      const config = buildConfig(runtime);

      // OCR + extraction
      const ocrResult = await performOCRAndExtract(imagePath, runtime);
      let skippedCount = 0;
      let sheetUrl: string | null = null;

      if (ocrResult.mediaTitles.length > 0) {
        // Deduplication
        const existing   = await getExistingTitles(config.catalogPath!);
        const newTitles  = ocrResult.mediaTitles.filter(m => !existing.has(m.title.toLowerCase().trim()));
        skippedCount     = ocrResult.mediaTitles.length - newTitles.length;

        // Enrich
        ocrResult.searchResults = await enrichMediaTitles(newTitles, config);

        // Write XLSX + Google Sheets in parallel
        await Promise.all([
          appendToXLSX(config.catalogPath!, imagePath, ocrResult, newTitles, skippedCount),
          syncToGoogleSheets(config, imagePath, ocrResult, newTitles, skippedCount, existing.size).then(url => {
            sheetUrl = url;
          }),
        ]);
      }

      await callback({
        text: formatMediaResults(ocrResult, config.catalogPath, sheetUrl, skippedCount),
        content: {
          status: "complete",
          rawText: ocrResult.rawText,
          mediaTitles: ocrResult.mediaTitles,
          searchResults: ocrResult.searchResults,
          skippedDuplicates: skippedCount,
          catalogPath: config.catalogPath,
          googleSheetUrl: sheetUrl,
        },
      });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[ANALYZE_SCREENSHOT]", msg);
      await callback({ text: `❌ Error: ${msg}`, content: { error: msg } });
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
  description: "Report state of the media catalog: title count, scan count, type breakdown, XLSX path, Google Sheet URL.",
  similes: [
    "EXPORT_CATALOG","SHOW_CATALOG","CATALOG_INFO","XLSX_STATUS",
    "SPREADSHEET_STATUS","CATALOG_STATS","HOW_MANY_TITLES","GOOGLE_SHEET_STATUS",
  ],

  validate: async (_r, message) => {
    const t = (message.content.text || "").toLowerCase();
    return t.includes("catalog") || t.includes("xlsx") || t.includes("spreadsheet") ||
           t.includes("how many") || t.includes("stats") || t.includes("google sheet");
  },

  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State,
    _opts: Record<string, unknown>,
    callback: HandlerCallback
  ): Promise<boolean> => {
    const config = buildConfig(runtime);
    const stats  = await readCatalogStats(config.catalogPath!, config.googleSheetId);

    if (!stats) {
      await callback({
        text: `📊 No catalog yet at \`${config.catalogPath}\`.\nScan a screenshot first — the file is created automatically.`,
        content: {},
      });
      return true;
    }

    const typeLines = Object.entries(stats.byType)
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `   ${t}: **${n}**`)
      .join("\n");

    const lines = [
      `📊 **Media Catalog Status**`,
      ``,
      `📁 Local XLSX: \`${config.catalogPath}\` (${stats.fileSizeKb} KB)`,
    ];
    if (stats.sheetUrl) lines.push(`🌐 Google Sheet: ${stats.sheetUrl}`);
    lines.push(
      ``,
      `📈 **${stats.totalTitles}** titles · **${stats.totalScans}** scans`,
      ``,
      `**By type:**`,
      typeLines
    );

    await callback({
      text: lines.join("\n"),
      content: { catalogPath: config.catalogPath, googleSheetUrl: stats.sheetUrl, ...stats },
    });
    return true;
  },

  examples: [[
    { user: "{{user1}}", content: { text: "How many titles are in my catalog?" } },
    { user: "MyAgent",   content: { text: "📊 **Media Catalog Status**\n…", action: "CATALOG_STATUS" } },
  ]],
};

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION: SEARCH_CATALOG
// ═══════════════════════════════════════════════════════════════════════════════

const searchCatalogAction: Action = {
  name: "SEARCH_CATALOG",
  description: "Search the local XLSX catalog by title, type, genre, year, director, or rating.",
  similes: ["FIND_IN_CATALOG","CATALOG_SEARCH","LOOKUP_TITLE","SEARCH_TITLES","FILTER_CATALOG"],

  validate: async (_r, message) => {
    const t = (message.content.text || "").toLowerCase();
    return (t.includes("search") || t.includes("find") || t.includes("look up") || t.includes("filter")) &&
           (t.includes("catalog") || t.includes("my") || t.includes("saved") || t.includes("titles"));
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _opts: Record<string, unknown>,
    callback: HandlerCallback
  ): Promise<boolean> => {
    const config = buildConfig(runtime);
    const query  = (message.content.text || "").toLowerCase();

    if (!fs.existsSync(config.catalogPath!)) {
      await callback({ text: "📊 Catalog is empty — scan some screenshots first.", content: {} });
      return true;
    }

    let XLSX: typeof import("xlsx");
    try { XLSX = await import("xlsx"); }
    catch {
      await callback({ text: "❌ xlsx not installed — run `npm install xlsx`.", content: {} });
      return false;
    }

    type CatalogRow = {
      Title?: string; Type?: string; Genres?: string;
      "Release Year"?: string; "IMDB Rating"?: string;
      Director?: string; "Top Cast"?: string; Overview?: string;
    };
    const wb      = XLSX.readFile(config.catalogPath!);
    const rows    = XLSX.utils.sheet_to_json<CatalogRow>(wb.Sheets["Media Catalog"] || {});
    const keywords = query
      .replace(/search|find|look up|filter|catalog|my|saved|in the|titles|for|show me/g, "")
      .trim().split(/\s+/).filter(Boolean);

    const matches = rows.filter(r => {
      const hay = [r.Title, r.Type, r.Genres, r["Release Year"], r.Director, r["Top Cast"], r.Overview]
        .join(" ").toLowerCase();
      return keywords.every(k => hay.includes(k));
    });

    if (matches.length === 0) {
      await callback({ text: `🔍 No matches for: **${keywords.join(", ")}**`, content: {} });
      return true;
    }

    const lines = matches.slice(0, 12).map(r =>
      `• **${r.Title}** (${r["Release Year"] || "?"}) — ${r.Type}` +
      (r["IMDB Rating"] ? ` · IMDB ${r["IMDB Rating"]}` : "") +
      (r.Director ? ` · Dir: ${r.Director}` : "") +
      (r.Genres ? `\n  ${r.Genres}` : "")
    );
    const extra = matches.length > 12 ? `\n…and ${matches.length - 12} more` : "";

    await callback({
      text: `🔍 **${matches.length}** match(es) for "${keywords.join(" ")}":\n\n${lines.join("\n")}${extra}`,
      content: { matches },
    });
    return true;
  },

  examples: [[
    { user: "{{user1}}", content: { text: "Search my catalog for anime" } },
    { user: "MyAgent",   content: { text: "🔍 **3** match(es) for \"anime\":\n\n• **Demon Slayer** …", action: "SEARCH_CATALOG" } },
  ]],
};

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION: SYNC_TO_SHEETS  (manual trigger — re-syncs entire XLSX to Google Sheets)
// ═══════════════════════════════════════════════════════════════════════════════

const syncToSheetsAction: Action = {
  name: "SYNC_TO_SHEETS",
  description: "Manually push the full local XLSX catalog to Google Sheets (useful after offline scans).",
  similes: ["PUSH_TO_SHEETS","UPLOAD_CATALOG","SYNC_CATALOG","GOOGLE_SHEETS_SYNC","FORCE_SYNC"],

  validate: async (_r, message) => {
    const t = (message.content.text || "").toLowerCase();
    return (t.includes("sync") || t.includes("push") || t.includes("upload")) &&
           (t.includes("sheet") || t.includes("google") || t.includes("catalog"));
  },

  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State,
    _opts: Record<string, unknown>,
    callback: HandlerCallback
  ): Promise<boolean> => {
    const config = buildConfig(runtime);

    if (!config.googleSheetId || !config.googleServiceAccountEmail || !config.googlePrivateKey) {
      await callback({
        text: "❌ Google Sheets not configured. Set `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, and `GOOGLE_PRIVATE_KEY` in your character secrets.",
        content: {},
      });
      return false;
    }

    if (!fs.existsSync(config.catalogPath!)) {
      await callback({ text: "📊 No local catalog found — scan screenshots first.", content: {} });
      return false;
    }

    let XLSX: typeof import("xlsx");
    try { XLSX = await import("xlsx"); }
    catch {
      await callback({ text: "❌ xlsx not installed — run `npm install xlsx`.", content: {} });
      return false;
    }

    await callback({ text: "☁️ Syncing local catalog to Google Sheets…", content: { status: "syncing" } });

    try {
      const token = await getGoogleAccessToken(config.googleServiceAccountEmail!, config.googlePrivateKey!);
      await ensureSheetTabs(token, config.googleSheetId!);

      const wb          = XLSX.readFile(config.catalogPath!);
      const catalogRows = XLSX.utils.sheet_to_json<Record<string,string|number>>(wb.Sheets["Media Catalog"] || {}, { header: 1 }) as (string|number)[][];
      const scanRows    = XLSX.utils.sheet_to_json<Record<string,string|number>>(wb.Sheets["Scan Log"] || {}, { header: 1 }) as (string|number)[][];

      // Clear existing data (keep header) then re-append
      await sheetsRequest(token, "POST", `/${config.googleSheetId!}:batchUpdate`, {
        requests: [
          { deleteRange: { range: { sheetId: 0, startRowIndex: 1 }, shiftDimension: "ROWS" } },
        ],
      });

      // Data rows only (skip header which is row index 0)
      const dataRows = catalogRows.slice(1);
      await appendRowsToSheet(token, config.googleSheetId!, "Media Catalog", dataRows);
      await appendRowsToSheet(token, config.googleSheetId!, "Scan Log", scanRows.slice(1));

      const sheetUrl = `https://docs.google.com/spreadsheets/d/${config.googleSheetId}`;
      await callback({
        text: `✅ Sync complete — **${dataRows.length}** titles pushed to Google Sheets.\n🌐 ${sheetUrl}`,
        content: { status: "complete", sheetUrl, rowsSynced: dataRows.length },
      });
      return true;
    } catch (e) {
      const msg = (e as Error).message;
      await callback({ text: `❌ Sync failed: ${msg}`, content: { error: msg } });
      return false;
    }
  },

  examples: [[
    { user: "{{user1}}", content: { text: "Sync my catalog to Google Sheets" } },
    { user: "MyAgent",   content: { text: "☁️ Syncing local catalog to Google Sheets…", action: "SYNC_TO_SHEETS" } },
  ]],
};

// ═══════════════════════════════════════════════════════════════════════════════
// PLUGIN EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

export const screenshotOCRPlugin: Plugin = {
  name: "screenshot-ocr-plugin",
  description:
    "Screenshot OCR → media title detection → TMDB+OMDB enrichment → dedup → " +
    "dual-write to local XLSX + Google Sheets. Four actions: ANALYZE_SCREENSHOT, " +
    "CATALOG_STATUS, SEARCH_CATALOG, SYNC_TO_SHEETS.",
  actions: [
    analyzeScreenshotAction,
    catalogStatusAction,
    searchCatalogAction,
    syncToSheetsAction,
  ],
  providers: [
    {
      name: "SCREENSHOT_OCR_CONTEXT",
      description: "Context about screenshot OCR, catalog, and Google Sheets capabilities",
      get: async (_runtime, _message) => ({
        text: `SCREENSHOT OCR PLUGIN — v4

PIPELINE (per scan):
  OCR → title detection → TMDB+OMDB enrichment → dedup → XLSX write + Google Sheets sync (parallel)

CATALOG COLUMNS (31 total):
  ID | Title | Original Title | Type | Sub-Genre | Release Year | Release Date | End Year |
  Country | Language | Age Rating | IMDB Rating | IMDB Votes | TMDB Score | Rotten Tomatoes |
  Metascore | Status | Seasons | Episodes | Avg Ep Mins | Studio/Network | Director | Top Cast |
  Genres | Tagline | Overview | Poster URL | Scanned From | Date Scanned | Confidence | Data Source

SHEETS:
  "Media Catalog" — one row per unique title
  "Scan Log"      — one row per screenshot processed (tracks new vs skipped)
  "Stats"         — COUNTIF/AVERAGE formula dashboard (auto-refreshes in Sheets)

ACTIONS:
  ANALYZE_SCREENSHOT — image/screenshot/scan keywords or attachments
  CATALOG_STATUS     — "catalog", "xlsx", "how many titles", "google sheet", "stats"
  SEARCH_CATALOG     — "search/find/filter in catalog/my titles"
  SYNC_TO_SHEETS     — "sync/push/upload catalog to google/sheets"

REQUIRED SECRETS:
  TMDB_API_KEY, OMDB_API_KEY
  GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEET_ID
  CATALOG_PATH (optional — default: <cwd>/media_catalog.xlsx)

GOOGLE SHEETS SETUP:
  1. GCP Console → IAM → Service Accounts → Create → Download JSON key
  2. Share the Google Sheet with the service account email (Editor role)
  3. Paste email and private_key into character secrets
  4. Paste the spreadsheet ID (from URL) as GOOGLE_SHEET_ID`,
      }),
    },
  ],
  evaluators: [],
};

export default screenshotOCRPlugin;
