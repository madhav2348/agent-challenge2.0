
import { IAgentRuntime } from "@elizaos/core";
import { ScreenshotPluginConfig } from "./type";
import path from "path";

export function buildConfig(runtime: IAgentRuntime): ScreenshotPluginConfig {
  return {
    tmdbApiKey:                  (runtime.getSetting("TMDB_API_KEY") as string)                 || process.env.TMDB_API_KEY,
    omdbApiKey:                  (runtime.getSetting("OMDB_API_KEY") as string)                 || process.env.OMDB_API_KEY,
    catalogPath:                 (runtime.getSetting("CATALOG_PATH") as string)                 || process.env.CATALOG_PATH
                                 || path.join(process.cwd(), "media_catalog.xlsx"),
    googleServiceAccountEmail:   (runtime.getSetting("GOOGLE_SERVICE_ACCOUNT_EMAIL") as string) || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    googlePrivateKey:            (runtime.getSetting("GOOGLE_PRIVATE_KEY") as string)           || process.env.GOOGLE_PRIVATE_KEY,
    googleSheetId:               (runtime.getSetting("GOOGLE_SHEET_ID") as string)              || process.env.GOOGLE_SHEET_ID,
  };
}
