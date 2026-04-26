import { useState, useCallback, useRef, useEffect } from 'react'
import { api } from '../utils/api'
import Toast, { useToast } from '../components/Toast'
import type {
  CdtCodeResult,
  Phase3EstimateResult,
  Phase3MultiEstimateResult,
} from '../types'
import { CARRIERS } from '../types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtCAD(v: number): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(v)
}

function coverageCategoryBadge(category: string): { label: string; color: string } {
  switch (category) {
    case 'preventive':   return { label: 'Preventive',    color: '#059669' }
    case 'basic':        return { label: 'Basic',         color: '#2563EB' }
    case 'major':        return { label: 'Major',         color: '#D97706' }
    case 'orthodontic':  return { label: 'Orthodontic',   color: '#7C3AED' }
    default:             return { label: category,        color: '#6B7280' }
  }
}

// ── CDT Code Autocomplete ─────────────────────────────────────────────────────

interface CdtSearchProps {
  value: string
  onChange: (code: string, description: string, typicalFee: number) => void
  index: number
}

function CdtSearch({ value, onChange, index }: CdtSearchProps) {
  const [query, setQuery] = useState(value)
  const [results, setResults] = useState<CdtCodeResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function handleInput(val: string) {
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (val.length < 2) { setResults([]); setOpen(false); return }

    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await api.get<{ codes: CdtCodeResult[] }>(
          `/api/estimates/cdt-search/query?q=${encodeURIComponent(val)}`
        )
        setResults(data.codes || [])
        setOpen(true)
      } catch {
        // Search unavailable — that's OK, user can still type code directly
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 250)
  }

  function selectCode(cdt: CdtCodeResult) {
    setQuery(`${cdt.code} — ${cdt.description}`)
    setOpen(false)
    onChange(cdt.code, cdt.description, cdt.typicalFee)
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', flex: 1 }}>
      <input
        type="text"
        value={query}
        onChange={e => handleInput(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder="CDT code or description (e.g. D1110, cleaning…)"
        aria-label={`Procedure ${index + 1} CDT code`}
        aria-autocomplete="list"
        aria-expanded={open}
        style={{ width: '100%' }}
      />
      {loading && (
        <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: '0.75rem', color: 'var(--gray-400)' }}>
          searching…
        </span>
      )}
      {open && results.length > 0 && (
        <ul
          role="listbox"
          aria-label="CDT code suggestions"
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
            background: '#fff', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: '0.25rem 0',
            maxHeight: 260, overflowY: 'auto', margin: '2px 0 0',
          }}
        >
          {results.map(cdt => {
            const badge = coverageCategoryBadge(cdt.category)
            return (
              <li
                key={cdt.code}
                role="option"
                onMouseDown={() => selectCode(cdt)}
                style={{
                  padding: '0.5rem 0.875rem', cursor: 'pointer', display: 'flex',
                  justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(16,185,129,0.06)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span>
                  <strong style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>{cdt.code}</strong>
                  <span style={{ marginLeft: 8, color: 'var(--gray-600)', fontSize: '0.875rem' }}>{cdt.description}</span>
                </span>
                <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: '0.7rem', background: badge.color + '18', color: badge.color, borderRadius: 4, padding: '1px 6px', fontWeight: 600 }}>
                    {badge.label}
                  </span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--gray-400)' }}>{fmtCAD(cdt.typicalFee)}</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ── Per-Procedure Result Row ──────────────────────────────────────────────────

function ProcedureResultRow({ proc }: { proc: Phase3EstimateResult }) {
  const [expanded, setExpanded] = useState(false)
  const badge = coverageCategoryBadge(proc.coverageCategory)

  const hasWarning = proc.frequencyLimited || proc.waitingPeriodActive || proc.notCovered

  return (
    <>
      <tr
        onClick={() => setExpanded(!expanded)}
        style={{ cursor: 'pointer' }}
        aria-expanded={expanded}
      >
        <td>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{proc.cdtCode}</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--gray-500)' }}>{proc.cdtDescription}</span>
            <span style={{ fontSize: '0.7rem', background: badge.color + '18', color: badge.color, borderRadius: 4, padding: '1px 6px', fontWeight: 600 }}>
              {badge.label}
            </span>
            {hasWarning && (
              <span style={{ fontSize: '0.7rem', background: '#FEF3C7', color: '#92400E', borderRadius: 4, padding: '1px 6px', fontWeight: 600 }}>
                ⚠ {proc.notCovered ? 'Not Covered' : proc.frequencyLimited ? 'Freq. Limit' : 'Waiting Period'}
              </span>
            )}
            <span style={{ fontSize: '0.7rem', color: 'var(--gray-400)' }}>▾ steps</span>
          </div>
        </td>
        <td style={{ textAlign: 'right' }}>{fmtCAD(proc.procedureFee)}</td>
        <td style={{ textAlign: 'right' }}>
          {proc.notCovered ? <span style={{ color: '#DC2626' }}>0%</span> : `${proc.coveragePct}%`}
        </td>
        <td style={{ textAlign: 'right', color: proc.notCovered ? '#DC2626' : '#059669', fontWeight: 500 }}>
          {fmtCAD(proc.insurancePays)}
        </td>
        <td style={{ textAlign: 'right', fontWeight: 700 }}>
          {fmtCAD(proc.patientPays)}
        </td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={5} style={{ padding: '0 1rem 0.75rem', background: 'rgba(16,185,129,0.03)', borderTop: 'none' }}>
            {/* Warning banner */}
            {hasWarning && (
              <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6, padding: '0.5rem 0.75rem', marginBottom: '0.5rem', fontSize: '0.8rem', color: '#92400E' }}>
                <strong>⚠ {proc.notCoveredReason || proc.frequencyNote || proc.waitingPeriodNote}</strong>
              </div>
            )}
            {/* Step-by-step breakdown */}
            <ol style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.8rem', color: 'var(--gray-600)', lineHeight: 1.7 }}>
              {proc.breakdown.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </td>
        </tr>
      )}
    </>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

interface ProcedureInput {
  cdtCode: string
  cdtDescription: string
  procedureFee: string
}

export default function PreTreatmentEstimate() {
  const [patientToken, setPatientToken] = useState('')
  const [carrierCode, setCarrierCode] = useState('')
  const [deductiblePaid, setDeductiblePaid] = useState('0')
  const [annualMaxUsed, setAnnualMaxUsed] = useState('0')
  const [procedures, setProcedures] = useState<ProcedureInput[]>([
    { cdtCode: '', cdtDescription: '', procedureFee: '' },
  ])
  const [result, setResult] = useState<Phase3MultiEstimateResult | null>(null)
  const [loading, setLoading] = useState(false)
  const { toast, showToast, dismissToast } = useToast()

  function addProcedure() {
    setProcedures([...procedures, { cdtCode: '', cdtDescription: '', procedureFee: '' }])
  }

  function removeProcedure(i: number) {
    if (procedures.length === 1) return
    setProcedures(procedures.filter((_, idx) => idx !== i))
    setResult(null)
  }

  function updateFee(i: number, fee: string) {
    const updated = [...procedures]
    updated[i] = { ...updated[i], procedureFee: fee }
    setProcedures(updated)
    setResult(null)
  }

  function setCode(i: number, code: string, description: string, typicalFee: number) {
    const updated = [...procedures]
    updated[i] = {
      cdtCode: code,
      cdtDescription: description,
      procedureFee: updated[i].procedureFee || typicalFee.toString(),
    }
    setProcedures(updated)
    setResult(null)
  }

  const calculate = useCallback(async () => {
    if (!carrierCode) {
      showToast('error', 'Please select a carrier')
      return
    }
    const valid = procedures.filter(p => p.cdtCode.trim() && parseFloat(p.procedureFee) > 0)
    if (valid.length === 0) {
      showToast('error', 'Add at least one procedure with a CDT code and fee')
      return
    }

    setLoading(true)
    setResult(null)

    try {
      const payload: Record<string, unknown> = {
        carrierCode,
        procedures: valid.map(p => ({
          cdtCode: p.cdtCode.trim().toUpperCase(),
          cdtDescription: p.cdtDescription || p.cdtCode.trim().toUpperCase(),
          procedureFee: parseFloat(p.procedureFee),
        })),
        deductiblePaid: parseFloat(deductiblePaid) || 0,
        annualMaxUsed: parseFloat(annualMaxUsed) || 0,
      }
      if (patientToken.trim()) payload.patientToken = patientToken.trim()

      const data = await api.post<{ success: boolean; result: Phase3MultiEstimateResult }>(
        '/api/estimates/multi',
        payload
      )
      setResult(data.result)
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [carrierCode, procedures, deductiblePaid, annualMaxUsed, patientToken, showToast])

  const selectedCarrier = CARRIERS.find(c => c.code === carrierCode)
  const hasWarnings = result?.procedures.some(p => p.notCovered || p.frequencyLimited || p.waitingPeriodActive)

  return (
    <main role="main" aria-label="Pre-treatment estimate">
      <Toast toast={toast} onDismiss={dismissToast} />

      {/* Page header */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h2 style={{ marginBottom: '0.25rem' }}>Pre-Treatment Estimate</h2>
            <p style={{ color: 'var(--gray-500)', fontSize: '0.875rem', margin: 0 }}>
              Calculate patient out-of-pocket costs before treatment. Supports all 6 Canadian carriers.
            </p>
          </div>
          {result && (
            <button
              className="btn btn-secondary"
              onClick={() => window.print()}
              style={{ flexShrink: 0 }}
            >
              🖨 Print Estimate
            </button>
          )}
        </div>
      </div>

      <div className="estimate-layout">

        {/* ── Left: Form ──────────────────────────────────────────────────────── */}
        <div className="estimate-form">

          {/* Patient & Carrier card */}
          <div className="card">
            <h3 style={{ marginBottom: '1rem' }}>Patient &amp; Carrier</h3>

            <div className="estimate-form-grid">
              {/* Carrier dropdown */}
              <div>
                <label htmlFor="carrier-select" style={{ display: 'block', fontWeight: 500, fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                  Carrier <span style={{ color: '#DC2626' }}>*</span>
                </label>
                <select
                  id="carrier-select"
                  value={carrierCode}
                  onChange={e => { setCarrierCode(e.target.value); setResult(null) }}
                  style={{ width: '100%' }}
                  aria-required="true"
                >
                  <option value="">— Select carrier —</option>
                  {CARRIERS.map(c => (
                    <option key={c.code} value={c.code}>{c.name}</option>
                  ))}
                </select>
              </div>

              {/* Patient token */}
              <div>
                <label htmlFor="patient-token" style={{ display: 'block', fontWeight: 500, fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                  Patient Token <span style={{ color: 'var(--gray-400)', fontWeight: 400 }}>(optional — auto-loads benefits)</span>
                </label>
                <input
                  id="patient-token"
                  type="text"
                  value={patientToken}
                  onChange={e => setPatientToken(e.target.value)}
                  placeholder="Patient token or leave blank for manual"
                />
              </div>
            </div>

            {/* Manual benefit override */}
            <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label htmlFor="deductible-paid" style={{ display: 'block', fontWeight: 500, fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                  Deductible Already Paid ($)
                </label>
                <input
                  id="deductible-paid"
                  type="number"
                  min="0"
                  value={deductiblePaid}
                  onChange={e => { setDeductiblePaid(e.target.value); setResult(null) }}
                  placeholder="0"
                />
              </div>
              <div>
                <label htmlFor="annual-max-used" style={{ display: 'block', fontWeight: 500, fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                  Annual Max Already Used ($)
                </label>
                <input
                  id="annual-max-used"
                  type="number"
                  min="0"
                  value={annualMaxUsed}
                  onChange={e => { setAnnualMaxUsed(e.target.value); setResult(null) }}
                  placeholder="0"
                />
              </div>
            </div>

            {/* Carrier summary chip */}
            {selectedCarrier && (
              <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.8rem', background: 'rgba(16,185,129,0.08)', color: '#059669', borderRadius: 6, padding: '3px 10px', fontWeight: 500 }}>
                  ✓ {selectedCarrier.name}
                </span>
              </div>
            )}
          </div>

          {/* Treatment plan card */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ marginBottom: 0 }}>Treatment Plan</h3>
              <button className="btn btn-secondary" onClick={addProcedure} style={{ fontSize: '0.85rem' }}>
                + Add Procedure
              </button>
            </div>

            {procedures.map((proc, i) => (
              <div key={i} style={{ marginBottom: '0.75rem', padding: '0.75rem', background: 'rgba(0,0,0,0.02)', borderRadius: 8, border: '1px solid rgba(0,0,0,0.05)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.375rem' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--gray-400)', minWidth: 28 }}>#{i + 1}</span>
                  {procedures.length > 1 && (
                    <button
                      className="btn btn-danger"
                      onClick={() => removeProcedure(i)}
                      aria-label={`Remove procedure ${i + 1}`}
                      style={{ padding: '2px 8px', fontSize: '0.8rem', marginLeft: 'auto' }}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <CdtSearch
                    value={proc.cdtCode ? `${proc.cdtCode}${proc.cdtDescription ? ' — ' + proc.cdtDescription : ''}` : ''}
                    onChange={(code, desc, fee) => setCode(i, code, desc, fee)}
                    index={i}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexShrink: 0 }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--gray-500)' }}>Fee $</span>
                    <input
                      type="number"
                      min="0"
                      value={proc.procedureFee}
                      onChange={e => updateFee(i, e.target.value)}
                      placeholder="0.00"
                      aria-label={`Procedure ${i + 1} fee`}
                      style={{ width: 100 }}
                    />
                  </div>
                </div>
              </div>
            ))}

            <button
              className="btn btn-success"
              onClick={calculate}
              disabled={loading || !carrierCode}
              aria-busy={loading}
              style={{ width: '100%', marginTop: '0.5rem', padding: '0.75rem', fontSize: '1rem', fontWeight: 600 }}
            >
              {loading ? 'Calculating…' : 'Calculate Estimate'}
            </button>
          </div>

          {/* ── Results ──────────────────────────────────────────────────────── */}
          {result && (
            <div className="card" role="region" aria-label="Estimate results" aria-live="polite">
              <h3 style={{ marginBottom: '1rem' }}>Estimate Results</h3>

              {/* Summary metrics */}
              <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="stat-card">
                  <h3>Total Fees</h3>
                  <div className="value">{fmtCAD(result.totalFee)}</div>
                </div>
                <div className="stat-card">
                  <h3>Est. Insurance</h3>
                  <div className="value" style={{ color: '#059669' }}>{fmtCAD(result.totalInsurancePays)}</div>
                </div>
                <div className="stat-card">
                  <h3>Patient Pays</h3>
                  <div className="value" style={{ color: result.totalPatientPays > 0 ? '#92400E' : '#059669' }}>
                    {fmtCAD(result.totalPatientPays)}
                  </div>
                </div>
              </div>

              {/* Warning banner */}
              {hasWarnings && (
                <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.875rem', color: '#92400E' }}>
                  <strong>⚠ Some procedures have coverage restrictions.</strong> Click a row below to see details.
                </div>
              )}

              {/* Per-procedure table */}
              <div style={{ overflowX: 'auto' }}>
                <table role="table" aria-label="Procedure estimate breakdown">
                  <caption className="sr-only">Estimated coverage and cost per procedure</caption>
                  <thead>
                    <tr>
                      <th scope="col">Procedure</th>
                      <th scope="col" style={{ textAlign: 'right' }}>Fee</th>
                      <th scope="col" style={{ textAlign: 'right' }}>Coverage</th>
                      <th scope="col" style={{ textAlign: 'right' }}>Ins. Pays</th>
                      <th scope="col" style={{ textAlign: 'right' }}>Patient</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.procedures.map((proc, i) => (
                      <ProcedureResultRow key={i} proc={proc} />
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ fontWeight: 700, borderTop: '2px solid rgba(0,0,0,0.1)' }}>
                      <td>Total</td>
                      <td style={{ textAlign: 'right' }}>{fmtCAD(result.totalFee)}</td>
                      <td />
                      <td style={{ textAlign: 'right', color: '#059669' }}>{fmtCAD(result.totalInsurancePays)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtCAD(result.totalPatientPays)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Remaining benefits */}
              <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div style={{ background: 'rgba(16,185,129,0.06)', borderRadius: 8, padding: '0.75rem', border: '1px solid rgba(16,185,129,0.15)' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.25rem' }}>Annual Max Remaining</div>
                  <div style={{ fontWeight: 700, fontSize: '1.1rem', color: result.finalAnnualMaxRemaining > 0 ? '#059669' : '#DC2626' }}>
                    {fmtCAD(result.finalAnnualMaxRemaining)}
                  </div>
                </div>
                <div style={{ background: 'rgba(16,185,129,0.06)', borderRadius: 8, padding: '0.75rem', border: '1px solid rgba(16,185,129,0.15)' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.25rem' }}>Deductible Remaining</div>
                  <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#059669' }}>
                    {fmtCAD(result.finalDeductibleRemaining)}
                  </div>
                </div>
              </div>

              {/* Disclaimer */}
              <p style={{ marginTop: '1rem', fontSize: '0.75rem', color: 'var(--gray-400)', lineHeight: 1.5 }}>
                This estimate is based on standard carrier benefit tables. Actual insurance payment may vary due to UCR limitations,
                alternate benefit clauses, coordination of benefits, and final claim adjudication. Always verify with the carrier.
              </p>
            </div>
          )}
        </div>

        {/* ── Right: Quick reference sidebar ──────────────────────────────── */}
        <div className="estimate-sidebar">
          <div className="card">
            <h3 style={{ marginBottom: '1rem' }}>Carrier Quick Reference</h3>
            {CARRIERS.map(carrier => (
              <div
                key={carrier.code}
                onClick={() => { setCarrierCode(carrier.code); setResult(null) }}
                style={{
                  padding: '0.5rem 0.75rem', borderRadius: 6, cursor: 'pointer',
                  background: carrierCode === carrier.code ? 'rgba(16,185,129,0.1)' : 'transparent',
                  border: `1px solid ${carrierCode === carrier.code ? '#10B981' : 'transparent'}`,
                  marginBottom: '0.25rem', fontSize: '0.875rem', fontWeight: carrierCode === carrier.code ? 600 : 400,
                  color: carrierCode === carrier.code ? '#059669' : 'var(--gray-700)',
                  transition: 'all 0.15s',
                }}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && setCarrierCode(carrier.code)}
                aria-pressed={carrierCode === carrier.code}
              >
                {carrier.name}
              </div>
            ))}
          </div>

          <div className="card" style={{ marginTop: '1rem' }}>
            <h3 style={{ marginBottom: '0.75rem' }}>Coverage Categories</h3>
            {[
              { key: 'preventive', desc: 'Exams, x-rays, cleanings, fluoride, sealants', range: 'D0xxx, D1xxx' },
              { key: 'basic',      desc: 'Fillings, RCT, extractions, periodontics', range: 'D2xxx–D4xxx, D7xxx' },
              { key: 'major',      desc: 'Crowns, dentures, implants, bridges', range: 'D5xxx, D6xxx' },
              { key: 'orthodontic',desc: 'Braces, aligners', range: 'D8xxx' },
            ].map(({ key, desc, range }) => {
              const badge = coverageCategoryBadge(key)
              return (
                <div key={key} style={{ marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '0.7rem', background: badge.color + '18', color: badge.color, borderRadius: 4, padding: '1px 6px', fontWeight: 600, marginRight: 6 }}>
                    {badge.label}
                  </span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--gray-500)' }}>{desc}</span>
                  <div style={{ fontSize: '0.7rem', color: 'var(--gray-400)', marginLeft: 2, marginTop: '0.1rem' }}>{range}</div>
                </div>
              )
            })}
          </div>

          {/* Common procedures quick pick */}
          <div className="card" style={{ marginTop: '1rem' }}>
            <h3 style={{ marginBottom: '0.75rem' }}>Common Procedures</h3>
            {[
              { code: 'D0120', desc: 'Periodic Exam',      fee: 65 },
              { code: 'D0272', desc: 'Bitewings × 2',      fee: 55 },
              { code: 'D1110', desc: 'Adult Cleaning',      fee: 110 },
              { code: 'D2391', desc: 'Composite (1 surf)',  fee: 175 },
              { code: 'D2750', desc: 'Crown (PFM)',         fee: 1150 },
              { code: 'D3330', desc: 'RCT — Molar',        fee: 1050 },
              { code: 'D4341', desc: 'SRP / Quadrant',     fee: 280 },
              { code: 'D7140', desc: 'Simple Extraction',  fee: 165 },
            ].map(item => (
              <button
                key={item.code}
                className="btn btn-secondary"
                style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: '0.25rem', fontSize: '0.8rem', padding: '0.35rem 0.6rem', textAlign: 'left' }}
                onClick={() => {
                  const emptyIdx = procedures.findIndex(p => !p.cdtCode)
                  const targetIdx = emptyIdx >= 0 ? emptyIdx : procedures.length
                  if (emptyIdx < 0) {
                    setProcedures([...procedures, { cdtCode: item.code, cdtDescription: item.desc, procedureFee: item.fee.toString() }])
                  } else {
                    setCode(targetIdx, item.code, item.desc, item.fee)
                  }
                  setResult(null)
                }}
              >
                <span><strong style={{ fontFamily: 'monospace' }}>{item.code}</strong> — {item.desc}</span>
                <span style={{ color: 'var(--gray-400)' }}>{fmtCAD(item.fee)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </main>
  )
}
