import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const catalogPath = path.join(process.cwd(), 'catalog.json')

export async function GET() {
  try {
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

    if (fs.existsSync(catalogPath)) {
      catalogData = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'))
    }

    return NextResponse.json({
      totalTitles: catalogData.titles?.length || 0,
      totalScans: catalogData.scans || 0,
      fileSizeKb: catalogData.stats?.fileSizeKb || '0',
      byType: catalogData.stats?.byType || {},
      sheetUrl: process.env.GOOGLE_SHEET_ID 
        ? `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEET_ID}`
        : null
    })
  } catch (err) {
    console.error('Stats error:', err)
    return NextResponse.json({
      totalTitles: 0,
      totalScans: 0,
      fileSizeKb: '0',
      byType: {}
    })
  }
}
