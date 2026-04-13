# Architecture Overview

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Screenshot AI Agent                         │
│                    (Eliza OS + Claude)                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │                   │
            ┌───────▼────────┐  ┌──────▼────────┐
            │  User Input    │  │  File Upload  │
            │  (text/image)  │  │  (screenshot) │
            └───────┬────────┘  └──────┬────────┘
                    │                   │
                    └─────────┬─────────┘
                              │
                    ┌─────────▼─────────┐
                    │   ANALYZE_SCREENSHOT
                    │   (Main Action)
                    └─────────┬─────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
    ┌────────┐          ┌──────────┐          ┌──────────┐
    │  OCR   │          │  Title   │          │  Scene   │
    │ (Text  │          │Detection │          │ Context  │
    │Extract)│          │ (Claude) │          │(Claude)  │
    └────┬───┘          └────┬─────┘          └────┬─────┘
         │                   │                     │
         └───────────────────┼─────────────────────┘
                             │
                    ┌────────▼────────┐
                    │  Enrichment     │
                    │  (TMDB + OMDB)  │
                    │  (parallel)     │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │ Deduplication   │
                    │ (Check XLSX)    │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
    ┌────────┐          ┌──────────┐        ┌──────────┐
    │ XLSX   │          │ Google   │        │ Response │
    │ Write  │          │ Sheets   │        │ to User  │
    │(local) │          │ Sync     │        │          │
    └────────┘          │(cloud)   │        └──────────┘
                        │(parallel)│
                        └──────────┘
```

---

## Data Flow Pipeline

### Step 1: Input
```
Screenshot (PNG/JPG/WebP) or File Path
    ↓
Validate file exists
    ↓
Convert to Base64
```

### Step 2: OCR & Extraction
```
Claude Vision API
    ├─ Extract all visible text
    ├─ Detect media titles
    └─ Capture scene context
         ├─ Description (what's happening)
         ├─ Setting (location)
         ├─ Mood (tone)
         └─ Characters (visible people)
```

### Step 3: Enrichment
```
TMDB API (parallel)          OMDB API (parallel)
├─ Search title              ├─ Search title
├─ Get cast                  ├─ Get IMDB rating
├─ Get genres               ├─ Get Rotten Tomatoes
├─ Get TMDB score           ├─ Get Metascore
├─ Get poster               ├─ Get director
├─ Get seasons/episodes     └─ Get age rating
└─ Get tagline

    ↓ Merge Results ↓
Complete Metadata Object
```

### Step 4: Deduplication
```
Read XLSX (Media Catalog sheet)
    ↓
Build Set of existing titles (case-insensitive)
    ↓
Filter new titles against set
    ↓
Count: new vs skipped
```

### Step 5: Storage (Parallel)
```
XLSX Write                   Google Sheets Sync
├─ Append to Media Catalog  ├─ Authenticate (JWT)
├─ Append to Scan Log       ├─ Ensure tabs exist
└─ Update Stats formulas    ├─ Append rows
                            └─ Format headers
```

### Step 6: Response
```
Format results with:
├─ Emoji markers (🎬 🎨 ⛩️ 📺 🎥)
├─ Ratings (IMDB · TMDB · RT · Metascore)
├─ Cast & Director
├─ Genres
├─ Scene description
└─ Storage destinations
```

---

## Component Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Plugin Layer                          │
│  (screenshotOCRPlugin)                                   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │           Action Handlers                       │   │
│  ├─────────────────────────────────────────────────┤   │
│  │ • ANALYZE_SCREENSHOT                           │   │
│  │ • CATALOG_STATUS                               │   │
│  │ • SEARCH_CATALOG                               │   │
│  │ • SYNC_TO_SHEETS                               │   │
│  └─────────────────────────────────────────────────┘   │
│                                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │        Core Functions                           │   │
│  ├─────────────────────────────────────────────────┤   │
│  │ • performOCRAndExtract()                        │   │
│  │ • enrichMediaTitles()                           │   │
│  │ • getExistingTitles()                           │   │
│  │ • appendToXLSX()                                │   │
│  │ • syncToGoogleSheets()                          │   │
│  │ • readCatalogStats()                            │   │
│  │ • formatMediaResults()                          │   │
│  └─────────────────────────────────────────────────┘   │
│                                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │        Utility Functions                        │   │
│  ├─────────────────────────────────────────────────┤   │
│  │ • searchTMDB()                                  │   │
│  │ • searchOMDB()                                  │   │
│  │ • mergeResults()                                │   │
│  │ • buildCatalogRow()                             │   │
│  │ • buildScanRow()                                │   │
│  │ • getGoogleAccessToken()                        │   │
│  │ • sheetsRequest()                               │   │
│  └─────────────────────────────────────────────────┘   │
│                                                          │
└──────────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
        ▼                 ▼                 ▼
    ┌────────┐        ┌────────┐       ┌────────┐
    │ Eliza  │        │ Claude │       │ XLSX   │
    │ Core   │        │ Vision │       │ File   │
    └────────┘        └────────┘       └────────┘
        │                 │                 │
        ▼                 ▼                 ▼
    ┌────────┐        ┌────────┐       ┌────────┐
    │ Memory │        │ TMDB   │       │Google  │
    │ State  │        │ OMDB   │       │Sheets  │
    └────────┘        └────────┘       └────────┘
```

---

## Data Model

### MediaTitle
```typescript
{
  title: string              // "The Boys"
  type: MediaType            // "series"
  confidence: Confidence     // "high"
  year?: string              // "2019"
  additionalInfo?: string    // "Action"
}
```

### MediaSearchResult
```typescript
{
  title: string              // "The Boys"
  originalTitle?: string     // "The Boys"
  type: string               // "series"
  subGenre?: string          // "Action"
  year?: string              // "2019"
  releaseDate?: string       // "2019-07-26"
  endYear?: string           // undefined
  country?: string           // "USA"
  language?: string          // "English"
  ageRating?: string         // "TV-MA"
  imdbRating?: string        // "8.7"
  imdbVotes?: string         // "450K"
  tmdbScore?: string         // "8.5"
  rottenTomatoes?: string    // "96%"
  metascore?: string         // "76"
  status?: string            // "Returning"
  seasons?: number           // 4
  episodes?: number          // 50
  avgEpMins?: number         // 60
  studio?: string            // "Amazon Prime"
  director?: string          // "Eric Kripke"
  cast?: string              // "Karl Urban, Antony Starr"
  genres?: string[]          // ["Action", "Comedy", "Crime"]
  tagline?: string           // "Corrupt superheroes"
  overview?: string          // "A group of vigilantes..."
  posterUrl?: string         // "https://..."
  source: string             // "TMDB+OMDB"
}
```

### SceneContext
```typescript
{
  description: string        // "Intense action scene in city"
  timestamp?: string         // "00:45:30"
  characters?: string[]      // ["Homelander", "Starlight"]
  setting?: string           // "City street"
  mood?: string              // "Action-packed"
}
```

### OCRResult
```typescript
{
  rawText: string            // All extracted text
  mediaTitles: MediaTitle[]  // Detected titles
  searchResults: MediaSearchResult[]  // Enriched results
  sceneContext?: SceneContext // Scene info
}
```

---

## Storage Schema

### XLSX Structure

**Media Catalog Sheet** (32 columns)
```
ID | Title | Original Title | Type | Sub-Genre | Release Year | ... | Scene Description | ... | Data Source
1  | The Boys | The Boys | Series | Action | 2019 | ... | Intense action scene | ... | TMDB+OMDB
```

**Scan Log Sheet** (8 columns)
```
Scan # | Screenshot File | Date Scanned | Titles Found | New Titles Added | Duplicates Skipped | Raw OCR Snippet | Status
1      | netflix.png     | 2024-04-13   | 3            | 2                | 1                  | "The Boys..." | Complete
```

**Stats Sheet** (2 columns, auto-calculated)
```
Metric              | Value
Total Titles        | 143
Total Scans         | 38
Movies              | 64
Series              | 47
Anime               | 21
Animation           | 8
Documentaries       | 3
High Confidence     | 128
Avg IMDB            | 7.8
```

---

## API Integration

### TMDB
```
GET /3/search/multi?query={title}&api_key={key}
    ↓
GET /3/movie/{id}?append_to_response=credits
    ↓
Returns: cast, genres, tagline, TMDB score, poster, etc.
```

### OMDB
```
GET /?t={title}&apikey={key}
    ↓
Returns: IMDB rating, Rotten Tomatoes, Metascore, director, etc.
```

### Google Sheets
```
POST /oauth2/token (JWT exchange)
    ↓
GET /v4/spreadsheets/{id} (get sheet info)
    ↓
POST /v4/spreadsheets/{id}:batchUpdate (create tabs)
    ↓
POST /v4/spreadsheets/{id}/values:append (add rows)
```

---

## Error Handling

```
Try OCR
  ├─ Success → Continue
  └─ Fail → Return empty results

Try Title Detection
  ├─ Success → Continue
  └─ Fail → Return empty titles

Try Scene Extraction
  ├─ Success → Include in results
  └─ Fail → Skip (graceful degradation)

Try TMDB
  ├─ Success → Use results
  └─ Fail → Try OMDB

Try OMDB
  ├─ Success → Use results
  └─ Fail → Use AI-enriched fallback

Try XLSX Write
  ├─ Success → Continue
  └─ Fail → Log warning, continue

Try Google Sheets Sync
  ├─ Success → Report URL
  └─ Fail → Log error, continue with XLSX only
```

---

## Performance Optimization

### Parallel Operations
- TMDB + OMDB enrichment (simultaneous)
- XLSX write + Google Sheets sync (simultaneous)

### Caching
- Existing titles cached in memory (Set)
- No redundant API calls for duplicates

### Lazy Loading
- Google Sheets auth only when needed
- XLSX only loaded when required

### Efficient Deduplication
- Case-insensitive Set lookup: O(1)
- No full table scans

---

## Security Considerations

✅ No credentials in code  
✅ Environment variables for secrets  
✅ JWT for Google Sheets (no browser OAuth)  
✅ HTTPS for all API calls  
✅ No data sent to third parties (except TMDB/OMDB/Google)  
✅ Local file storage (XLSX)  
✅ Service account isolation (Google Sheets)  

---

## Scalability

- **Titles per scan**: Unlimited (tested with 50+)
- **Catalog size**: Limited by XLSX (1M+ rows possible)
- **Concurrent scans**: Sequential (one at a time)
- **Storage**: Local XLSX + cloud Google Sheets
- **API rate limits**: Handled gracefully with fallbacks

---

## Deployment Topology

```
┌─────────────────────────────────────────┐
│         User / Chat Interface           │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│      Eliza OS Runtime                   │
│  (Node.js + TypeScript)                 │
└────────────────┬────────────────────────┘
                 │
    ┌────────────┼────────────┐
    │            │            │
    ▼            ▼            ▼
┌────────┐  ┌────────┐  ┌──────────┐
│ Claude │  │ TMDB   │  │ Google   │
│ Vision │  │ OMDB   │  │ Sheets   │
└────────┘  └────────┘  └──────────┘
    │            │            │
    └────────────┼────────────┘
                 │
         ┌───────▼────────┐
         │  Local XLSX    │
         │  (media_catalog)
         └────────────────┘
```

---

## Summary

The architecture is:
- **Modular**: Separate concerns (OCR, enrichment, storage)
- **Parallel**: Simultaneous API calls and writes
- **Resilient**: Graceful degradation on failures
- **Efficient**: Caching and lazy loading
- **Secure**: No credentials in code
- **Scalable**: Handles large catalogs
- **Maintainable**: Clear function separation
