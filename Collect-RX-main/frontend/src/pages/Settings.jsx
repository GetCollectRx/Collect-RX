import { useState, useEffect } from 'react'
import { api } from '../api'

export default function Settings() {
  const [practices, setPractices] = useState([])
  const [selected, setSelected]   = useState(null)
  const [form, setForm]           = useState({})
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)

  useEffect(() => {
    api.listPractices().then(res => {
      const list = res.practices || []
      setPractices(list)
      if (list[0]) {
        setSelected(list[0])
        setForm(list[0])
      }
    })
  }, [])

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    try {
      await api.updatePractice(selected.id, form)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  const fields = [
    { key: 'name',            label: 'Practice Name',        type: 'text' },
    { key: 'phone',           label: 'Phone',                type: 'text' },
    { key: 'fax',             label: 'Fax',                  type: 'text' },
    { key: 'email',           label: 'Email',                type: 'email' },
    { key: 'npi',             label: 'NPI',                  type: 'text' },
    { key: 'tax_id',          label: 'Tax ID',               type: 'text' },
    { key: 'address',         label: 'Address',              type: 'text' },
    { key: 'escalation_email',label: 'Escalation Email',     type: 'email' },
    { key: 'min_claim_value', label: 'Min Claim Value ($)',   type: 'number' },
    { key: 'min_days_outstanding', label: 'Min Days Outstanding', type: 'number' },
    { key: 'max_call_attempts',    label: 'Max Call Attempts',    type: 'number' },
    { key: 'max_calls_per_run',    label: 'Max Calls Per Run',    type: 'number' },
  ]

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      {practices.length > 1 && (
        <select
          value={selected?.id}
          onChange={e => {
            const p = practices.find(p => p.id === parseInt(e.target.value))
            setSelected(p)
            setForm(p)
          }}
          className="mb-6 border border-gray-200 rounded-lg px-3 py-2 text-sm"
        >
          {practices.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
        <h2 className="font-semibold text-gray-900 mb-2">Practice Configuration</h2>
        <div className="grid grid-cols-2 gap-4">
          {fields.map(({ key, label, type }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
              <input
                type={type}
                value={form[key] ?? ''}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          ))}
        </div>

        <div className="pt-4 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-medium rounded-lg text-sm transition-colors"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          {saved && <span className="text-sm text-green-600 font-medium">✓ Saved</span>}
        </div>
      </div>
    </div>
  )
}
