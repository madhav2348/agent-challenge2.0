'use client'

import { useState, useEffect } from 'react'
import { Loader, Zap } from 'lucide-react'
import axios from 'axios'

const MEDIA_ICONS = {
  movie: '🎬',
  series: '📺',
  anime: '⛩️',
  animation: '🎨',
  documentary: '🎥',
  music: '🎵',
  album: '💿',
  artist: '🎤',
  podcast: '🎙️',
  episode: '📻',
  game: '🎮',
  book: '📖',
  manga: '📚',
  comic: '💭',
  webtoon: '📱',
}

export default function CatalogView() {
  const [catalog, setCatalog] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(1)
  const itemsPerPage = 12

  useEffect(() => {
    fetchCatalog()
  }, [])

  const fetchCatalog = async () => {
    try {
      setLoading(true)
      const response = await axios.get('/api/catalog')
      setCatalog(response.data.titles || [])
      setError(null)
    } catch (err) {
      setError('Failed to load catalog')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const filteredCatalog = filter === 'all' 
    ? catalog 
    : catalog.filter(item => item.type === filter)

  const paginatedCatalog = filteredCatalog.slice(
    (page - 1) * itemsPerPage,
    page * itemsPerPage
  )

  const totalPages = Math.ceil(filteredCatalog.length / itemsPerPage)

  const types = ['all', ...new Set(catalog.map(item => item.type))]

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader className="w-8 h-8 text-indigo-400 animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="glass rounded-lg p-6 text-center text-red-400">
        {error}
      </div>
    )
  }

  return (
    <div className="fade-in">
      {/* Filter Buttons */}
      <div className="mb-8 flex flex-wrap gap-2">
        {types.map(type => (
          <button
            key={type}
            onClick={() => {
              setFilter(type)
              setPage(1)
            }}
            className={`px-4 py-2 rounded-lg transition-all ${
              filter === type
                ? 'bg-indigo-600 text-white'
                : 'glass text-gray-300 hover:text-white'
            }`}
          >
            {type === 'all' ? 'All' : `${MEDIA_ICONS[type]} ${type}`}
          </button>
        ))}
      </div>

      {/* Catalog Grid */}
      {paginatedCatalog.length > 0 ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            {paginatedCatalog.map((item, idx) => (
              <div key={idx} className="glass rounded-lg p-4 hover:bg-white/10 transition-all">
                <div className="flex items-start gap-3 mb-3">
                  <span className="text-2xl">{MEDIA_ICONS[item.type] || '🎞️'}</span>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-white truncate">{item.title}</h3>
                    <p className="text-xs text-gray-400 capitalize">{item.type}</p>
                  </div>
                </div>

                {item.year && (
                  <p className="text-sm text-gray-400 mb-2">{item.year}</p>
                )}

                {item.genres && item.genres.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {item.genres.slice(0, 2).map((genre, i) => (
                      <span key={i} className="text-xs bg-indigo-500/20 text-indigo-300 px-2 py-1 rounded">
                        {genre}
                      </span>
                    ))}
                  </div>
                )}

                {item.imdbRating && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-yellow-400">★</span>
                    <span className="text-gray-300">{item.imdbRating}</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-4 py-2 glass rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/10"
              >
                Previous
              </button>
              <span className="text-gray-400">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-4 py-2 glass rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/10"
              >
                Next
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="glass rounded-lg p-12 text-center text-gray-400">
          <Zap className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No titles in catalog yet. Upload a screenshot to get started!</p>
        </div>
      )}

      <div className="mt-8 glass rounded-lg p-4 text-center text-sm text-gray-400">
        Total: {filteredCatalog.length} title{filteredCatalog.length !== 1 ? 's' : ''}
      </div>
    </div>
  )
}
