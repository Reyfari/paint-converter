import { Document, Page, View, Text, StyleSheet, pdf } from '@react-pdf/renderer'
// Shared module — kept in sync with the standalone paint-converter-app repo.
import type { PaintResponse, PaintEquivalentResult } from './PaintConverterShared'

export interface PdfGroupedEquiv {
  brand: string
  name: string
  primary: PaintEquivalentResult
  primaryDetail: string
  alsoIn: string[]
  noAppMatch: boolean
}

export interface PdfRow {
  source: PaintResponse
  vendorCells: Map<string, PdfGroupedEquiv[]>
}

export interface PdfExportData {
  vendorColumns: string[]
  rows: PdfRow[]
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: { padding: '1.5cm', fontFamily: 'Helvetica', fontSize: 9, color: '#1a1a1a' },
  title: { fontSize: 14, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  subtitle: { fontSize: 8, color: '#666', marginBottom: 16 },

  // Table
  table: { width: '100%', marginBottom: 20 },
  headerRow: { flexDirection: 'row', backgroundColor: '#f0f0f0' },
  headerCell: { padding: '5 6', fontSize: 7, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 0.4, borderWidth: 0.5, borderColor: '#ddd' },
  row: { flexDirection: 'row' },

  // Source cell
  sourceCell: { flexDirection: 'row', backgroundColor: '#fafafa', borderWidth: 0.5, borderColor: '#ddd' },
  swatch: { width: 28, alignSelf: 'stretch' },
  sourceCellInfo: { flex: 1, padding: '4 6', justifyContent: 'center' },

  // Equiv cell
  equivCell: { padding: '4 6', borderWidth: 0.5, borderColor: '#ddd', justifyContent: 'center' },
  emptyCell: { padding: '4 6', borderWidth: 0.5, borderColor: '#ddd', justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: '#bbb' },

  // Paint block
  paintName: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#1a1a1a' },
  brandLine: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#666', textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 1 },

  // Variants / tier / via
  variants: { fontSize: 7, color: '#666', marginTop: 1 },
  tierDirect: { fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: '#276d3a', textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 2 },
  tierDerived: { fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: '#856404', textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 2 },
  via: { fontSize: 7, color: '#999', fontStyle: 'italic', marginTop: 1 },

  // Cell alt separator
  cellAlt: { borderTopWidth: 0.5, borderTopColor: '#ddd', paddingTop: 3, marginTop: 3 },

  // Disclaimer
  disclaimer: { borderTopWidth: 0.5, borderTopColor: '#ddd', paddingTop: 10 },
  disclaimerText: { fontSize: 7, color: '#555', lineHeight: 1.5, marginBottom: 4 },
  disclaimerBold: { fontFamily: 'Helvetica-Bold', color: '#333' },

  // Branding
  projectFrom: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#276d3a', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2 },
  footer: { borderTopWidth: 0.5, borderTopColor: '#ddd', paddingTop: 8, marginTop: 10, alignItems: 'center' },
  footerBrand: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#333' },
  footerDesc: { fontSize: 6.5, color: '#888', fontStyle: 'italic', marginTop: 2 },
})

// ── Components ────────────────────────────────────────────────────────────────

function SourceBlock({ paint }: { paint: PaintResponse }) {
  const typeStr = paint.paint_type ? ` (${paint.paint_type})` : ''
  const lineParts = [paint.brand, paint.line].filter(Boolean).join(' · ')
  return (
    <View>
      <Text style={s.paintName}>{paint.name}{typeStr}</Text>
      <Text style={s.brandLine}>{lineParts}</Text>
    </View>
  )
}

function EquivCellContent({ equivs }: { equivs: PdfGroupedEquiv[] }) {
  return (
    <View>
      {equivs.map((g, i) => {
        // Collect all variant labels: primary's detail first, then alsoIn
        const primaryParts = [g.primary.paint.paint_type, g.primary.paint.line].filter(Boolean)
        if (primaryParts[0] && primaryParts[1] && primaryParts[0].toLowerCase() === primaryParts[1].toLowerCase()) primaryParts.splice(1, 1)
        const primaryLabel = primaryParts.join(' · ')
        const allVariants = [primaryLabel, ...new Set(g.alsoIn)].filter(Boolean)
        const { tier, via } = g.primary

        return (
          <View key={`${g.brand}-${g.name}`} style={i > 0 ? s.cellAlt : undefined}>
            <Text style={s.paintName}>{g.name}</Text>
            {allVariants.length > 0 && (
              <Text style={s.variants}>{allVariants.join(', ')}</Text>
            )}
            <Text style={tier === 'direct' ? s.tierDirect : s.tierDerived}>{tier}</Text>
            {tier === 'derived' && via && (
              <Text style={s.via}>via {via.name}{via.brand ? ` (${via.brand})` : ''}</Text>
            )}
          </View>
        )
      })}
    </View>
  )
}

function PdfDocument({ data }: { data: PdfExportData }) {
  const today = new Date().toISOString().slice(0, 10)
  const colCount = 1 + data.vendorColumns.length
  // Source column gets a bit more width
  const sourceWidth = `${Math.round(100 / colCount + 5)}%`
  const vendorWidth = `${Math.round((100 - 100 / colCount - 5) / data.vendorColumns.length)}%`

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <Text style={s.projectFrom}>From Project Librarium</Text>
        <Text style={s.title}>Paint Converter Results</Text>
        <Text style={s.subtitle}>Generated {today}</Text>

        <View style={s.table}>
          {/* Header */}
          <View style={s.headerRow}>
            <View style={[s.headerCell, { width: sourceWidth }]}>
              <Text>Source</Text>
            </View>
            {data.vendorColumns.map(v => (
              <View key={v} style={[s.headerCell, { width: vendorWidth }]}>
                <Text>{v}</Text>
              </View>
            ))}
          </View>

          {/* Rows */}
          {data.rows.map(row => (
            <View key={row.source.id} style={s.row} wrap={false}>
              {/* Source cell */}
              <View style={[s.sourceCell, { width: sourceWidth }]}>
                <View style={[s.swatch, { backgroundColor: row.source.color_hex || '#ccc' }]} />
                <View style={s.sourceCellInfo}>
                  <SourceBlock paint={row.source} />
                </View>
              </View>

              {/* Vendor cells */}
              {data.vendorColumns.map(vendor => {
                const equivs = row.vendorCells.get(vendor)
                if (!equivs || equivs.length === 0) {
                  return (
                    <View key={vendor} style={[s.emptyCell, { width: vendorWidth }]}>
                      <Text style={s.emptyText}>—</Text>
                    </View>
                  )
                }
                return (
                  <View key={vendor} style={[s.equivCell, { width: vendorWidth }]}>
                    <EquivCellContent equivs={equivs} />
                  </View>
                )
              })}
            </View>
          ))}
        </View>

        {/* Disclaimer */}
        <View style={s.disclaimer}>
          <Text style={s.disclaimerText}>
            <Text style={s.disclaimerBold}>Cross-brand equivalences</Text> are sourced from vendor-published conversion charts (Army Painter, Two Thin Coats, Vallejo). These charts represent the vendors' own stated equivalences between their ranges and competitor products. They are not independent assessments — trust the vendor's intent, but always compare in person before committing to a project.
          </Text>
          <Text style={s.disclaimerText}>
            <Text style={s.disclaimerBold}>Direct</Text> matches come from a single conversion chart entry. <Text style={s.disclaimerBold}>Derived</Text> matches are inferred by chaining two chart entries (A {'>'} B {'>'} C) and carry more uncertainty.
          </Text>
        </View>

        <View style={s.footer}>
          <Text style={s.footerBrand}>Project Librarium</Text>
          <Text style={s.footerDesc}>An AI-powered workshop for managing miniature painting projects.</Text>
        </View>
      </Page>
    </Document>
  )
}

// ── Export function ───────────────────────────────────────────────────────────

export async function generatePdf(data: PdfExportData): Promise<void> {
  const blob = await pdf(<PdfDocument data={data} />).toBlob()
  const url = URL.createObjectURL(blob)
  const today = new Date().toISOString().slice(0, 10)

  // Create a temporary link and click it to trigger download
  const a = document.createElement('a')
  a.href = url
  a.download = `paint-converter-${today}.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
