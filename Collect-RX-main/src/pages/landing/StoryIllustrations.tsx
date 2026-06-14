/**
 * Unified story scene, shared dental reception desk, recurring admin (Maria),
 * and act-specific layers that morph in place.
 */

export type StoryAct = 0 | 1 | 2 | 3 | 4
export type AdminPose = 'neutral' | 'stressed' | 'stepped-back' | 'welcoming'

export type StorySceneProps = {
  act: StoryAct
  live?: boolean
  agentIndex?: number
  holdTimer?: string
  money?: number
  hours?: number
  agingDays?: number
}

const VB = '0 0 480 360'
const UID = 'crx'

const CLAIMS = [
  { id: '#SL-847291', amt: '$1,240', days: 47 },
  { id: '#CL-1048189', amt: '$890', days: 62 },
  { id: '#MFC-39744', amt: '$560', days: 78 },
  { id: '#GS-20810', amt: '$2,100', days: 94 },
]

const AGENTS = [
  { key: 'ivr', label: 'IVR', full: 'Navigator', x: 108, color: '#60605f' },
  { key: 'claims', label: 'Claims', full: 'Agent', x: 198, color: '#3b7fd4' },
  { key: 'esc', label: 'Escalate', full: 'Closer', x: 288, color: '#c98f12' },
  { key: 'res', label: 'Resolve', full: 'Closer', x: 378, color: '#0f9d58' },
]

function fmtMoney(n: number) {
  return `$${n.toLocaleString('en-CA')}`
}

/** Shared reception environment */
function SceneFrame({ act, caption }: { act: StoryAct; caption: string }) {
  const tint =
    act <= 1 ? 'rgba(201,143,18,0.06)' :
    act === 4 ? 'rgba(15,157,88,0.07)' :
    'rgba(15,157,88,0.04)'

  return (
    <g className="ill-frame">
      <rect x="0" y="0" width="480" height="360" fill="#f8f5ee" />
      <rect x="0" y="0" width="480" height="360" fill={tint} className="ill-tint" />
      {/* wall detail */}
      <rect x="30" y="40" width="100" height="36" rx="6" fill="#fcfcfa" stroke="#cacac8" strokeWidth="1.2" />
      <text x="80" y="62" textAnchor="middle" fontSize="9" fill="#60605f" fontFamily="Inter, system-ui" fontWeight="600">INSURANCE</text>
      {/* appointment strip */}
      <rect x="140" y="48" width="200" height="8" rx="4" fill="#ece8e0" />
      <rect x="140" y="62" width="140" height="6" rx="3" fill="#ece8e0" />
      {/* desk */}
      <rect x="24" y="248" width="432" height="12" rx="4" fill="#d4cfc4" />
      <path d="M24 248 L24 200 Q24 188 36 188 L200 188 L200 248 Z" fill="#ece8e0" stroke="#cacac8" strokeWidth="1.2" />
      <rect x="200" y="210" width="256" height="38" rx="6" fill="#f8f5ee" stroke="#cacac8" strokeWidth="1.2" />
      {/* caption bar */}
      <rect x="80" y="318" width="320" height="28" rx="14" fill="#fcfcfa" stroke="#cacac8" strokeWidth="1" />
      <text x="240" y="336" textAnchor="middle" fontSize="11" fill="#60605f" fontFamily="Inter, system-ui">{caption}</text>
    </g>
  )
}

/** Maria, recurring front-desk admin */
function AdminCharacter({ pose, live }: { pose: AdminPose; live?: boolean }) {
  const tx = pose === 'stepped-back' ? -28 : pose === 'welcoming' ? 8 : 0
  const ty = pose === 'stressed' ? 2 : 0
  const stressed = pose === 'stressed'
  const welcoming = pose === 'welcoming'

  return (
    <g className={`ill-admin ill-pose-${pose}${live ? ' live' : ''}`} transform={`translate(${tx}, ${ty})`}>
      {/* body */}
      <path d="M118 228 Q148 198 178 228" fill={welcoming ? '#0b5b47' : '#60605f'} />
      <rect x="128" y="188" width="40" height="42" rx="8" fill={welcoming ? '#0f9d58' : '#60605f'} />
      {/* head */}
      <circle cx="148" cy="172" r="20" fill="#e8e4dc" stroke={stressed ? '#c98f12' : '#cacac8'} strokeWidth={stressed ? 2 : 1.2} />
      {/* hair bun */}
      <circle cx="148" cy="158" r="10" fill="#4a4540" />
      <ellipse cx="148" cy="165" rx="18" ry="14" fill="#4a4540" />
      {/* face */}
      {stressed ? (
        <>
          <path d="M140 170 Q143 167 146 170" stroke="#60605f" fill="none" strokeWidth="1.3" />
          <path d="M150 170 Q153 167 156 170" stroke="#60605f" fill="none" strokeWidth="1.3" />
          <path d="M142 180 Q148 176 154 180" stroke="#60605f" fill="none" strokeWidth="1.3" />
        </>
      ) : welcoming ? (
        <>
          <path d="M140 170 Q143 173 146 170" stroke="#60605f" fill="none" strokeWidth="1.3" />
          <path d="M150 170 Q153 173 156 170" stroke="#60605f" fill="none" strokeWidth="1.3" />
          <path d="M142 180 Q148 184 154 180" stroke="#60605f" fill="none" strokeWidth="1.3" />
          {/* welcoming arm */}
          <path d="M168 200 Q190 185 200 195" stroke="#0f9d58" fill="none" strokeWidth="4" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx="142" cy="172" r="1.5" fill="#60605f" />
          <circle cx="154" cy="172" r="1.5" fill="#60605f" />
          <path d="M144 180 Q148 182 152 180" stroke="#60605f" fill="none" strokeWidth="1.2" />
        </>
      )}
      {/* headset when on hold */}
      {stressed && (
        <path d="M132 172 Q148 162 164 172" stroke="#60605f" fill="none" strokeWidth="2" />
      )}
      <text x="148" y="244" textAnchor="middle" fontSize="8" fill="#60605f" fontFamily="Inter, system-ui">Maria · Front Desk</text>
    </g>
  )
}

function WallClock({ live, urgent }: { live?: boolean; urgent?: boolean }) {
  return (
    <g className={`ill-clock${live ? ' live' : ''}`}>
      <circle cx="420" cy="88" r="26" fill="#fcfcfa" stroke={urgent ? '#c0392b' : '#cacac8'} strokeWidth="2" />
      <line x1="420" y1="88" x2="420" y2="72" stroke={urgent ? '#c0392b' : '#60605f'} strokeWidth="2" strokeLinecap="round" className="ill-clock-h" style={{ transformOrigin: '420px 88px' }} />
      <line x1="420" y1="88" x2="432" y2="94" stroke="#60605f" strokeWidth="1.5" strokeLinecap="round" className="ill-clock-m" style={{ transformOrigin: '420px 88px' }} />
    </g>
  )
}

function ClaimTray({ live, highlightDays }: { live?: boolean; highlightDays?: number }) {
  return (
    <g className={`ill-tray${live ? ' live' : ''}`}>
      <rect x="36" y="196" width="88" height="14" rx="4" fill="#c98f12" opacity="0.15" />
      <text x="80" y="206" textAnchor="middle" fontSize="7" fill="#c98f12" fontFamily="Inter, system-ui" fontWeight="600">OUTSTANDING</text>
      {CLAIMS.map((c, i) => {
        const hot = c.days >= (highlightDays ?? 90) - 10
        return (
          <g key={c.id} className={`ill-claim-card ill-claim-${i}`} transform={`translate(0, ${i * 3})`}>
            <rect x={42 + i * 2} y={148 + i * 10} width="76" height="36" rx="4"
              fill={hot ? '#fff8f6' : '#fcfcfa'} stroke={hot ? '#c0392b' : '#cacac8'} strokeWidth={hot ? 1.5 : 1} />
            <text x={80} y={162 + i * 10} textAnchor="middle" fontSize="7" fill="#60605f" fontFamily="DM Mono, monospace">{c.id}</text>
            <text x={80} y={174 + i * 10} textAnchor="middle" fontSize="10" fill="#1f1f1f" fontWeight="600" fontFamily="Inter, system-ui">{c.amt}</text>
            <text x={80} y={182 + i * 10} textAnchor="middle" fontSize="7" fill={hot ? '#c0392b' : '#c98f12'} fontFamily="Inter, system-ui" fontWeight="600">{c.days}d</text>
          </g>
        )
      })}
    </g>
  )
}

function ManualPhone({ visible, live, timer }: { visible: boolean; live?: boolean; timer?: string }) {
  return (
    <g className={`ill-manual-phone${visible ? ' on' : ''}${live ? ' live' : ''}`} style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.8s ease' }}>
      <rect x="268" y="198" width="34" height="52" rx="6" fill="#1f1f1f" className="ill-vibe" />
      <rect x="272" y="204" width="26" height="36" rx="4" fill="#142820" />
      {timer && <text x="285" y="226" textAnchor="middle" fontSize="7" fill="#fff" fontFamily="DM Mono, monospace">{timer}</text>}
      <path d="M285 250 L285 258" stroke="#60605f" strokeWidth="2.5" strokeLinecap="round" />
      <text x="285" y="272" textAnchor="middle" fontSize="8" fill="#60605f" fontFamily="Inter, system-ui">Manual calls</text>
    </g>
  )
}

function HoldOverlay({ visible, live, timer }: { visible: boolean; live?: boolean; timer?: string }) {
  if (!visible) return null
  return (
    <g className={`ill-hold-overlay${live ? ' live' : ''}`}>
      <rect x="310" y="118" width="148" height="88" rx="10" fill="#fcfcfa" stroke="#c98f12" strokeWidth="1.5" />
      <text x="384" y="138" textAnchor="middle" fontSize="9" fill="#60605f" fontFamily="Inter, system-ui">Sun Life · On Hold</text>
      <text x="384" y="162" textAnchor="middle" fontSize="22" fill="#c0392b" fontWeight="600" fontFamily="DM Mono, monospace">{timer ?? '8:07'}</text>
      <g className="ill-hold-bars">
        {[0, 1, 2, 3, 4].map(i => (
          <rect key={i} x={330 + i * 16} y={172} width="8" height={8 + (i % 3) * 4} rx="2" fill="#c98f12" opacity="0.5" className={`ill-hbar-${i}`} />
        ))}
      </g>
      <text x="384" y="198" textAnchor="middle" fontSize="8" fill="#c0392b" fontFamily="Inter, system-ui" fontStyle="italic">Please continue to hold…</text>
      {/* sound waves near Maria */}
      <path d="M188 168 Q196 172 188 176" stroke="#c98f12" fill="none" strokeWidth="1.5" className="ill-wave-a" />
      <path d="M194 162 Q206 172 194 182" stroke="#c98f12" fill="none" strokeWidth="1.5" className="ill-wave-b" />
    </g>
  )
}

function CollectRxPanel({ visible, expanded, live }: { visible: boolean; expanded?: boolean; live?: boolean }) {
  return (
    <g
      className={`ill-crx-panel${visible ? ' on' : ''}${expanded ? ' expanded' : ''}${live ? ' live' : ''}`}
      style={{ opacity: visible ? 1 : 0 }}
    >
      <rect x="248" y="138" width="180" height="130" rx="14" fill="#fcfcfa" stroke="#0f9d58" strokeWidth="2" className="ill-panel-glow" />
      <rect x="248" y="138" width="180" height="32" rx="14" fill="#0f9d58" />
      <rect x="248" y="156" width="180" height="14" fill="#0f9d58" />
      <circle cx="268" cy="154" r="8" fill="rgba(255,255,255,0.25)" />
      <text x="338" y="160" textAnchor="middle" fontSize="12" fill="#fcfcfa" fontWeight="600" fontFamily="Inter, system-ui">CollectRx</text>
      {!expanded && (
        <>
          <circle cx="338" cy="196" r="18" fill="rgba(15,157,88,0.12)" stroke="#0f9d58" strokeWidth="1.5" />
          <path d="M330 196 L346 196 M338 188 L338 204" stroke="#0f9d58" strokeWidth="2" strokeLinecap="round" />
          <text x="338" y="232" textAnchor="middle" fontSize="8" fill="#0b5b47" fontFamily="Inter, system-ui">Automating carrier calls</text>
          <circle cx="266" cy="252" r="3" fill="#0f9d58" className="ill-pulse-dot" />
          <text x="276" y="256" fontSize="8" fill="#0b5b47" fontFamily="Inter, system-ui">Live · 6 carriers</text>
        </>
      )}
    </g>
  )
}

function AgentPipeline({ visible, live, agentIndex = 0 }: { visible: boolean; live?: boolean; agentIndex?: number }) {
  if (!visible) return null
  const y = 168
  const pathD = `M${AGENTS[0].x},${y} L${AGENTS[1].x},${y} L${AGENTS[2].x},${y} L${AGENTS[3].x},${y}`

  return (
    <g className={`ill-pipeline${live ? ' live' : ''}`}>
      <rect x="228" y="118" width="222" height="155" rx="10" fill="rgba(15,157,88,0.04)" stroke="rgba(15,157,88,0.15)" />
      {/* connector */}
      <path d={pathD} fill="none" stroke="#cacac8" strokeWidth="2" strokeLinecap="round" />
      <path d={pathD} fill="none" stroke="#0f9d58" strokeWidth="2" strokeLinecap="round"
        strokeDasharray="8 6" className="ill-flow-track" />
      {/* traveling pulse */}
      {live && (
        <circle r="5" fill="#0f9d58" className="ill-travel-dot">
          <animateMotion dur="2.2s" repeatCount="indefinite" path={pathD} />
        </circle>
      )}
      {AGENTS.map((a, i) => {
        const active = i === agentIndex
        return (
          <g key={a.key} className={`ill-pipe-node${active ? ' active' : ''}`}>
            <circle cx={a.x} cy={y} r={active ? 22 : 18} fill={a.color} opacity={active ? 0.2 : 0.08} stroke={a.color} strokeWidth={active ? 2 : 1} />
            <circle cx={a.x} cy={y} r={active ? 11 : 9} fill={a.color} opacity={active ? 1 : 0.45} />
            <text x={a.x} y={y + 34} textAnchor="middle" fontSize="8" fill="#1f1f1f" fontWeight={active ? '600' : '500'} fontFamily="Inter, system-ui">{a.label}</text>
            <text x={a.x} y={y + 46} textAnchor="middle" fontSize="7" fill="#60605f" fontFamily="Inter, system-ui">{a.full}</text>
            {active && live && (
              <rect x={a.x - 28} y={y + 54} width="56" height="16" rx="8" fill="rgba(15,157,88,0.15)" stroke="#0f9d58" strokeWidth="1" />
            )}
            {active && live && (
              <text x={a.x} y={y + 65} textAnchor="middle" fontSize="7" fill="#0b5b47" fontFamily="Inter, system-ui" fontWeight="600">Active</text>
            )}
          </g>
        )
      })}
    </g>
  )
}

function SavingsOverlay({ visible, live, money = 0, hours = 0 }: { visible: boolean; live?: boolean; money?: number; hours?: number }) {
  if (!visible) return null
  return (
    <g className={`ill-savings${live ? ' live' : ''}`}>
      {/* patient silhouette */}
      <g className="ill-patient" transform="translate(200, 0)">
        <circle cx="230" cy="178" r="14" fill="#e8e4dc" stroke="#cacac8" />
        <path d="M214 228 Q230 200 246 228" fill="#60605f" opacity="0.6" />
      </g>
      {/* metrics floating above desk */}
      <g className="ill-metric ill-metric-time">
        <rect x="248" y="108" width="100" height="72" rx="10" fill="#fcfcfa" stroke="#0f9d58" strokeWidth="1.5" />
        <text x="298" y="128" textAnchor="middle" fontSize="8" fill="#60605f" fontFamily="Inter, system-ui" fontWeight="600">TIME SAVED</text>
        <text x="298" y="158" textAnchor="middle" fontSize="22" fill="#0b5b47" fontWeight="600" fontFamily="Source Serif 4, Georgia, serif">{hours || 208}h</text>
        <text x="298" y="172" textAnchor="middle" fontSize="7" fill="#60605f" fontFamily="Inter, system-ui">per year</text>
      </g>
      <g className="ill-metric ill-metric-money">
        <rect x="358" y="108" width="100" height="72" rx="10" fill="rgba(15,157,88,0.08)" stroke="rgba(15,157,88,0.3)" strokeWidth="1.5" />
        <text x="408" y="128" textAnchor="middle" fontSize="8" fill="#0b5b47" fontFamily="Inter, system-ui" fontWeight="600">RECOVERED</text>
        <text x="408" y="156" textAnchor="middle" fontSize="17" fill="#0b5b47" fontWeight="600" fontFamily="Source Serif 4, Georgia, serif">
          {money > 0 ? fmtMoney(money) : '$38,400'}
        </text>
        <text x="408" y="172" textAnchor="middle" fontSize="7" fill="#60605f" fontFamily="Inter, system-ui">insurance AR</text>
      </g>
      {/* AR stack turns green */}
      <g className="ill-ar-green">
        <rect x="42" y="168" width="76" height="36" rx="4" fill="rgba(15,157,88,0.1)" stroke="#0f9d58" strokeWidth="1.5" />
        <text x="80" y="182" textAnchor="middle" fontSize="7" fill="#0b5b47" fontFamily="Inter, system-ui" fontWeight="600">Resolved</text>
        <text x="80" y="196" textAnchor="middle" fontSize="10" fill="#0b5b47" fontWeight="600" fontFamily="Inter, system-ui">$4,790</text>
      </g>
    </g>
  )
}

const CAPTIONS = [
  'Manual follow-up · aging claims pile up',
  'Staff on hold · revenue waiting',
  'CollectRx replaces the manual phone queue',
  'Four agents · one seamless handoff chain',
  'Time back · revenue recovered',
]

function adminPose(act: StoryAct): AdminPose {
  if (act === 0) return 'neutral'
  if (act === 1) return 'stressed'
  if (act === 2) return 'stepped-back'
  if (act === 4) return 'welcoming'
  return 'stepped-back'
}

export default function StoryScene({
  act,
  live = false,
  agentIndex = 0,
  holdTimer = '8:07',
  money = 0,
  hours = 0,
  agingDays = 94,
}: StorySceneProps) {
  const showManualPhone = act <= 1
  const showCrxPanel = act >= 2
  const panelExpanded = act >= 3
  const showPipeline = act === 3
  const showHold = act === 1
  const showTray = act <= 1
  const showSavings = act === 4

  return (
    <svg viewBox={VB} className={`ill ill-scene ill-act-${act}${live ? ' live' : ''}`} aria-hidden="true">
      <defs>
        <linearGradient id={`${UID}-desk`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f8f5ee" />
          <stop offset="100%" stopColor="#ece8e0" />
        </linearGradient>
        <filter id={`${UID}-glow`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      <SceneFrame act={act} caption={CAPTIONS[act]} />
      <WallClock live={live} urgent={act === 1} />

      {showTray && !showSavings && <ClaimTray live={live && act === 0} highlightDays={agingDays} />}

      <AdminCharacter pose={adminPose(act)} live={live} />

      <ManualPhone visible={showManualPhone} live={live && act === 1} timer={holdTimer} />
      <HoldOverlay visible={showHold} live={live} timer={holdTimer} />

      <CollectRxPanel visible={showCrxPanel} expanded={panelExpanded} live={live && act >= 2} />
      <AgentPipeline visible={showPipeline} live={live} agentIndex={agentIndex} />
      <SavingsOverlay visible={showSavings} live={live} money={money} hours={hours} />
    </svg>
  )
}

export { StoryScene, CAPTIONS }
