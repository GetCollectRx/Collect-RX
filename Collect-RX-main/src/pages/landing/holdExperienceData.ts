export const HOLD_LOG_LINES = [
  { tag: 'ivr', text: 'Sun Life provider line · menu navigated' },
  { tag: 'claims', text: 'Rep reached · status requested' },
  { tag: 'resolution', text: 'Approved · $1,240 · ref #88421' },
  { tag: 'sync', text: 'Written back to queue · no staff action' },
] as const

export const DEMO_AGENTS = [
  {
    key: 'ivr',
    name: 'IVR Navigator',
    role: 'Gets past the phone tree',
    detail: 'Dialed Sun Life provider line · Claims → Status → Dental',
  },
  {
    key: 'claims',
    name: 'Claims Agent',
    role: 'Speaks with the carrier rep',
    detail: 'Confirmed patient, procedure date, and claim #SL-847291',
  },
  {
    key: 'escalation',
    name: 'Escalation Closer',
    role: 'Handles denials and missing info',
    detail: 'Not needed on this claim, straight to approval',
  },
  {
    key: 'resolution',
    name: 'Resolution Closer',
    role: 'Records outcome and writes back',
    detail: '$1,240 approved · EFT in 5–7 days · ref #88421 logged',
  },
] as const

export const DEMO_CLAIM = {
  id: '#SL-847291',
  desc: 'Crown, Unit 14',
  amt: '$1,240',
  carrier: 'Sun Life',
  daysOutstanding: 47,
}
