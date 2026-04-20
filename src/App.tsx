import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { loadConverter, type PaintConverter } from './converter'
import { generatePdf, type PdfGroupedEquiv, type PdfRow } from './PaintConverterPdf'
// Shared module — kept in sync with Librarium (frontend/src/pages/).
// Also used by: PaintConverterPdf.tsx. Sync targets: Shared, Pdf, CSS.
import {
  type PaintResponse, type SelectedEntry,
  BRANDS, swatchStyle,
  PaintSwatch, PaintMeta, ResultCard,
  promoteByApplication, groupEquivsByPaint,
} from './PaintConverterShared'
import './PaintConverterPage.css'

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
