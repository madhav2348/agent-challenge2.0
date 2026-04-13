'use client'

import { useState } from 'react'
import { Upload, Search, BarChart3, Zap } from 'lucide-react'
import ScreenshotUpload from '@/components/ScreenshotUpload'
import CatalogView from '@/components/CatalogView'
import SearchPanel from '@/components/SearchPanel'
import StatsPanel from '@/components/StatsPanel'
import ResultsPanel from '@/components/ResultsPanel'

export default function Home() {
  const [activeTab, setActiveTab] = useState('upload')
  const [results, setResults] = useState(null)
  const [catalogStats, setCatalogStats] = useState(null)

  const handleUploadComplete = (data) => {
    setResults(data)
    setActiveTab('results')
  }

  const handleStatsUpdate = (stats) => {
    setCatalogStats(stats)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black">
      {/* Header */}
      <header className="border-b border-gray-700 glass sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold gradient-text">Screenshot AI</h1>
                <p className="text-sm text-gray-400">Powered by Nosana • Qwen3.5-27B</p>
              </div>
            </div>
            <div className="text-right">
              {catalogStats && (
                <div className="text-sm">
                  <p className="text-gray-400">Total Titles</p>
                  <p className="text-2xl font-bold text-indigo-400">{catalogStats.totalTitles}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="border-b border-gray-700 glass">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-8">
            <button
              onClick={() => setActiveTab('upload')}
              className={`py-4 px-2 border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === 'upload'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              <Upload className="w-4 h-4" />
              Upload
            </button>
            <button
              onClick={() => setActiveTab('catalog')}
              className={`py-4 px-2 border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === 'catalog'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              Catalog
            </button>
            <button
              onClick={() => setActiveTab('search')}
              className={`py-4 px-2 border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === 'search'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              <Search className="w-4 h-4" />
              Search
            </button>
            <button
              onClick={() => setActiveTab('stats')}
              className={`py-4 px-2 border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === 'stats'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              Stats
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {activeTab === 'upload' && (
          <ScreenshotUpload 
            onComplete={handleUploadComplete}
            onStatsUpdate={handleStatsUpdate}
          />
        )}
        {activeTab === 'catalog' && <CatalogView />}
        {activeTab === 'search' && <SearchPanel />}
        {activeTab === 'stats' && <StatsPanel stats={catalogStats} />}
        {activeTab === 'results' && results && <ResultsPanel results={results} />}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-700 glass mt-12">
        <div className="max-w-7xl mx-auto px-4 py-6 text-center text-gray-400 text-sm">
          <p>Screenshot AI Agent • Powered by Nosana Qwen3.5-27B LLM & Embeddings</p>
          <p className="text-xs text-gray-500 mt-2">Semantic search via Qwen3-Embedding-0.6B (1024 dimensions)</p>
        </div>
      </footer>
    </div>
  )
}
