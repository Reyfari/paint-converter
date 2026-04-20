/**
 * Client-side paint converter engine.
 * Port of backend/app/services/paint_converter.py — runs against static JSON data.
 */

export interface PaintData {
  id: number
  name: string
  brand: string | null
  paint_type: string | null
  color_hex: string | null
  line: string | null
  ref: string | null
  application: string | null
}

export interface PaintLink {
  paint_a_id: number
  paint_b_id: number
  source: string
}

export interface PaintEquivalentResult {
  paint: PaintData
  tier: 'direct' | 'derived'
  via: PaintData | null
}

export interface PaintBrandGroup {
  brand: string
  primary: PaintEquivalentResult
  alternatives: PaintEquivalentResult[]
}

export interface PaintColorMatch {
  paint: PaintData
  delta_e: number
}

export interface PaintEquivalentsResponse {
  source: PaintData
  equivalents: PaintBrandGroup[]
  color_matches: PaintColorMatch[]
}

// ── CIELAB color distance ─────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255]
}

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const linearize = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  const rl = linearize(r), gl = linearize(g), bl = linearize(b)

  const x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / 0.95047
  const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750
  const z = (rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041) / 1.08883

  const f = (t: number) => t > 0.008856 ? t ** (1 / 3) : 7.787 * t + 16 / 116
  const fx = f(x), fy = f(y), fz = f(z)

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

function deltaE(hex1: string, hex2: string): number {
  const [L1, a1, b1] = rgbToLab(...hexToRgb(hex1))
  const [L2, a2, b2] = rgbToLab(...hexToRgb(hex2))
  return Math.sqrt((L2 - L1) ** 2 + (a2 - a1) ** 2 + (b2 - b1) ** 2)
}

// ── Converter engine ──────────────────────────────────────────────

export class PaintConverter {
  private paintsById: Map<number, PaintData>
  private linksByPaint: Map<number, Set<number>>
  private paintsByBrandName: Map<string, number[]>

  constructor(paints: PaintData[], links: PaintLink[]) {
    this.paintsById = new Map(paints.map(p => [p.id, p]))

    // Build adjacency list
    this.linksByPaint = new Map()
    for (const link of links) {
      if (!this.linksByPaint.has(link.paint_a_id)) this.linksByPaint.set(link.paint_a_id, new Set())
      if (!this.linksByPaint.has(link.paint_b_id)) this.linksByPaint.set(link.paint_b_id, new Set())
      this.linksByPaint.get(link.paint_a_id)!.add(link.paint_b_id)
      this.linksByPaint.get(link.paint_b_id)!.add(link.paint_a_id)
    }

    // Build brand+name index for name clusters
    this.paintsByBrandName = new Map()
    for (const p of paints) {
      const key = `${p.brand}\0${p.name}`
      if (!this.paintsByBrandName.has(key)) this.paintsByBrandName.set(key, [])
      this.paintsByBrandName.get(key)!.push(p.id)
    }
  }

  private getLinks(paintId: number): Set<number> {
    return this.linksByPaint.get(paintId) ?? new Set()
  }

  private nameCluster(paint: PaintData): number[] {
    return this.paintsByBrandName.get(`${paint.brand}\0${paint.name}`) ?? [paint.id]
  }

  search(query: string): PaintData[] {
    const q = query.toLowerCase()
    const matches = Array.from(this.paintsById.values())
      .filter(p => p.name.toLowerCase().includes(q))
    matches.sort((a, b) => {
      const aPrefix = a.name.toLowerCase().startsWith(q) ? 0 : 1
      const bPrefix = b.name.toLowerCase().startsWith(q) ? 0 : 1
      if (aPrefix !== bPrefix) return aPrefix - bPrefix
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    })
    return matches.slice(0, 50)
  }

  getPaint(id: number): PaintData | undefined {
    return this.paintsById.get(id)
  }

  getEquivalents(paintId: number): PaintEquivalentsResponse | null {
    const source = this.paintsById.get(paintId)
    if (!source) return null

    // Expand to name cluster
    const clusterIds = new Set(this.nameCluster(source))

    // Direct links from cluster
    const directIds = new Set<number>()
    for (const cid of clusterIds) {
      for (const linked of this.getLinks(cid)) {
        if (!clusterIds.has(linked)) directIds.add(linked)
      }
    }

    // 1-hop derived
    const derivedIds = new Map<number, number>() // derivedId -> viaId
    for (const did of directIds) {
      for (const hopId of this.getLinks(did)) {
        if (!clusterIds.has(hopId) && !directIds.has(hopId) && !derivedIds.has(hopId)) {
          derivedIds.set(hopId, did)
        }
      }
    }

    // Expand results to include name-cluster siblings
    const allResultIds = new Set([...directIds, ...derivedIds.keys()])
    const siblingMap = new Map<number, number>() // siblingId -> originId
    for (const pid of allResultIds) {
      const p = this.paintsById.get(pid)
      if (!p) continue
      for (const sibId of this.nameCluster(p)) {
        if (!allResultIds.has(sibId) && !clusterIds.has(sibId) && !siblingMap.has(sibId)) {
          siblingMap.set(sibId, pid)
        }
      }
    }

    // Build results
    const results: PaintEquivalentResult[] = []
    for (const pid of directIds) {
      const p = this.paintsById.get(pid)
      if (p && p.brand !== source.brand) {
        results.push({ paint: p, tier: 'direct', via: null })
      }
    }
    for (const [pid, viaId] of derivedIds) {
      const p = this.paintsById.get(pid)
      if (p && p.brand !== source.brand) {
        results.push({ paint: p, tier: 'derived', via: this.paintsById.get(viaId) ?? null })
      }
    }
    for (const [sibId, originId] of siblingMap) {
      const sib = this.paintsById.get(sibId)
      if (!sib || sib.brand === source.brand) continue
      if (directIds.has(originId)) {
        results.push({ paint: sib, tier: 'direct', via: null })
      } else if (derivedIds.has(originId)) {
        results.push({ paint: sib, tier: 'derived', via: this.paintsById.get(derivedIds.get(originId)!) ?? null })
      }
    }

    // Group by brand
    const byBrand = new Map<string, PaintEquivalentResult[]>()
    for (const r of results) {
      const brand = r.paint.brand ?? 'Unknown'
      if (!byBrand.has(brand)) byBrand.set(brand, [])
      byBrand.get(brand)!.push(r)
    }

    const equivalents: PaintBrandGroup[] = Array.from(byBrand.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([brand, paints]) => {
        const primary = this.pickPreferred(paints, source.application)
        const alternatives = paints.filter(p => p.paint.id !== primary.paint.id)
        return { brand, primary, alternatives }
      })

    // Color matching
    const graphPaintIds = new Set(results.map(r => r.paint.id))
    const colorMatches = this.getColorMatches(source, graphPaintIds)

    return { source, equivalents, color_matches: colorMatches }
  }

  private pickPreferred(results: PaintEquivalentResult[], preferredApp: string | null): PaintEquivalentResult {
    if (preferredApp) {
      const match = results.find(r => r.paint.application === preferredApp)
      if (match) return match
    }
    const regular = results.find(r => r.paint.application === 'regular')
    if (regular) return regular
    const direct = results.find(r => r.tier === 'direct')
    if (direct) return direct
    return results[0]
  }

  private getColorMatches(source: PaintData, excludeIds: Set<number>): PaintColorMatch[] {
    if (!source.color_hex || source.color_hex.length !== 7) return []

    const matches: PaintColorMatch[] = []
    for (const p of this.paintsById.values()) {
      if (p.brand === source.brand) continue
      if (excludeIds.has(p.id) || p.id === source.id) continue
      if (!p.color_hex || p.color_hex.length !== 7) continue
      try {
        const de = deltaE(source.color_hex, p.color_hex)
        if (de <= 5.0) {
          matches.push({ paint: p, delta_e: Math.round(de * 10) / 10 })
        }
      } catch { continue }
    }

    matches.sort((a, b) => a.delta_e - b.delta_e)
    return matches
  }
}

// ── Data loading ──────────────────────────────────────────────────

let converterInstance: PaintConverter | null = null

export async function loadConverter(): Promise<PaintConverter> {
  if (converterInstance) return converterInstance

  const base = import.meta.env.BASE_URL
  const [paintsRes, linksRes] = await Promise.all([
    fetch(`${base}data/paints.json`).then(r => r.json()),
    fetch(`${base}data/links.json`).then(r => r.json()),
  ])

  converterInstance = new PaintConverter(paintsRes, linksRes)
  return converterInstance
}
