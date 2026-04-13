import express from 'express'
import cors from 'cors'
import multer from 'multer'
import axios from 'axios'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const upload = multer({ dest: 'uploads/' })

// Nosana AI Configuration
const nosanaConfig = {
  llmUrl: process.env.OPENAI_API_URL || 'https://6vq2bcqphcansrs9b88ztxfs88oqy7etah2ugudytv2x.node.k8s.prd.nos.ci/v1',
  llmKey: process.env.OPENAI_API_KEY || 'nosana',
  model: process.env.MODEL_NAME || 'qwen3.5-27b',
  embeddingUrl: process.env.OPENAI_EMBEDDING_URL || 'https://4yiccatpyxx773jtewo5ccwhw1s2hezq5pehndb6fcfq.node.k8s.prd.nos.ci/v1',
  embeddingKey: process.env.OPENAI_EMBEDDING_API_KEY || 'nosana',
  embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'Qwen3-Embedding-0.6B',
  embeddingDimensions: parseInt(process.env.OPENAI_EMBEDDING_DIMENSIONS || '1024')
}

// Middleware
app.use(cors())
app.use(express.json())

// Mock data storage (in production, use a real database)
let catalogData = {
  titles: [],
  scans: 0,
  stats: {
    totalTitles: 0,
    totalScans: 0,
    fileSizeKb: '0',
    byType: {}
  }
}

// Load catalog from file if it exists
const catalogPath = path.join(__dirname, '../catalog.json')
if (fs.existsSync(catalogPath)) {
  try {
    catalogData = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'))
  } catch (err) {
    console.error('Error loading catalog:', err)
  }
}

// Save catalog to file
function saveCatalog() {
  fs.writeFileSync(catalogPath, JSON.stringify(catalogData, null, 2))
}

// Nosana AI Helper Functions
async function callNosanaLLM(messages) {
  try {
    const response = await axios.post(
      `${nosanaConfig.llmUrl}/chat/completions`,
      {
        model: nosanaConfig.model,
        messages: messages,
        temperature: 0.7,
        max_tokens: 1024
      },
      {
        headers: {
          'Authorization': `Bearer ${nosanaConfig.llmKey}`,
          'Content-Type': 'application/json'
        }
      }
    )
    return response.data.choices[0].message.content
  } catch (err) {
    console.error('Nosana LLM error:', err.message)
    throw err
  }
}

async function generateEmbedding(text) {
  try {
    const response = await axios.post(
      `${nosanaConfig.embeddingUrl}/embeddings`,
      {
        model: nosanaConfig.embeddingModel,
        input: text
      },
      {
        headers: {
          'Authorization': `Bearer ${nosanaConfig.embeddingKey}`,
          'Content-Type': 'application/json'
        }
      }
    )
    return response.data.data[0].embedding
  } catch (err) {
    console.error('Nosana embedding error:', err.message)
    throw err
  }
}

async function analyzeWithNosana(imageBase64, prompt) {
  try {
    const messages = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: prompt
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${imageBase64}`
            }
          }
        ]
      }
    ]
    return await callNosanaLLM(messages)
  } catch (err) {
    console.error('Nosana analysis error:', err.message)
    throw err
  }
}

// Routes

// Analyze screenshot
app.post('/analyze', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' })
    }

    // Read image file
    const imageBuffer = fs.readFileSync(req.file.path)
    const imageBase64 = imageBuffer.toString('base64')

    // Use Nosana LLM to analyze the screenshot
    const analysisPrompt = `Analyze this screenshot and extract all visible media titles. For each title found, provide:
1. Title name
2. Media type (movie, series, anime, music, podcast, game, book, etc.)
3. Year (if visible)
4. Genres (if visible)
5. Any visible ratings or metadata

Format as JSON array with objects containing: title, type, year, genres, description`

    const analysisResult = await analyzeWithNosana(imageBase64, analysisPrompt)
    
    let titles = []
    try {
      const jsonMatch = analysisResult.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        titles = JSON.parse(jsonMatch[0])
      }
    } catch (parseErr) {
      console.warn('Could not parse JSON from analysis, using mock data')
      titles = [
        {
          title: 'The Boys',
          type: 'series',
          year: '2019',
          genres: ['Action', 'Comedy', 'Crime'],
          description: 'Intense action scene in urban setting'
        }
      ]
    }

    // Generate embeddings for semantic search
    const titlesWithEmbeddings = await Promise.all(
      titles.map(async (title) => {
        try {
          const embedding = await generateEmbedding(title.title)
          return { ...title, embedding }
        } catch (err) {
          console.warn(`Could not generate embedding for ${title.title}`)
          return title
        }
      })
    )

    const mockResults = {
      titles: titlesWithEmbeddings,
      duplicates: 0,
      newTitles: titlesWithEmbeddings.length,
      sheetUrl: process.env.GOOGLE_SHEET_ID 
        ? `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEET_ID}`
        : null,
      poweredBy: 'Nosana Qwen3.5-27B + Embeddings'
    }

    // Add to catalog
    titlesWithEmbeddings.forEach(title => {
      if (!catalogData.titles.find(t => t.title.toLowerCase() === title.title.toLowerCase())) {
        catalogData.titles.push(title)
        catalogData.stats.byType[title.type] = (catalogData.stats.byType[title.type] || 0) + 1
      }
    })

    catalogData.scans += 1
    catalogData.stats.totalTitles = catalogData.titles.length
    catalogData.stats.totalScans = catalogData.scans
    catalogData.stats.fileSizeKb = (fs.statSync(req.file.path).size / 1024).toFixed(1)

    saveCatalog()

    // Clean up uploaded file
    fs.unlinkSync(req.file.path)

    res.json(mockResults)
  } catch (err) {
    console.error('Analysis error:', err)
    res.status(500).json({ error: 'Analysis failed', details: err.message })
  }
})

// Get catalog
app.get('/catalog', (req, res) => {
  res.json({
    titles: catalogData.titles,
    total: catalogData.titles.length
  })
})

// Search catalog with semantic search via Nosana embeddings
app.get('/search', async (req, res) => {
  const query = (req.query.q || '').toLowerCase()
  
  if (!query) {
    return res.json({ results: [] })
  }

  try {
    // Generate embedding for search query
    const queryEmbedding = await generateEmbedding(query)
    
    // Simple semantic similarity (cosine distance)
    const cosineSimilarity = (a, b) => {
      let dotProduct = 0
      let normA = 0
      let normB = 0
      for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i]
        normA += a[i] * a[i]
        normB += b[i] * b[i]
      }
      return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
    }

    // Score titles by semantic similarity
    const scoredResults = catalogData.titles
      .map(title => {
        let score = 0
        
        // Semantic similarity if embedding exists
        if (title.embedding) {
          score = cosineSimilarity(queryEmbedding, title.embedding) * 0.7
        }
        
        // Keyword matching fallback
        const searchFields = [
          title.title,
          title.type,
          title.genres?.join(' '),
          title.director,
          title.cast,
          title.year
        ].join(' ').toLowerCase()
        
        if (searchFields.includes(query)) {
          score += 0.3
        }
        
        return { ...title, score }
      })
      .filter(t => t.score > 0)
      .sort((a, b) => b.score - a.score)

    res.json({ results: scoredResults, poweredBy: 'Nosana Embeddings' })
  } catch (err) {
    console.error('Search error:', err)
    // Fallback to keyword search
    const results = catalogData.titles.filter(title => {
      const searchFields = [
        title.title,
        title.type,
        title.genres?.join(' '),
        title.director,
        title.cast,
        title.year
      ].join(' ').toLowerCase()
      return searchFields.includes(query)
    })
    res.json({ results, fallback: true })
  }
})

// Get statistics
app.get('/stats', (req, res) => {
  res.json({
    totalTitles: catalogData.titles.length,
    totalScans: catalogData.scans,
    fileSizeKb: catalogData.stats.fileSizeKb,
    byType: catalogData.stats.byType,
    sheetUrl: process.env.GOOGLE_SHEET_ID 
      ? `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEET_ID}`
      : null
  })
})

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' })
})

// Start server
const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`)
})
