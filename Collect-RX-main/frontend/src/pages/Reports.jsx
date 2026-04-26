import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { api } from '../api'

const BUCKETS = ['0_29', '30_59', '60_89', '90_119', '120_plus']
const BUCKET_LABELS = { '0_29': '0-29', '30_59': '30-59', '60_89': '60-89', '90_119': '90-119', '120_plus': '120+' }
const BUCKET_COLORS = { '0_29': '#0ea5e9', '30_59': '#f59e0b', '60_89': '#f97316', '90_119': '#ef4444', '120_plus': '#7f1d1d' }

function fmt(n) {
  const num = parseFloat(n) || 0
  if (num >= 1000) return `$${(num / 1000).toFixed(1)}k`
  return `$${num.toFixed(0)}`
}

export default function Reports() {
  const [report, setReport] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getAgingReport()
      .then(res => setReport(res.report || []))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="p-8 text-gray-400">Loading...</div>

  const totalOutstanding = report.reduce((sum, r) => sum + parseFloat(r.total_outstanding || 0), 0)
  const chartData = report.slice(0, 10).map(r => ({
    name: r.carrier_name?.replace(' Life Insurance', '').replace(' Insurance', ''),
    total: parseFloat(r.total_outstanding || 0),
  }))

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Aging Report</h1>
        <span className="text-lg font-bold text-sky-600">{fmt(totalOutstanding)} total outstanding</span>
      </div>

      {/* Bar chart */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h2 className="font-semibold text-sm text-gray-700 mb-4">Outstanding by Carrier</h2>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 0, right: 0, left: 10, bottom: 40 }}>
            <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" interval={0} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
            <Tooltip formatter={v => [`$${parseFloat(v).toFixed(2)}`, 'Outstanding']} />
            <Bar dataKey="total" radius={[4, 4, 0, 0]}>
              {chartData.map((_, i) => <Cell key={i} fill="#0ea5e9" />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Carrier</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Claims</th>
              {BUCKETS.map(b => (
                <th key={b} className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide" style={{ color: BUCKET_COLORS[b] }}>
                  {BUCKET_LABELS[b]}
                </th>
              ))}
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wide">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {report.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No data yet.</td></tr>
            ) : report.map(r => (
              <tr key={r.carrier_name} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{r.carrier_name}</td>
                <td className="px-4 py-3 text-right text-gray-500">{r.total_claims}</td>
                {BUCKETS.map(b => (
                  <td key={b} className="px-4 py-3 text-right text-gray-700">{fmt(r[b])}</td>
                ))}
                <td className="px-4 py-3 text-right font-semibold text-gray-900">{fmt(r.total_outstanding)}</td>
              </tr>
            ))}
          </tbody>
          {report.length > 0 && (
            <tfoot className="bg-gray-50 border-t border-gray-200">
              <tr>
                <td className="px-4 py-3 font-semibold text-gray-900">Total</td>
                <td className="px-4 py-3 text-right font-semibold text-gray-700">
                  {report.reduce((s, r) => s + parseInt(r.total_claims || 0), 0)}
                </td>
                {BUCKETS.map(b => (
                  <td key={b} className="px-4 py-3 text-right font-semibold text-gray-700">
                    {fmt(report.reduce((s, r) => s + parseFloat(r[b] || 0), 0))}
                  </td>
                ))}
                <td className="px-4 py-3 text-right font-bold text-sky-700">{fmt(totalOutstanding)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
