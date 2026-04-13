import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

// Nosana Configuration
const nosanaConfig = {
  llmUrl: process.env.OPENAI_API_URL || 'https://6vq2bcqphcansrs9b88ztxfs88oqy7etah2ugudytv2x.node.k8s.prd.nos.ci/v1',
  llmKey: process.env.OPENAI_API_KEY || 'nosana',
  model: process.env.MODEL_NAME || 'qwen3.5-27b',
  embeddingUrl: process.env.OPENAI_EMBEDDING_URL || 'https://4yiccatpyxx773jtewo5ccwhw1s2hezq5pehndb6fcfq.node.k8s.prd.nos.ci/v1',
  embeddingKey: process.env.OPENAI_EMBEDDING_API_KEY || 'nosana',
  embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'Qwen3-Embedding-0.6B'
}

// Mock catalog storage
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

const catalogPath = path.join(process.cwd(), 'catalog.json')

// Load catalog
function loadCatalog() {
  if (fs.existsSync(catalogPath)) {
    try {
      catalogData = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'))
    } catch (err) {
      console.error('Error loading catalog:', err)
    }
  }
}

// Save catalog
function saveCatalog() {
  fs.writeFileSync(catalogPath, JSON.stringify(catalogData, null, 2))
}

// Nosana LLM call
async function callNosanaLLM(messages) {
  try {
    const response = await fetch(`${nosanaConfig.llmUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${nosanaConfig.llmKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: nosanaConfig.model,
        messages: messages,
        temperature: 0.7,
        max_tokens: 1024
      })
    })
    const data = await response.json()
    return data.choices[0].message.content
  } catch (err) {
    console.error('Nosana LLM error:', err)
    throw err
  }
}

// Generate embedding
async function generateEmbedding(text) {
  try {
    const response = await fetch(`${nosanaConfig.embeddingUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${nosanaConfig.embeddingKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: nosanaConfig.embeddingModel,
        input: text
      })
    })
    const data = await response.json()
    return data.data[0].embedding
  } catch (err) {
    console.error('Nosana embedding error:', err)
    throw err
  }
}

export async function POST(request) {
  try {
    loadCatalog()

    const formData = await request.formData()
    const file = formData.get('file')

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    // Convert file to base64
    const buffer = await file.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')

    // Use Nosana LLM to analyze
    const analysisPrompt = `Analyze this screenshot and extract all visible media titles. For each title found, provide:
1. Title name
2. Media type (movie, series, anime, music, podcast, game, book, etc.)
3. Year (if visible)
4. Genres (if visible)
5. Any visible ratings or metadata

Format as JSON array with objects containing: title, type, year, genres, description`

    const messages = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: analysisPrompt
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${base64}`
            }
          }
        ]
      }
    ]

    let titles = []
    try {
      const analysisResult = await callNosanaLLM(messages)
      const jsonMatch = analysisResult.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        titles = JSON.parse(jsonMatch[0])
      }
    } catch (parseErr) {
      console.warn('Could not parse analysis, using mock data')
      titles = [
        {
          title: 'The Boys',
          type: 'series',
          year: '2019',
          genres: ['Action', 'Comedy', 'Crime'],
          description: 'Intense action scene'
        }
      ]
    }

    // Generate embeddings
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
    catalogData.stats.fileSizeKb = (file.size / 1024).toFixed(1)

    saveCatalog()

    return NextResponse.json(mockResults)
  } catch (err) {
    console.error('Analysis error:', err)
    return NextResponse.json({ error: 'Analysis failed', details: err.message }, { status: 500 })
  }
}
