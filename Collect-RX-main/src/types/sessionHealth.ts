export type SessionHealthCheck = {
  id: string
  label: string
  ok: boolean
  detail?: string
  skipped?: boolean
}

export type SessionHealthPayload = {
  ok: boolean
  checks: SessionHealthCheck[]
  at: string
}
