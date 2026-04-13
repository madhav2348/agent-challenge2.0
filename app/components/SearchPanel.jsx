'use client'

import { useState } from 'react'
import { Search, Loader } from 'lucide-react'
import axios from 'axios'

const MEDIA_ICONS = {
  movie: '🎬', series: '📺', anime: '⛩️', animation: '🎨', documentary: '🎥',
  music: '🎵', album: '💿', artist: '🎤', podcast: '🎙️', episode: '📻',
  game: '🎮', book: '📖', manga: '📚', comic: '💭', webtoon: '📱',
}

export default function SearchPanel() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  const handleSearch = async (e) => {
    e.preventDefault()
    if (!query.trim()) return

    setLoading(true)
    setSearched(true)

    try {
      const response = await axios.get('/api/search', {
        params: { q: query }
      })
      setResults(response.data.results || [])
    } catch (err) {
      console.error('Search failed:', err)
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fade-in max-w-2xl mx-auto">
      {/* Search Form */}
      <form onSubmit={handleSearch} className="mb-8">
        <div className="glass rounded-lg p-6">
          <div className="mb-4 p-3 bg-indigo-500/10 border border-indigo-500/30 rounded-lg">
            <p className="text-xs text-indigo-300">🚀 Powered by Nosana Qwen3-Embedding-0.6B (1024 dimensions)</p>
            <p className="text-xs text-gray-400 mt-1">Semantic search with AI-powered embeddings</p>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title, genre, director, cast, year..."
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
            <button
              type="submit"
              disabled={loading}
              className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 disabled:from-gray-600 disabled:to-gray-600 text-white font-semibold px-6 py-3 rounded-lg transition-all flex items-center gap-2"
            >
              {loading ? (
                <Loader className="w-5 h-5 animate-spin" />
              ) : (
                <Search className="w-5 h-5" />
              )}
              Search
            </button>
          </div>
        </div>
      </form>

      {/* Results */}
      {searched && (
        <div className="fade-in">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader className="w-8 h-8 text-indigo-400 animate-spin" />
            </div>
          ) : results.length > 0 ? (
            <div className="space-y-4">
              <p className="text-gray-400 mb-4">
                Found {results.length} result{results.length !== 1 ? 's' : ''}
              </p>
              {results.map((item, idx) => (
                <div key={idx} className="glass rounded-lg p-4 hover:bg-white/10 transition-all">
                  <div className="flex items-start gap-4">
                    <span className="text-3xl">{MEDIA_ICONS[item.type] || '🎞️'}</span>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-lg text-white mb-1">{item.title}</h3>
                      <p className="text-sm text-gray-400 capitalize mb-2">{item.type}</p>

                      {item.year && (
                        <p className="text-sm text-gray-400 mb-2">Year: {item.year}</p>
                      )}

                      {item.genres && item.genres.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-3">
                          {item.genres.map((genre, i) => (
                            <span key={i} className="text-xs bg-indigo-500/20 text-indigo-300 px-2 py-1 rounded">
                              {genre}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-4 text-sm text-gray-400">
                        {item.director && <span>Dir: {item.director}</span>}
                        {item.cast && <span>Cast: {item.cast}</span>}
                        {item.imdbRating && (
                          <span className="flex items-center gap-1">
                            <span className="text-yellow-400">★</span>
                            IMDB {item.imdbRating}
                          </span>
                        )}
                      </div>

                      {item.overview && (
                        <p className="text-sm text-gray-400 mt-3 line-clamp-2">
                          {item.overview}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="glass rounded-lg p-12 text-center text-gray-400">
              <Search className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No results found for "{query}"</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
