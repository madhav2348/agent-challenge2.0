'use client'

import { useState, useRef } from 'react'
import { Upload, Loader, CheckCircle, AlertCircle } from 'lucide-react'
import axios from 'axios'

export default function ScreenshotUpload({ onComplete, onStatsUpdate }) {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)
  const fileInputRef = useRef(null)

  const handleFileSelect = (e) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      if (!selectedFile.type.startsWith('image/')) {
        setError('Please select an image file')
        return
      }
      setFile(selectedFile)
      setError(null)
      
      const reader = new FileReader()
      reader.onload = (e) => setPreview(e.target.result)
      reader.readAsDataURL(selectedFile)
    }
  }

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a file first')
      return
    }

    setLoading(true)
    setError(null)
    setSuccess(false)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await axios.post('/api/analyze', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })

      setSuccess(true)
      onComplete(response.data)
      
      const statsResponse = await axios.get('/api/stats')
      onStatsUpdate(statsResponse.data)

      setTimeout(() => {
        setFile(null)
        setPreview(null)
        setSuccess(false)
      }, 2000)
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.currentTarget.classList.add('border-indigo-500', 'bg-indigo-500/10')
  }

  const handleDragLeave = (e) => {
    e.currentTarget.classList.remove('border-indigo-500', 'bg-indigo-500/10')
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.currentTarget.classList.remove('border-indigo-500', 'bg-indigo-500/10')
    const droppedFile = e.dataTransfer.files?.[0]
    if (droppedFile) {
      const event = { target: { files: [droppedFile] } }
      handleFileSelect(event)
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div className="fade-in">
        <div className="mb-4 glass rounded-lg p-4 border border-indigo-500/30 bg-indigo-500/10">
          <p className="text-sm text-indigo-300 font-semibold">🚀 Powered by Nosana</p>
          <p className="text-xs text-gray-400 mt-1">Qwen3.5-27B LLM for intelligent media analysis</p>
          <p className="text-xs text-gray-500 mt-2">Detects: Movies, TV, Anime, Music, Podcasts, Games, Books & More</p>
        </div>
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className="glass rounded-lg border-2 border-dashed border-gray-600 p-12 text-center cursor-pointer transition-all hover:border-indigo-500 hover:bg-indigo-500/5"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />
          
          <Upload className="w-12 h-12 mx-auto mb-4 text-indigo-400" />
          <h3 className="text-xl font-semibold mb-2">Upload Screenshot</h3>
          <p className="text-gray-400 mb-4">
            Drag and drop your screenshot here or click to browse
          </p>
          <p className="text-sm text-gray-500">
            Supports PNG, JPG, WebP, GIF
          </p>
        </div>

        {file && (
          <div className="mt-6 glass rounded-lg p-4">
            <p className="text-sm text-gray-400 mb-2">Selected File:</p>
            <p className="font-mono text-sm text-indigo-400 break-all">{file.name}</p>
            <p className="text-xs text-gray-500 mt-2">
              {(file.size / 1024).toFixed(2)} KB
            </p>
          </div>
        )}

        {error && (
          <div className="mt-6 glass rounded-lg p-4 border border-red-500/50 bg-red-500/10 flex gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {success && (
          <div className="mt-6 glass rounded-lg p-4 border border-green-500/50 bg-green-500/10 flex gap-3">
            <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-green-300">Upload successful!</p>
          </div>
        )}

        <button
          onClick={handleUpload}
          disabled={!file || loading}
          className="w-full mt-6 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition-all flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Loader className="w-5 h-5 spin" />
              Analyzing...
            </>
          ) : (
            <>
              <Upload className="w-5 h-5" />
              Analyze Screenshot
            </>
          )}
        </button>
      </div>

      {preview && (
        <div className="fade-in">
          <div className="glass rounded-lg overflow-hidden">
            <img
              src={preview}
              alt="Preview"
              className="w-full h-auto max-h-96 object-cover"
            />
          </div>
          <div className="mt-4 glass rounded-lg p-4">
            <p className="text-sm text-gray-400 mb-2">Preview</p>
            <p className="text-xs text-gray-500">
              This screenshot will be analyzed for media titles, music, games, books, and more.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
