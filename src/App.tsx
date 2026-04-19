import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { loadConverter, type PaintConverter, type PaintData, type PaintEquivalentResult, type PaintBrandGroup, type PaintEquivalentsResponse } from './converter'
import { generatePdf, type PdfGroupedEquiv, type PdfRow } from './PaintConverterPdf'
import './PaintConverterPage.css'

type PaintResponse = PaintData

interface SelectedEntry {
  paint: PaintResponse
  result: PaintEquivalentsResponse | null
  checked: boolean
  collapsed: boolean
}

const BRANDS = ['Army Painter', 'Citadel', 'Two Thin Coats', 'Vallejo']

const NO_COLOR_STYLE = {
  background: 'repeating-linear-gradient(-45deg, #2e2e4a, #2e2e4a 3px, #1e1e36 3px, #1e1e36 9px)',
} as const

const swatchStyle = (hex: string | null) => hex ? { backgroundColor: hex } : NO_COLOR_STYLE

function PaintSwatch({ hex, size = 'normal' }: { hex: string | null; size?: 'normal' | 'large' }) {
  return <div className={`pc-swatch pc-swatch-${size}`} style={swatchStyle(hex)} />
}

function PaintMeta({ paint }: { paint: PaintResponse }) {
  const parts = [paint.brand, paint.paint_type, paint.line].filter(Boolean)
  return <span className="pc-meta">{parts.join(' · ')}</span>
}

function TierBadge({ tier }: { tier: 'direct' | 'derived' }) {
  return <span className={`pc-badge pc-badge-tier-${tier}`}>{tier}</span>
}

function promoteByApplication(group: PaintBrandGroup, sourceApp: string | null): { group: PaintBrandGroup; noAppMatch: boolean } {
  if (!sourceApp) return { group, noAppMatch: false }
  const appLower = sourceApp.toLowerCase()
  if (!group.primary.paint.application || group.primary.paint.application.toLowerCase() === appLower) return { group, noAppMatch: false }
  const matchIdx = group.alternatives.findIndex(eq => eq.paint.application?.toLowerCase() === appLower)
  if (matchIdx === -1) return { group, noAppMatch: true }
  const matched = group.alternatives[matchIdx]
  const newAlternatives = [group.primary, ...group.alternatives.filter((_, i) => i !== matchIdx)]
  return { group: { ...group, primary: matched, alternatives: newAlternatives }, noAppMatch: false }
}

function formatDetail(paint: PaintResponse): string {
  const parts = [paint.paint_type, paint.line].filter(Boolean)
  if (parts[0] && parts[1] && parts[0].toLowerCase() === parts[1].toLowerCase()) return parts[0]!
  return parts.join(' · ')
}

interface GroupedEquiv {
  brand: string
  name: string
  primary: PaintEquivalentResult
  primaryDetail: string
  alsoIn: string[]
  noAppMatch: boolean
}

function groupEquivsByPaint(
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

function EquivRow({ group }: { group: GroupedEquiv }) {
  const { paint, tier, via } = group.primary
  const allVariants = [group.primaryDetail, ...new Set(group.alsoIn)].filter(Boolean)
  return (
    <div className="pc-equiv-row">
      <span className="pc-equiv-brand">{group.brand}</span>
      <div className="pc-equiv-main">
        <span className="pc-equiv-name">{paint.name}</span>
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

function ResultsBody({ result, preferredBrand }: {
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

function ResultCard({ entry, preferredBrand, onToggleCollapsed, onRemove }: {
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
          <div className="pc-source-name">{paint.name}</div>
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

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [converter, setConverter] = useState<PaintConverter | null>(null)
  const [entries, setEntries] = useState<SelectedEntry[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<PaintResponse[]>([])
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [highlightIdx, setHighlightIdx] = useState(-1)
  const [preferredBrand, setPreferredBrand] = useState<string | null>(null)

  const multiWrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const entriesRef = useRef(entries)
  useEffect(() => { entriesRef.current = entries }, [entries])

  useEffect(() => { document.title = 'Paint Converter' }, [])
  useEffect(() => { loadConverter().then(setConverter) }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (multiWrapRef.current && !multiWrapRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
        setHighlightIdx(-1)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const selectPaint = useCallback((paint: PaintResponse) => {
    if (!converter) return
    setSearchQuery('')
    setSearchResults([])
    setDropdownOpen(false)
    setHighlightIdx(-1)

    const existing = entriesRef.current.find(e => e.paint.id === paint.id)
    if (existing) {
      setEntries(prev => prev.map(e =>
        e.paint.id === paint.id ? { ...e, checked: true, collapsed: false } : e
      ))
      return
    }

    const result = converter.getEquivalents(paint.id)
    setEntries(prev => [...prev, { paint, result, checked: true, collapsed: false }])
  }, [converter])

  const handleSearchChange = (q: string) => {
    setSearchQuery(q)
    setHighlightIdx(-1)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!q.trim() || !converter) { setSearchResults([]); setDropdownOpen(false); return }
    debounceRef.current = setTimeout(() => {
      const results = converter!.search(q)
      const selectedIds = new Set(entriesRef.current.map(e => e.paint.id))
      const filtered = results.filter(p => !selectedIds.has(p.id))
      setSearchResults(filtered)
      setDropdownOpen(filtered.length > 0)
    }, 150)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!dropdownOpen && searchResults.length > 0) setDropdownOpen(true)
      setHighlightIdx(i => Math.min(i + 1, searchResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIdx(i => Math.max(i - 1, -1))
    } else if (e.key === 'Enter') {
      const target = highlightIdx >= 0
        ? searchResults[highlightIdx]
        : searchResults.length === 1 ? searchResults[0] : null
      if (target) { e.preventDefault(); selectPaint(target) }
    } else if (e.key === 'Escape') {
      setDropdownOpen(false)
      setHighlightIdx(-1)
    } else if (e.key === 'Backspace' && !searchQuery) {
      const lastChecked = [...entriesRef.current].reverse().find(e => e.checked)
      if (lastChecked) {
        setEntries(prev => prev.map(e =>
          e.paint.id === lastChecked.paint.id ? { ...e, checked: false } : e
        ))
      }
    }
  }

  const toggleCheck = (paintId: number) => {
    setEntries(prev => prev.map(e =>
      e.paint.id === paintId ? { ...e, checked: !e.checked, collapsed: false } : e
    ))
  }

  const removeEntry = (paintId: number) => {
    setEntries(prev => prev.filter(e => e.paint.id !== paintId))
  }

  const toggleCollapsed = (paintId: number) => {
    setEntries(prev => prev.map(e =>
      e.paint.id === paintId ? { ...e, collapsed: !e.collapsed } : e
    ))
  }

  const vendorCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const entry of entries) {
      if (!entry.checked || !entry.result) continue
      for (const g of entry.result.equivalents) counts[g.brand] = (counts[g.brand] ?? 0) + 1
      for (const m of entry.result.color_matches) {
        if (m.paint.brand) counts[m.paint.brand] = (counts[m.paint.brand] ?? 0) + 1
      }
    }
    return counts
  }, [entries])

  const checkedEntries = entries.filter(e => e.checked)

  const handleExport = async () => {
    const allVendorBrands = new Set<string>()
    for (const entry of checkedEntries) {
      if (!entry.result) continue
      for (const g of entry.result.equivalents) {
        if (!preferredBrand || g.brand === preferredBrand) allVendorBrands.add(g.brand)
      }
    }
    const vendorColumns = Array.from(allVendorBrands).sort()
    const rows: PdfRow[] = checkedEntries.filter(e => e.result).map(({ paint: s, result: r }) => {
      const sourceApp = s.application
      const promoted = r!.equivalents
        .filter(g => !preferredBrand || g.brand === preferredBrand)
        .map(g => promoteByApplication(g, sourceApp))
      const grouped = groupEquivsByPaint(promoted, sourceApp)
      const byBrand = new Map<string, PdfGroupedEquiv[]>()
      for (const g of grouped) {
        if (!byBrand.has(g.brand)) byBrand.set(g.brand, [])
        byBrand.get(g.brand)!.push(g)
      }
      return { source: s, vendorCells: byBrand }
    })
    await generatePdf({ vendorColumns, rows })
  }

  if (!converter) {
    return <div className="pc-page"><div className="pc-empty" style={{ padding: '3rem 0' }}>Loading paint database…</div></div>
  }

  return (
    <div className="pc-page">
      <div className="page-header">
        <div className="pc-header-row">
          <div>
            <h2>Paint Converter</h2>
            <p>Find equivalent paints across brands</p>
          </div>
          {checkedEntries.length > 0 && (
            <button className="btn btn-sm" onClick={handleExport}>Export list</button>
          )}
        </div>
      </div>

      <div className="pc-multi-wrap" ref={multiWrapRef}>
        <div className="pc-multi-input" onClick={() => inputRef.current?.focus()}>
          {entries.map(entry => (
            <span
              key={entry.paint.id}
              className={`pc-chip ${entry.checked ? 'pc-chip-active' : 'pc-chip-inactive'}`}
              onClick={e => { e.stopPropagation(); toggleCheck(entry.paint.id) }}
            >
              <span className="pc-chip-swatch" style={swatchStyle(entry.paint.color_hex)} />
              {entry.paint.name}
              <button
                className="pc-chip-remove"
                onClick={e => { e.stopPropagation(); removeEntry(entry.paint.id) }}
                tabIndex={-1}
                aria-label="Remove"
              >×</button>
            </span>
          ))}
          <input
            ref={inputRef}
            type="text"
            className="pc-multi-input-field"
            placeholder={entries.length === 0 ? 'Search for paints…' : ''}
            value={searchQuery}
            onChange={e => handleSearchChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => searchResults.length > 0 && setDropdownOpen(true)}
          />
        </div>
        {dropdownOpen && searchResults.length > 0 && (
          <div className="pc-search-dropdown">
            {searchResults.map((paint, idx) => (
              <button
                key={paint.id}
                className={`pc-search-result ${idx === highlightIdx ? 'pc-search-result-active' : ''}`}
                onClick={() => selectPaint(paint)}
              >
                <PaintSwatch hex={paint.color_hex} />
                <div className="pc-search-result-info">
                  <span className="pc-search-result-name">{paint.name}</span>
                  <PaintMeta paint={paint} />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="pc-filters">
        <div className="pc-filter-block">
          <span className="pc-filter-label">Vendor</span>
          <hr className="pc-filter-divider" />
          <div className="pc-filter-group">
            {[null, ...BRANDS].map(brand => {
              const count = brand
                ? vendorCounts[brand]
                : Object.values(vendorCounts).reduce((a, b) => a + b, 0)
              return (
                <button
                  key={brand ?? 'all'}
                  className={`btn btn-sm ${preferredBrand === brand ? 'btn-primary' : ''}`}
                  onClick={() => setPreferredBrand(brand)}
                >
                  {brand ?? 'All'}
                  {entries.some(e => e.checked && e.result) && count != null && (
                    <span className="pc-filter-count">{count}</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {checkedEntries.length > 0 && (
        <div className="pc-cards">
          {checkedEntries.map(entry => (
            <ResultCard
              key={entry.paint.id}
              entry={entry}
              preferredBrand={preferredBrand}
              onToggleCollapsed={toggleCollapsed}
              onRemove={removeEntry}
            />
          ))}
        </div>
      )}

      {checkedEntries.some(e => e.result) && (
        <div className="pc-disclaimer-footer">
          <p><strong>Cross-brand equivalences</strong> are sourced from vendor-published conversion charts (Army Painter, Two Thin Coats, Vallejo). These represent the vendors' own stated equivalences. Always compare in person before committing to a project.</p>
          <p><strong>Direct</strong> matches come from a single conversion chart entry. <strong>Derived</strong> matches are inferred by chaining two entries (A→B→C) and carry more uncertainty.</p>
        </div>
      )}
    </div>
  )
}
