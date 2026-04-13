export type MediaType  = "movie" | "series" | "animation" | "anime" | "documentary" | "music" | "album" | "artist" | "podcast" | "episode" | "game" | "book" | "manga" | "comic" | "webtoon" | "unknown";
export type Confidence = "high" | "medium" | "low";
export type Genre = "action" | "adventure" | "comedy" | "drama" | "horror" | "romance" | "sci-fi" | "thriller" | "fantasy" | "mystery" | "pop" | "rock" | "hip-hop" | "jazz" | "classical" | "electronic" | "indie" | "rpg" | "fps" | "strategy" | "puzzle" | "sports" | "other";

export interface MediaTitle {
  title: string;
  type: MediaType;
  confidence: Confidence;
  year?: string;
  additionalInfo?: string;
}

export interface MediaSearchResult {
  title: string;
  originalTitle?: string;
  type: string;
  subGenre?: string;
  additionalInfo?: string;
  year?: string;
  releaseDate?: string;
  endYear?: string;
  country?: string;
  language?: string;
  ageRating?: string;
  imdbRating?: string;
  imdbVotes?: string;
  tmdbScore?: string;
  rottenTomatoes?: string;
  metascore?: string;
  status?: string;
  seasons?: number;
  episodes?: number;
  avgEpMins?: number;
  studio?: string;
  director?: string;
  cast?: string;
  genres?: string[];
  tagline?: string;
  overview?: string;
  posterUrl?: string;
  source: "TMDB" | "OMDB" | "TMDB+OMDB" | "AI_ENRICHED";
}

export interface SceneContext {
  description: string;
  timestamp?: string;
  characters?: string[];
  setting?: string;
  mood?: string;
}

export interface OCRResult {
  rawText: string;
  mediaTitles: MediaTitle[];
  searchResults: MediaSearchResult[];
  sceneContext?: SceneContext;
}

export interface ScreenshotPluginConfig {
  tmdbApiKey?: string;
  omdbApiKey?: string;
  catalogPath?: string;
  googleServiceAccountEmail?: string;
  googlePrivateKey?: string;
  googleSheetId?: string;
}

export interface CatalogStats {
  totalTitles: number;
  totalScans: number;
  fileSizeKb: string;
  byType: Record<string, number>;
  sheetUrl?: string;
}
