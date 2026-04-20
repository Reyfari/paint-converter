import { useState, useEffect, useRef } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

export interface PaintResponse {
  id: number
  name: string
  brand: string | null
  paint_type: string | null
  color_hex: string | null
  line: string | null
  ref: string | null
  application: string | null
  notes?: string | null
  owned?: boolean | null
}

export interface PaintEquivalentResult {
  paint: PaintResponse
  tier: 'direct' | 'derived'
  via: PaintResponse | null
}

export interface PaintBrandGroup {
  brand: string
  primary: PaintEquivalentResult
  alternatives: PaintEquivalentResult[]
}

export interface PaintColorMatch {
  paint: PaintResponse
  delta_e: number
}

export interface PaintEquivalentsResponse {
  source: PaintResponse
  equivalents: PaintBrandGroup[]
  color_matches: PaintColorMatch[]
}

export interface SelectedEntry {
  paint: PaintResponse
  result: PaintEquivalentsResponse | null
  checked: boolean
  collapsed: boolean
}

export interface GroupedEquiv {
  brand: string
  name: string
  primary: PaintEquivalentResult
  primaryDetail: string
  alsoIn: string[]
  noAppMatch: boolean
}

// ── Constants ────────────────────────────────────────────────────────────────

export const BRANDS = ['Army Painter', 'Citadel', 'Two Thin Coats', 'Vallejo']

export const NO_COLOR_STYLE = {
  background: 'repeating-linear-gradient(-45deg, #2e2e4a, #2e2e4a 3px, #1e1e36 3px, #1e1e36 9px)',
} as const

export const swatchStyle = (hex: string | null) => hex ? { backgroundColor: hex } : NO_COLOR_STYLE

// ── Small shared components ──────────────────────────────────────────────────

export function PaintSwatch({ hex, size = 'normal' }: { hex: string | null; size?: 'normal' | 'large' }) {
  return <div className={`pc-swatch pc-swatch-${size}`} style={swatchStyle(hex)} />
}

export function PaintMeta({ paint }: { paint: PaintResponse }) {
  const parts = [paint.brand, paint.paint_type, paint.line].filter(Boolean)
  return <span className="pc-meta">{parts.join(' · ')}</span>
}

export function DeltaBadge({ delta }: { delta: number }) {
  let cls = 'pc-badge-similar'
  let label = 'Similar'
  if (delta <= 1) { cls = 'pc-badge-identical'; label = 'Near identical' }
  else if (delta <= 3) { cls = 'pc-badge-close'; label = 'Very close' }
  return <span className={`pc-badge ${cls}`}>{label} ΔE {delta.toFixed(1)}</span>
}

export function TierBadge({ tier }: { tier: 'direct' | 'derived' }) {
  return <span className={`pc-badge pc-badge-tier-${tier}`}>{tier}</span>
}

export function DisclaimerIcon({ text }: { text: string }) {
  const [show, setShow] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!show) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setShow(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [show])

  return (
    <div className="pc-disclaimer-wrap" ref={ref}>
      <button className="pc-info-btn" onClick={() => setShow(s => !s)} aria-label="Show disclaimer">ⓘ</button>
      {show && <div className="pc-disclaimer-popup">{text}</div>}
    </div>
  )
}

// ── Logic functions ──────────────────────────────────────────────────────────

export function promoteByApplication(group: PaintBrandGroup, sourceApp: string | null): { group: PaintBrandGroup; noAppMatch: boolean } {
  if (!sourceApp) return { group, noAppMatch: false }
  const appLower = sourceApp.toLowerCase()
  if (!group.primary.paint.application || group.primary.paint.application.toLowerCase() === appLower) return { group, noAppMatch: false }
  const matchIdx = group.alternatives.findIndex(eq => eq.paint.application?.toLowerCase() === appLower)
  if (matchIdx === -1) return { group, noAppMatch: true }
  const matched = group.alternatives[matchIdx]
  const newAlternatives = [group.primary, ...group.alternatives.filter((_, i) => i !== matchIdx)]
  return { group: { ...group, primary: matched, alternatives: newAlternatives }, noAppMatch: false }
}

export function formatDetail(paint: PaintResponse): string {
  const parts = [paint.paint_type, paint.line].filter(Boolean)
  if (parts[0] && parts[1] && parts[0].toLowerCase() === parts[1].toLowerCase()) return parts[0]!
  return parts.join(' · ')
}

export function groupEquivsByPaint(
  equivalents: { group: PaintBrandGroup; noAppMatch: boolean }[],
  sourceApp: string | null
): GroupedEquiv[] {
  const flat: { eq: PaintEquivalentResult; brand: string; noAppMatch: boolean }[] = []
  for (const { group, noAppMatch } of equivalents) {
    flat.push({ eq: group.primary, brand: group.brand, noAppMatch })
    for (const alt of group.alternatives) {
      flat.push({ eq: alt, brand: group.brand, noAppMatch: false })
    }
  }

  const groups = new Map<string, typeof flat>()
  for (const item of flat) {
    const key = `${item.brand}\0${item.eq.paint.name}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(item)
  }

  const result: GroupedEquiv[] = []
  for (const items of groups.values()) {
    const appLower = (sourceApp || '').toLowerCase()
    items.sort((a, b) => {
      if (a.eq.tier !== b.eq.tier) return a.eq.tier === 'direct' ? -1 : 1
      const aMatch = a.eq.paint.application?.toLowerCase() === appLower ? 1 : 0
      const bMatch = b.eq.paint.application?.toLowerCase() === appLower ? 1 : 0
      if (aMatch !== bMatch) return bMatch - aMatch
      return 0
    })

    const primary = items[0]
    const others = items.slice(1)
    const alsoIn = [...new Set(others
      .map(o => o.eq.paint.line || o.eq.paint.paint_type || o.eq.paint.application)
      .filter((v): v is string => Boolean(v)))]

    const primaryApp = primary.eq.paint.application?.toLowerCase() || null
    const mismatch = Boolean(sourceApp && primaryApp && primaryApp !== appLower)

    result.push({
      brand: primary.brand,
      name: primary.eq.paint.name,
      primary: primary.eq,
      primaryDetail: formatDetail(primary.eq.paint),
      alsoIn,
      noAppMatch: mismatch,
    })
  }

  return result
}

// ── Composite components ─────────────────────────────────────────────────────

export function EquivRow({ group }: { group: GroupedEquiv }) {
  const { paint, tier, via } = group.primary
  const allVariants = [group.primaryDetail, ...new Set(group.alsoIn)].filter(Boolean)
  return (
    <div className="pc-equiv-row">
      <span className="pc-equiv-brand">{group.brand}</span>
      <div className="pc-equiv-main">
        <span className="pc-equiv-name">
          {paint.name}
          {paint.owned && <span className="pc-owned-dot" title="Owned">✓</span>}
        </span>
        {allVariants.length > 0 && <span className="pc-equiv-details">{allVariants.join(', ')}</span>}
        {!paint.application && <span className="pc-app-hint">unknown type</span>}
        {group.noAppMatch && <span className="pc-app-hint">different type</span>}
      </div>
      <div className="pc-equiv-right">
        <TierBadge tier={tier} />
        {tier === 'derived' && via && (
          <span className="pc-via">via {via.name}{via.brand ? ` (${via.brand})` : ''}</span>
        )}
      </div>
    </div>
  )
}

export function ResultsBody({ result, preferredBrand }: {
  result: PaintEquivalentsResponse
  preferredBrand: string | null
}) {
  const sourceApp = result.source.application
  const promotedEquivs = result.equivalents
    .filter(g => !preferredBrand || g.brand === preferredBrand)
    .map(g => promoteByApplication(g, sourceApp))
  const grouped = groupEquivsByPaint(promotedEquivs, sourceApp)

  return (
    <div className="pc-results-body">
      {grouped.length === 0 ? (
        <div className="pc-empty">No cross-brand equivalents found.</div>
      ) : (
        <div className="pc-equiv-list">
          {grouped.map(g => <EquivRow key={`${g.brand}-${g.name}`} group={g} />)}
        </div>
      )}
    </div>
  )
}

export function ResultCard({ entry, preferredBrand, onToggleCollapsed, onRemove }: {
  entry: SelectedEntry
  preferredBrand: string | null
  onToggleCollapsed: (id: number) => void
  onRemove: (id: number) => void
}) {
  const { paint } = entry
  return (
    <div className="pc-result-card card">
      <div className="pc-result-card-header" onClick={() => onToggleCollapsed(paint.id)}>
        <div className="pc-header-swatch" style={swatchStyle(paint.color_hex)}>
          <span className={`pc-chevron ${entry.collapsed ? '' : 'pc-chevron-open'}`}>›</span>
        </div>
        <div className="pc-source-info">
          <div className="pc-source-name">
            {paint.name}
            {paint.owned && <span className="pc-owned-badge">Owned</span>}
          </div>
          <PaintMeta paint={paint} />
          {paint.color_hex && <span className="pc-hex">{paint.color_hex}</span>}
        </div>
        <div className="pc-source-actions">
          <button className="pc-remove-btn" onClick={e => { e.stopPropagation(); onRemove(paint.id) }} title="Remove">×</button>
        </div>
      </div>
      {!entry.collapsed && (
        entry.result
          ? <ResultsBody result={entry.result} preferredBrand={preferredBrand} />
          : <div className="pc-results-body"><div className="loading">Loading…</div></div>
      )}
    </div>
  )
}
