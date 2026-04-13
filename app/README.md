# Screenshot AI - Next.js Application

A unified Next.js application that combines the frontend UI and backend API for the Screenshot AI agent. This is a complete media analysis and cataloging platform built with React, Next.js, Tailwind CSS, and Lucide Icons.

## Features

- **Screenshot Upload**: Drag & drop interface for uploading media screenshots
- **Media Analysis**: Detects 15+ media types (movies, TV shows, anime, music, games, books, etc.)
- **Catalog Management**: Browse and filter all detected titles with pagination
- **Full-Text Search**: Search across titles, genres, directors, cast, and years
- **Statistics Dashboard**: View analytics on catalog composition and growth
- **Responsive Design**: Works seamlessly on desktop, tablet, and mobile devices
- **Dark Theme**: Modern glassmorphism UI with smooth animations

## Project Structure

```
app/
├── app/
│   ├── api/                    # Next.js API routes
│   │   ├── analyze/route.js   # Screenshot analysis endpoint
│   │   ├── catalog/route.js   # Catalog retrieval endpoint
│   │   ├── search/route.js    # Search endpoint
│   │   ├── stats/route.js     # Statistics endpoint
│   │   └── health/route.js    # Health check endpoint
│   ├── layout.jsx             # Root layout with metadata
│   ├── page.jsx               # Main page with tabs and navigation
│   └── globals.css            # Global styles and animations
├── components/
│   ├── ScreenshotUpload.jsx   # File upload component
│   ├── CatalogView.jsx        # Catalog browsing component
│   ├── SearchPanel.jsx        # Search interface component
│   ├── StatsPanel.jsx         # Statistics dashboard component
│   └── ResultsPanel.jsx       # Analysis results display component
├── package.json               # Dependencies and scripts
├── next.config.js             # Next.js configuration
├── tailwind.config.js         # Tailwind CSS configuration
├── postcss.config.js          # PostCSS configuration
└── .env.example               # Environment variables template
```

## Getting Started

### Prerequisites

- Node.js 18+ or Bun
- npm, yarn, or bun package manager

### Installation

1. Navigate to the app directory:
```bash
cd app
```

2. Install dependencies:
```bash
npm install
# or
yarn install
# or
bun install
```

3. Create environment file:
```bash
cp .env.example .env.local
```

4. Configure environment variables in `.env.local`:
```env
# Optional: Google Sheets integration
GOOGLE_SHEET_ID=your_sheet_id_here

# Optional: API keys for enhanced media detection
TMDB_API_KEY=your_tmdb_key
OMDB_API_KEY=your_omdb_key
```

### Development

Start the development server:
```bash
npm run dev
# or
yarn dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Production Build

Build for production:
```bash
npm run build
npm start
```

## API Endpoints

### POST /api/analyze
Analyzes a screenshot and detects media titles.

**Request:**
- Form data with `file` field containing image

**Response:**
```json
{
  "titles": [
    {
      "title": "The Boys",
      "type": "series",
      "year": "2019",
      "genres": ["Action", "Comedy"],
      "imdbRating": "8.7",
      "sceneDescription": "..."
    }
  ],
  "duplicates": 0,
  "newTitles": 2,
  "sheetUrl": "..."
}
```

### GET /api/catalog
Retrieves all cataloged titles.

**Response:**
```json
{
  "titles": [...],
  "total": 42
}
```

### GET /api/search?q=query
Searches the catalog by title, genre, director, cast, or year.

**Response:**
```json
{
  "results": [...]
}
```

### GET /api/stats
Retrieves catalog statistics.

**Response:**
```json
{
  "totalTitles": 42,
  "totalScans": 15,
  "fileSizeKb": "125.5",
  "byType": {
    "movie": 20,
    "series": 15,
    "anime": 7
  },
  "sheetUrl": "..."
}
```

### GET /api/health
Health check endpoint.

**Response:**
```json
{
  "status": "ok"
}
```

## Supported Media Types

- **Video**: Movies, TV Series, Anime, Animation, Documentaries
- **Audio**: Music, Albums, Artists, Podcasts, Episodes
- **Gaming**: Video Games
- **Literature**: Books, Manga, Comics, Webtoons

## Components

### ScreenshotUpload
Handles file selection and upload with drag-and-drop support.
- Drag & drop interface
- File preview
- Upload progress
- Error handling

### CatalogView
Displays all cataloged titles with filtering and pagination.
- Filter by media type
- Pagination (12 items per page)
- Media icons and metadata
- Genre badges
- Rating display

### SearchPanel
Full-text search across the catalog.
- Search by title, genre, director, cast, year
- Result display with metadata
- Overview text
- Rating information

### StatsPanel
Analytics dashboard showing catalog composition.
- Total titles and scans
- Catalog size
- Type breakdown with progress bars
- Google Sheets integration link
- Refresh button

### ResultsPanel
Displays analysis results from screenshot upload.
- Summary with new/duplicate counts
- Detailed title cards
- Scene descriptions
- Multiple rating sources
- Google Sheets link

## Styling

The application uses:
- **Tailwind CSS**: Utility-first CSS framework
- **Lucide Icons**: Beautiful SVG icons
- **Glassmorphism**: Modern frosted glass effect
- **Gradient Text**: Eye-catching typography
- **Smooth Animations**: Fade-in and spin effects

## Data Storage

By default, the application stores data in a local `catalog.json` file. For production use, consider:
- Connecting to a database (MongoDB, PostgreSQL, etc.)
- Integrating with Google Sheets API
- Using cloud storage (AWS S3, etc.)

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `GOOGLE_SHEET_ID` | Google Sheets ID for cloud sync | No |
| `TMDB_API_KEY` | The Movie Database API key | No |
| `OMDB_API_KEY` | Open Movie Database API key | No |

## Performance Optimization

- Server-side rendering with Next.js
- Image optimization
- CSS minification
- Code splitting
- Lazy loading of components

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers (iOS Safari, Chrome Mobile)

## Troubleshooting

### Port already in use
```bash
# Use a different port
npm run dev -- -p 3001
```

### Module not found errors
```bash
# Clear node_modules and reinstall
rm -rf node_modules
npm install
```

### Build errors
```bash
# Clear Next.js cache
rm -rf .next
npm run build
```

## Contributing

Contributions are welcome! Please ensure:
- Code follows the existing style
- Components are properly documented
- API endpoints are tested
- UI is responsive

## License

MIT License - See LICENSE file for details

## Support

For issues, questions, or suggestions, please refer to the main project documentation or create an issue in the repository.
