// Use VITE_API_URL env var in production (set in Lovable / Vercel / Netlify).
// Falls back to /api for local development (Vite proxy handles it).
const BASE = (import.meta.env.VITE_API_URL || '') + '/api'

async function request(method, path, body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(`${BASE}${path}`, opts)
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || `Error ${res.status}`)
  return json
}

export const api = {
  // Queue
  getQueueStats:    ()             => request('GET',  '/queue/stats'),
  buildQueue:       ()             => request('GET',  '/queue/build'),
  runQueue:         (practiceId)   => request('POST', '/queue/run', practiceId ? { practice_id: practiceId } : {}),

  // Claims
  listClaims:       (params = {})  => request('GET',  `/claims?${new URLSearchParams(params)}`),
  getClaim:         (id)           => request('GET',  `/claims/${id}`),
  pauseClaim:       (id, reason)   => request('POST', `/claims/${id}/pause`, { reason }),
  unpauseClaim:     (id)           => request('POST', `/claims/${id}/unpause`),

  // Escalations
  listEscalations:  ()             => request('GET',  '/escalations'),
  resolveEscalation:(id, notes)    => request('POST', `/escalations/${id}/resolve`, { resolutionNotes: notes }),

  // Reports
  getAgingReport:   ()             => request('GET',  '/reports/aging'),
  getCarrierStats:  ()             => request('GET',  '/carriers/stats'),

  // Practices
  listPractices:    ()             => request('GET',  '/practices'),
  getPractice:      (id)           => request('GET',  `/practices/${id}`),
  updatePractice:   (id, data)     => request('PATCH', `/practices/${id}`, data),
}
