'use client'

import { useState, useEffect } from 'react'
import { Loader, BarChart3 } from 'lucide-react'
import axios from 'axios'

export default function StatsPanel() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchStats()
  }, [])

  const fetchStats = async () => {
    try {
      setLoading(true)
      const response = await axios.get('/api/stats')
      setStats(response.data)
      setError(null)
    } catch (err) {
      setError('Failed to load statistics')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

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

  if (!stats) {
    return (
      <div className="glass rounded-lg p-6 text-center text-gray-400">
        No statistics available
      </div>
    )
  }

  const typeStats = Object.entries(stats.byType || {}).sort((a, b) => b[1] - a[1])
  const maxCount = Math.max(...typeStats.map(([_, count]) => count), 1)

  return (
    <div className="fade-in space-y-8">
      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass rounded-lg p-6">
          <p className="text-gray-400 text-sm mb-2">Total Titles</p>
          <p className="text-4xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">{stats.totalTitles}</p>
        </div>
        <div className="glass rounded-lg p-6">
          <p className="text-gray-400 text-sm mb-2">Total Scans</p>
          <p className="text-4xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">{stats.totalScans}</p>
        </div>
        <div className="glass rounded-lg p-6">
          <p className="text-gray-400 text-sm mb-2">Catalog Size</p>
          <p className="text-4xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">{stats.fileSizeKb}</p>
        </div>
      </div>

      {/* Type Breakdown */}
      <div className="glass rounded-lg p-6">
        <h3 className="text-xl font-semibold mb-6 flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-indigo-400" />
          Titles by Type
        </h3>

        <div className="space-y-4">
          {typeStats.map(([type, count]) => (
            <div key={type}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-300 capitalize">{type}</span>
                <span className="text-indigo-400 font-semibold">{count}</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-indigo-500 to-purple-600 h-full rounded-full transition-all"
                  style={{ width: `${(count / maxCount) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Storage Info */}
      {stats.sheetUrl && (
        <div className="glass rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4">Cloud Storage</h3>
          <a
            href={stats.sheetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            <span>View Google Sheet</span>
            <span>→</span>
          </a>
        </div>
      )}

      {/* Refresh Button */}
      <button
        onClick={fetchStats}
        className="w-full glass rounded-lg px-4 py-3 text-indigo-400 hover:text-indigo-300 transition-colors"
      >
        Refresh Statistics
      </button>
    </div>
  )
}
