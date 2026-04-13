import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const catalogPath = path.join(process.cwd(), 'catalog.json')

export async function GET() {
  try {
    let catalogData = { titles: [] }

    if (fs.existsSync(catalogPath)) {
      catalogData = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'))
    }

    return NextResponse.json({
      titles: catalogData.titles || [],
      total: catalogData.titles?.length || 0
    })
  } catch (err) {
    console.error('Catalog error:', err)
    return NextResponse.json({ titles: [], total: 0 })
  }
}
