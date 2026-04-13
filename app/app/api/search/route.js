import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const catalogPath = path.join(process.cwd(), 'catalog.json')

// Nosana Embedding Configuration
const nosanaConfig = {
  embeddingUrl: process.env.OPENAI_EMBEDDING_URL || 'https://4yiccatpyxx773jtewo5ccwhw1s2hezq5pehndb6fcfq.node.k8s.prd.nos.ci/v1',
  embeddingKey: process.env.OPENAI_EMBEDDING_API_KEY || 'nosana',
  embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'Qwen3-Embedding-0.6B'
}

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
    return null
  }
}

function cosineSimilarity(a, b) {
  if (!a || !b) return 0
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

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const query = (searchParams.get('q') || '').toLowerCase()

    if (!query) {
      return NextResponse.json({ results: [] })
    }

    let catalogData = { titles: [] }
    if (fs.existsSync(catalogPath)) {
      catalogData = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'))
    }

    // Try semantic search with embeddings
    try {
      const queryEmbedding = await generateEmbedding(query)
      
      if (queryEmbedding) {
        const scoredResults = (catalogData.titles || [])
          .map(title => {
            let score = 0
            
            // Semantic similarity
            if (title.embedding) {
              score = cosineSimilarity(queryEmbedding, title.embedding) * 0.7
            }
            
            // Keyword matching
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

        return NextResponse.json({ results: scoredResults, poweredBy: 'Nosana Embeddings' })
      }
    } catch (err) {
      console.warn('Semantic search failed, falling back to keyword search')
    }

    // Fallback to keyword search
    const results = (catalogData.titles || []).filter(title => {
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

    return NextResponse.json({ results, fallback: true })
  } catch (err) {
    console.error('Search error:', err)
    return NextResponse.json({ results: [] })
  }
}
