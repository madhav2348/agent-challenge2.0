import React from 'react'
import { CheckCircle, AlertCircle } from 'lucide-react'

const MEDIA_ICONS = {
  movie: '🎬', series: '📺', anime: '⛩️', animation: '🎨', documentary: '🎥',
  music: '🎵', album: '💿', artist: '🎤', podcast: '🎙️', episode: '📻',
  game: '🎮', book: '📖', manga: '📚', comic: '💭', webtoon: '📱',
}

export default function ResultsPanel({ results }) {
  const { titles = [], duplicates = 0, newTitles = 0, sheetUrl = null } = results

  return (
    <div className="fade-in max-w-4xl mx-auto">
      {/* Summary */}
      <div className="glass rounded-lg p-6 mb-8">
        <div className="flex items-start gap-4">
          <CheckCircle className="w-8 h-8 text-green-400 flex-shrink-0 mt-1" />
          <div>
            <h2 className="text-2xl font-bold mb-2">Analysis Complete!</h2>
            <p className="text-gray-300 mb-4">
              Found <span className="font-semibold text-indigo-400">{titles.length}</span> title{titles.length !== 1 ? 's' : ''}
              {newTitles > 0 && (
                <> · <span className="text-green-400">{newTitles} new</span></>
              )}
              {duplicates > 0 && (
                <> · <span className="text-yellow-400">{duplicates} already cataloged</span></>
              )}
            </p>
            {sheetUrl && (
              <a
                href={sheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-400 hover:text-indigo-300 transition-colors inline-flex items-center gap-2"
              >
                View in Google Sheets →
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Results Grid */}
      {titles.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {titles.map((title, idx) => (
            <div key={idx} className="glass rounded-lg p-4 hover:bg-white/10 transition-all">
              <div className="flex items-start gap-3 mb-3">
                <span className="text-3xl">{MEDIA_ICONS[title.type] || '🎞️'}</span>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-white truncate">{title.title}</h3>
                  <p className="text-xs text-gray-400 capitalize">{title.type}</p>
                </div>
              </div>

              {title.year && (
                <p className="text-sm text-gray-400 mb-2">{title.year}</p>
              )}

              {title.genres && title.genres.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {title.genres.slice(0, 3).map((genre, i) => (
                    <span key={i} className="text-xs bg-indigo-500/20 text-indigo-300 px-2 py-1 rounded">
                      {genre}
                    </span>
                  ))}
                </div>
              )}

              <div className="space-y-2 text-sm">
                {title.imdbRating && (
                  <div className="flex items-center gap-2">
                    <span className="text-yellow-400">★</span>
                    <span className="text-gray-300">IMDB {title.imdbRating}</span>
                  </div>
                )}
                {title.tmdbScore && (
                  <div className="flex items-center gap-2">
                    <span className="text-purple-400">★</span>
                    <span className="text-gray-300">TMDB {title.tmdbScore}</span>
                  </div>
                )}
                {title.director && (
                  <p className="text-gray-400">Dir: {title.director}</p>
                )}
                {title.cast && (
                  <p className="text-gray-400 truncate">Cast: {title.cast}</p>
                )}
              </div>

              {title.sceneDescription && (
                <div className="mt-3 pt-3 border-t border-gray-700">
                  <p className="text-xs text-gray-500 mb-1">Scene:</p>
                  <p className="text-sm text-gray-400 italic">{title.sceneDescription}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="glass rounded-lg p-12 text-center text-gray-400">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No titles detected in this screenshot</p>
        </div>
      )}
    </div>
  )
}
