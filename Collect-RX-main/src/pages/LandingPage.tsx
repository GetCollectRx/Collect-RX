import { useState, usEffect, useRef } from 'react'

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=Fraunces:ital,opsz,wght@0,9..144,300;1,9..144,300&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:      #FFFFFF;
    --bg-off:  #F8F9FB;
    --bg-teal: #F0F7F4;
    --border:  #E5E9F0;
    --ink:     #0F1C2E;
    --ink2:    #5A6478;
    --ink3:    #8892A0;
    --teal:    #0A6B4F;
    --teal2:   #128060;
    --teal-lt: #E6F4EE;
    --amber:   #B86C2A;
    --red:     #DC3545;
    --gold:    #F59E0B;
    --font:    'Plus Jakarta Sans', system-ui, sans-serif;
    --serif:   'Fraunces', Georgia, serif;
  }

  .lp { background: var(--bg); color: var(--ink); font-family: var(--font); font-weight: 400; line-height: 1.6; overflow-x: hidden; }

  /* ── Nav ── */
  .lp-nav {
    position: fixed; top: 0; left: 0; right: 0; z-index: 200;
    background: rgba(255,255,255,0.96);
    border-bottom: 1px solid var(--border);
    backdrop-filter: blur(12px);
  }
  .lp-nav-inner {
    max-width: 1180px; margin: 0 auto;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 32px; height: 64px;
  }
  .lp-wordmark { display: flex; align-items: center; gap: 10px; }
  .lp-wordmark-icon {
    width: 32px; height: 32px; border-radius: 8px;
    background: var(--teal);
    display: flex; align-items: center; justify-content: center;
  }
  .lp-wordmark-icon svg { width: 18px; height: 18px; fill: none; stroke: #fff; stroke-width: 2; }
  .lp-wordmark-text { font-size: 17px; font-weight: 700; color: var(--ink); letter-spacing: -0.02em; }
  .lp-wordmark-text span { color: var(--teal); }
  .lp-nav-links { display: flex; align-items: center; gap: 32px; }
  .lp-nav-link { font-size: 14px; color: var(--ink2); text-decoration: none; cursor: pointer; transition: color 0.2s; }
  .lp-nav-link:hover { color: var(--ink); }
  .lp-nav-demo {
    background: var(--teal); color: #fff; border: none;
    padding: 9px 20px; border-radius: 8px;
    font-family: var(--font); font-size: 14px; font-weight: 600;
    cursor: pointer; transition: background 0.2s;
  }
  .lp-nav-demo:hover { background: var(--teal2); }

  /* ── Hero ── */
  .lp-hero {
    padding: 100px 32px 80px;
    max-width: 1180px; margin: 0 auto;
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 80px; align-items: center;
  }
  .lp-hero-tag {
    display: inline-flex; align-items: center; gap: 7px;
    background: var(--teal-lt); color: var(--teal);
    border: 1px solid rgba(10,107,79,0.18);
    padding: 5px 13px; border-radius: 100px;
    font-size: 12px; font-weight: 600;
    letter-spacing: 0.04em; text-transform: uppercase;
    margin-bottom: 24px;
  }
  .lp-hero-tag-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--teal);
    animation: lp-pulse 2s ease-in-out infinite;
  }
  @keyframes lp-pulse { 0%,100%{opacity:1;} 50%{opacity:0.4;} }
  .lp-h1 {
    font-size: clamp(36px, 4vw, 56px);
    font-weight: 700; line-height: 1.08;
    letter-spacing: -0.035em; color: var(--ink);
    margin-bottom: 22px;
  }
  .lp-h1 em { font-family: var(--serif); font-style: italic; font-weight: 300; color: var(--teal); }
  .lp-hero-sub {
    font-size: 17px; color: var(--ink2); line-height: 1.75;
    max-width: 480px; margin-bottom: 36px; font-weight: 400;
  }
  .lp-hero-btns { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 36px; }
  .lp-btn-primary {
    background: var(--teal); color: #fff; border: none;
    padding: 13px 26px; border-radius: 9px;
    font-family: var(--font); font-size: 15px; font-weight: 600;
    cursor: pointer; transition: background 0.2s, transform 0.15s;
  }
  .lp-btn-primary:hover { background: var(--teal2); transform: translateY(-1px); }
  .lp-btn-secondary {
    background: #fff; color: var(--ink); border: 1.5px solid var(--border);
    padding: 13px 26px; border-radius: 9px;
    font-family: var(--font); font-size: 15px; font-weight: 500;
    cursor: pointer; transition: border-color 0.2s;
  }
  .lp-btn-secondary:hover { border-color: var(--ink3); }
  .lp-trust-checks { display: flex; gap: 20px; flex-wrap: wrap; }
  .lp-trust-item { display: flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--ink2); }
  .lp-trust-item svg { flex-shrink: 0; }

  /* ── Claim preview panel ── */
  .lp-panel {
    background: var(--bg-off);
    border: 1px solid var(--border);
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 4px 8px rgba(0,0,0,0.04), 0 24px 64px rgba(15,28,46,0.1);
  }
  .lp-panel-topbar {
    background: #fff; border-bottom: 1px solid var(--border);
    padding: 13px 20px;
    display: flex; align-items: center; justify-content: space-between;
  }
  .lp-panel-title { font-size: 13px; font-weight: 600; color: var(--ink); }
  .lp-panel-badge {
    display: flex; align-items: center; gap: 5px;
    background: var(--teal-lt); color: var(--teal);
    border: 1px solid rgba(10,107,79,0.15);
    padding: 3px 10px; border-radius: 100px;
    font-size: 11px; font-weight: 600;
  }
  .lp-badge-dot {
    width: 5px; height: 5px; border-radius: 50%; background: var(--teal);
    animation: lp-pulse 1.5s ease-in-out infinite;
  }
  .lp-carrier-select {
    display: flex; gap: 1px;
    border-bottom: 1px solid var(--border);
    background: var(--border);
    overflow-x: auto; scrollbar-width: none;
  }
  .lp-carrier-select::-webkit-scrollbar { display: none; }
  .lp-ctab {
    flex-shrink: 0; padding: 9px 16px;
    font-size: 12px; font-weight: 500; color: var(--ink2);
    cursor: pointer; background: var(--bg-off);
    border: none; font-family: var(--font);
    white-space: nowrap; transition: background 0.15s, color 0.15s;
  }
  .lp-ctab:hover { background: #fff; color: var(--ink); }
  .lp-ctab.active { background: #fff; color: var(--teal); font-weight: 600; }
  .lp-claim-body { padding: 20px; background: #fff; }
  .lp-claim-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 14px;
    border: 1px solid var(--border); border-radius: 8px;
    margin-bottom: 8px;
    animation: lp-slidein 0.3s ease;
  }
  @keyframes lp-slidein {
    from { opacity:0; transform:translateX(-6px); }
    to   { opacity:1; transform:none; }
  }
  .lp-claim-info { display: flex; flex-direction: column; gap: 2px; }
  .lp-claim-id { font-size: 12px; font-weight: 600; color: var(--ink); }
  .lp-claim-desc { font-size: 11.5px; color: var(--ink3); }
  .lp-claim-right { display: flex; align-items: center; gap: 10px; }
  .lp-claim-amt { font-size: 13px; font-weight: 600; color: var(--ink); }
  .lp-status {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 10px; border-radius: 100px;
    font-size: 11px; font-weight: 600;
  }
  .lp-status.approved { background: #ECFDF5; color: #065F46; }
  .lp-status.pending  { background: #FFFBEB; color: #92400E; }
  .lp-status.calling  { background: var(--teal-lt); color: var(--teal); }
  .lp-status-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
  .lp-status.calling .lp-status-dot { animation: lp-pulse 1s ease-in-out infinite; }
  .lp-panel-footer {
    background: var(--bg-off);
    border-top: 1px solid var(--border);
    padding: 12px 20px;
    display: flex; align-items: center; justify-content: space-between;
  }
  .lp-panel-summary { font-size: 12px; color: var(--ink2); }
  .lp-panel-summary strong { color: var(--teal); font-weight: 600; }
  .lp-live-indicator {
    display: flex; align-items: center; gap: 5px;
    font-size: 11px; color: var(--teal); font-weight: 500;
  }
  .lp-live-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--teal); animation: lp-pulse 1.5s ease-in-out infinite; }

  /* ── Stats band ── */
  .lp-stats { background: var(--bg-off); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
  .lp-stats-inner { max-width: 1180px; margin: 0 auto; display: grid; grid-template-columns: repeat(4,1fr); }
  .lp-stat { padding: 36px 32px; border-right: 1px solid var(--border); }
  .lp-stat:last-child { border-right: none; }
  .lp-stat-num { font-size: 40px; font-weight: 700; color: var(--ink); letter-spacing: -0.04em; line-height: 1; margin-bottom: 4px; }
  .lp-stat-num span { color: var(--teal); }
  .lp-stat-lbl { font-size: 13px; color: var(--ink2); line-height: 1.45; }

  /* ── How it Works ── */
  .lp-pipeline { max-width: 1180px; margin: 0 auto; padding: 88px 32px; }
  .lp-pipeline-steps {
    display: grid; grid-template-columns: repeat(4, 1fr);
    gap: 0; margin-top: 48px; position: relative;
  }
  .lp-pipeline-steps::before {
    content: ''; position: absolute;
    top: 28px; left: calc(12.5% + 20px); right: calc(12.5% + 20px);
    height: 1px; background: var(--border);
    z-index: 0;
  }
  .lp-step { padding: 0 20px; text-align: center; position: relative; z-index: 1; }
  .lp-step-num {
    width: 56px; height: 56px; border-radius: 50%;
    background: #fff; border: 1.5px solid var(--border);
    display: flex; align-items: center; justify-content: center;
    margin: 0 auto 16px;
    box-shadow: 0 2px 8px rgba(15,28,46,0.06);
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  .lp-step-num svg { width: 22px; height: 22px; stroke: var(--teal); fill: none; stroke-width: 1.8; }
  .lp-step:hover .lp-step-num { border-color: var(--teal); box-shadow: 0 4px 16px rgba(10,107,79,0.12); }
  .lp-step-label { font-size: 13px; font-weight: 700; color: var(--ink); margin-bottom: 6px; }
  .lp-step-desc { font-size: 12.5px; color: var(--ink2); line-height: 1.6; }
  .lp-step-index {
    font-size: 10px; font-weight: 700; color: var(--teal);
    letter-spacing: 0.06em; text-transform: uppercase;
    margin-bottom: 8px; display: block;
  }

  /* ── Features ── */
  .lp-features { max-width: 1180px; margin: 0 auto; padding: 0 32px 96px; }
  .lp-section-eyebrow {
    font-size: 12px; font-weight: 700; color: var(--teal);
    letter-spacing: 0.08em; text-transform: uppercase;
    margin-bottom: 12px;
  }
  .lp-section-h2 {
    font-size: clamp(26px, 3vw, 40px);
    font-weight: 700; letter-spacing: -0.03em; color: var(--ink);
    margin-bottom: 56px; line-height: 1.15; max-width: 600px;
  }
  .lp-section-h2 em { font-family: var(--serif); font-style: italic; font-weight: 300; color: var(--teal); }
  .lp-section-sub { font-size: 15px; color: var(--ink2); max-width: 560px; margin-bottom: 56px; line-height: 1.7; margin-top: -40px; }
  .lp-feat-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 16px; }
  .lp-feat {
    background: var(--bg-off);
    border: 1px solid var(--border); border-radius: 12px;
    padding: 28px 24px;
    transition: box-shadow 0.2s, transform 0.2s, border-color 0.2s;
  }
  .lp-feat:hover { box-shadow: 0 6px 24px rgba(15,28,46,0.08); transform: translateY(-2px); border-color: rgba(10,107,79,0.18); }
  .lp-feat-icon {
    width: 40px; height: 40px; border-radius: 10px;
    background: var(--teal-lt); display: flex; align-items: center; justify-content: center;
    margin-bottom: 16px;
  }
  .lp-feat-icon svg { width: 20px; height: 20px; stroke: var(--teal); fill: none; stroke-width: 2; }
  .lp-feat-h { font-size: 14.5px; font-weight: 700; color: var(--ink); margin-bottom: 8px; letter-spacing: -0.01em; }
  .lp-feat-p { font-size: 13px; color: var(--ink2); line-height: 1.7; }

  /* ── Carriers ── */
  .lp-carriers { background: var(--bg-off); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); padding: 80px 32px; }
  .lp-carriers-inner { max-width: 1180px; margin: 0 auto; }
  .lp-carrier-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 12px; margin-top: 16px; }
  .lp-carrier-pill {
    background: #fff; border: 1.5px solid var(--border); border-radius: 10px;
    padding: 18px 20px;
    display: flex; align-items: center; justify-content: space-between;
    cursor: pointer; transition: border-color 0.2s, box-shadow 0.2s;
  }
  .lp-carrier-pill:hover { border-color: var(--teal); box-shadow: 0 2px 12px rgba(10,107,79,0.1); }
  .lp-carrier-pill.active { border-color: var(--teal); background: var(--teal-lt); }
  .lp-carrier-nm { font-size: 14px; font-weight: 500; color: var(--ink); }
  .lp-carrier-share {
    font-size: 11px; font-weight: 600; color: var(--teal);
    background: var(--teal-lt); border: 1px solid rgba(10,107,79,0.15);
    padding: 3px 9px; border-radius: 100px;
  }
  .lp-carrier-note { margin-top: 20px; font-size: 13px; color: var(--ink3); text-align: center; }

  /* ── Compliance ── */
  .lp-trust { max-width: 1180px; margin: 0 auto; padding: 88px 32px; }
  .lp-trust-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 16px; margin-top: 16px; }
  .lp-trust-card {
    background: var(--bg-off); border: 1px solid var(--border); border-radius: 12px;
    padding: 28px 20px;
    transition: border-color 0.2s;
  }
  .lp-trust-card:hover { border-color: rgba(10,107,79,0.25); }
  .lp-trust-card-icon {
    width: 44px; height: 44px; border-radius: 10px;
    background: var(--teal-lt);
    display: flex; align-items: center; justify-content: center;
    margin-bottom: 14px;
  }
  .lp-trust-card-icon svg { width: 22px; height: 22px; stroke: var(--teal); fill: none; stroke-width: 1.8; }
  .lp-trust-card-h { font-size: 14px; font-weight: 700; color: var(--ink); margin-bottom: 6px; letter-spacing: -0.01em; }
  .lp-trust-card-p { font-size: 12.5px; color: var(--ink2); line-height: 1.65; }

  /* ── CTA ── */
  .lp-cta { padding: 80px 32px; }
  .lp-cta-inner {
    max-width: 1180px; margin: 0 auto;
    background: var(--teal); border-radius: 20px; padding: 72px 64px;
    display: flex; align-items: center; justify-content: space-between;
    gap: 48px; flex-wrap: wrap;
  }
  .lp-cta-left { max-width: 560px; }
  .lp-cta-tag { font-size: 11.5px; font-weight: 700; color: rgba(255,255,255,0.6); letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 14px; }
  .lp-cta-h { font-size: clamp(26px,3vw,40px); font-weight: 700; letter-spacing: -0.03em; color: #fff; line-height: 1.15; margin-bottom: 14px; }
  .lp-cta-h em { font-family: var(--serif); font-style: italic; font-weight: 300; color: rgba(255,255,255,0.82); }
  .lp-cta-sub { font-size: 15px; color: rgba(255,255,255,0.72); line-height: 1.65; }
  .lp-cta-right { display: flex; flex-direction: column; gap: 12px; }
  .lp-cta-btn-white {
    background: #fff; color: var(--teal); border: none;
    padding: 14px 28px; border-radius: 9px;
    font-family: var(--font); font-size: 15px; font-weight: 700;
    cursor: pointer; transition: opacity 0.2s, transform 0.15s; white-space: nowrap;
  }
  .lp-cta-btn-white:hover { opacity: 0.92; transform: translateY(-1px); }
  .lp-cta-btn-ghost {
    background: rgba(255,255,255,0.1); color: #fff;
    border: 1.5px solid rgba(255,255,255,0.28);
    padding: 14px 28px; border-radius: 9px;
    font-family: var(--font); font-size: 15px; font-weight: 500;
    cursor: pointer; transition: background 0.2s; white-space: nowrap;
  }
  .lp-cta-btn-ghost:hover { background: rgba(255,255,255,0.18); }

  /* ── Footer ── */
  .lp-footer { background: var(--ink); padding: 48px 32px 32px; }
  .lp-footer-inner { max-width: 1180px; margin: 0 auto; }
  .lp-footer-top { display: flex; justify-content: space-between; gap: 32px; flex-wrap: wrap; margin-bottom: 40px; }
  .lp-footer-brand p { font-size: 13px; color: rgba(255,255,255,0.42); margin-top: 10px; max-width: 240px; line-height: 1.65; }
  .lp-footer-links { display: flex; gap: 48px; }
  .lp-footer-col h4 { font-size: 11.5px; font-weight: 700; color: rgba(255,255,255,0.45); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 14px; }
  .lp-footer-col a { display: block; font-size: 13px; color: rgba(255,255,255,0.52); text-decoration: none; margin-bottom: 9px; cursor: pointer; transition: color 0.2s; }
  .lp-footer-col a:hover { color: rgba(255,255,255,0.9); }
  .lp-footer-bottom { border-top: 1px solid rgba(255,255,255,0.07); padding-top: 24px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
  .lp-footer-bottom span { font-size: 12px; color: rgba(255,255,255,0.28); }

  /* ── Reveal ── */
  .lp-reveal { opacity:0; transform:translateY(16px); transition:opacity 0.55s ease, transform 0.55s ease; }
  .lp-reveal.visible { opacity:1; transform:none; }

  @media (max-width: 960px) {
    .lp-hero { grid-template-columns:1fr; padding:88px 24px 60px; gap:48px; }
    .lp-stats-inner { grid-template-columns:1fr 1fr; }
    .lp-stat { padding:28px 20px; }
    .lp-feat-grid { grid-template-columns:1fr 1fr; }
    .lp-carrier-grid { grid-template-columns:1fr 1fr; }
    .lp-trust-grid { grid-template-columns:1fr 1fr; }
    .lp-pipeline-steps { grid-template-columns:1fr 1fr; gap:32px; }
    .lp-pipeline-steps::before { display:none; }
    .lp-features, .lp-trust, .lp-pipeline { padding:64px 24px; }
    .lp-carriers { padding:64px 24px; }
    .lp-cta { padding:48px 24px; }
    .lp-cta-inner { padding:48px 32px; }
    .lp-nav-links { display:none; }
  }
  @media (max-width: 600px) {
    .lp-feat-grid { grid-template-columns:1fr; }
    .lp-carrier-grid { grid-template-columns:1fr; }
    .lp-trust-grid { grid-template-columns:1fr 1fr; }
    .lp-pipeline-steps { grid-template-columns:1fr 1fr; }
    .lp-stat-num { font-size:32px; }
  }
`

// ─── Data ─────────────────────────────────────────────────────────────────────

const CARRIERS = [
  { name: 'Sun Life',         share: '31%' },
  { name: 'Canada Life',      share: '22%' },
  { name: 'Manulife',         share: '12%' },
  { name: 'Green Shield',     share: '7%' },
  { name: 'RBC Insurance',    share: '4%' },
  { name: 'TELUS AdjudiCare', share: '2%' },
]

const CLAIM_DATA: Record<string, { id: string; desc: string; amt: string; status: 'approved' | 'calling' | 'pending' }[]> = {
  'Sun Life': [
    { id: '#SL-847291', desc: 'Crown — Unit 14, D2710', amt: '$1,240.00', status: 'approved' },
    { id: '#SL-847180', desc: 'Root Canal — Unit 26, D3330', amt: '$890.00', status: 'calling' },
    { id: '#SL-847055', desc: 'Scaling & Root Planing', amt: '$420.00', status: 'approved' },
    { id: '#SL-846990', desc: 'Composite Restoration', amt: '$280.00', status: 'pending' },
  ],
  'Canada Life': [
    { id: '#CL-1048231', desc: 'Full Gold Crown — D2710', amt: '$1,480.00', status: 'approved' },
    { id: '#CL-1048189', desc: 'Periodontal Maintenance', amt: '$310.00', status: 'calling' },
    { id: '#CL-1048102', desc: 'Bitewing X-rays x4', amt: '$96.00', status: 'approved' },
  ],
  'Manulife': [
    { id: '#MFC-39821', desc: 'Implant Crown — D6065', amt: '$2,100.00', status: 'calling' },
    { id: '#MFC-39799', desc: 'Extraction, Surgical', amt: '$380.00', status: 'approved' },
    { id: '#MFC-39744', desc: 'Night Guard — D9940', amt: '$560.00', status: 'pending' },
  ],
  'Green Shield': [
    { id: '#GS-20847', desc: 'Bridge Pontic — D6240', amt: '$940.00', status: 'approved' },
    { id: '#GS-20831', desc: 'Composite — Class II', amt: '$245.00', status: 'approved' },
    { id: '#GS-20810', desc: 'Recall Exam + Prophylaxis', amt: '$182.00', status: 'calling' },
  ],
  'RBC Insurance': [
    { id: '#RBC-58320', desc: 'Porcelain Crown — D2712', amt: '$1,320.00', status: 'approved' },
    { id: '#RBC-58291', desc: 'Emergency Exam + PA', amt: '$130.00', status: 'approved' },
  ],
  'TELUS AdjudiCare': [
    { id: '#TA-67021', desc: 'Scaling, per unit x4', amt: '$310.00', status: 'approved' },
    { id: '#TA-66998', desc: 'Inlay, Ceramic — D2410', amt: '$780.00', status: 'calling' },
  ],
}

const FEATURES = [
  {
    icon: <svg viewBox="0 0 24 24"><path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>,
    h: 'Carrier-Specific IVR Navigation',
    p: 'Each of the six carriers runs a different IVR structure. CollectRx maintains dedicated navigation paths per carrier — updated whenever systems change — so every call reaches the right queue without guesswork.',
  },
  {
    icon: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>,
    h: 'Live Claim Status Propagation',
    p: 'As each call resolves, claim state is written back to your records in real time. Pending to adjudicated to paid — your team sees current status on every outstanding claim without touching a phone.',
  },
  {
    icon: <svg viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>,
    h: 'PHI Tokenization at the Boundary',
    p: 'Patient identifiers are replaced with UUID tokens before any data reaches the AI layer. Names, dates of birth, and health card numbers never leave your server. This is architectural — not a policy document.',
  },
  {
    icon: <svg viewBox="0 0 24 24"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
    h: 'Structured Denial Escalation',
    p: 'Denied claims trigger immediate capture of the reason code. Claims are categorized, re-submission requirements are flagged, and persistent denials route to human review. Nothing falls through.',
  },
  {
    icon: <svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><path d="M8 21h8M12 17v4" /></svg>,
    h: 'Direct PMS Integration',
    p: 'CollectRx pulls outstanding claims directly from Abeldent and other leading dental practice management platforms. The follow-up queue stays in sync automatically — no manual entry, no duplicate data.',
  },
  {
    icon: <svg viewBox="0 0 24 24"><path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
    h: 'AR Intelligence Reporting',
    p: 'Weekly summaries show collected revenue, pending adjudication by carrier, denial rates over time, and claims requiring human attention. Understand your AR position precisely — not just in aggregate.',
  },
]

const TRUST = [
  {
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
    h: 'PHIPA Architecture',
    p: 'Patient health information is tokenized before it reaches the AI layer. Compliance is enforced structurally — independent of policy or configuration.',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20" />
      </svg>
    ),
    h: 'PIPEDA Compliant',
    p: 'Built to Canadian federal privacy standards. Data residency, consent handling, and subject access rights are part of the platform — not bolt-ons.',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
        <path d="M3 12v7" />
        <path d="M21 12v7" />
        <path d="M12 8v2M12 14v2" />
      </svg>
    ),
    h: 'PHI On Your Infrastructure',
    p: 'No patient identifiers are transmitted to any external service or US-hosted AI. Health data stays within your system boundaries — always.',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <path d="M12 14v3M10.5 14h3" />
      </svg>
    ),
    h: 'Business Hours Enforcement',
    p: 'All carrier calls are placed Mon–Fri, 8am–5pm Eastern. Call frequency limits and scheduling windows are system-enforced — not a configuration option.',
  },
]

const PIPELINE_STEPS = [
  {
    icon: <svg viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>,
    label: 'Claim Detected',
    desc: 'Outstanding claims pulled from your PMS automatically. No manual entry.',
  },
  {
    icon: <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>,
    label: 'PHI Removed',
    desc: 'Patient identifiers replaced with secure UUID tokens before any AI processing.',
  },
  {
    icon: <svg viewBox="0 0 24 24"><path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>,
    label: 'Carrier Called',
    desc: 'AI navigates the carrier\'s IVR, speaks with reps, and captures adjudication status.',
  },
  {
    icon: <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>,
    label: 'Status Written Back',
    desc: 'Result recorded — approved, denied with reason code, or escalated for human review.',
  },
]

// ─── Hooks ─────────────────────────────────────────────────────────────────────

function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('.lp-reveal')
    const obs = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible') }),
      { threshold: 0.1 }
    )
    els.forEach(el => obs.observe(el))
    return () => obs.disconnect()
  }, [])
}

function useCounter(target: number) {
  const [val, setVal] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const obs = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return
      obs.disconnect()
      const start = performance.now()
      const dur = 1400
      const tick = (now: number) => {
        const p = Math.min((now - start) / dur, 1)
        setVal(Math.round(p * p * target))
        if (p < 1) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }, { threshold: 0.5 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [target])
  return { val, ref }
}

// ─── Claim Panel ───────────────────────────────────────────────────────────────

function ClaimPanel({ active, onSelect }: { active: number; onSelect: (i: number) => void }) {
  const carrier = CARRIERS[active]
  const claims = CLAIM_DATA[carrier.name] ?? []
  const approved = claims.filter(c => c.status === 'approved').length
  const total = claims.reduce((s, c) => s + parseFloat(c.amt.replace(/[$,]/g, '')), 0)

  return (
    <div className="lp-panel">
      <div className="lp-panel-topbar">
        <span className="lp-panel-title">Outstanding Claims</span>
        <div className="lp-panel-badge"><div className="lp-badge-dot" />AI Running</div>
      </div>
      <div className="lp-carrier-select">
        {CARRIERS.map((c, i) => (
          <button key={c.name} className={`lp-ctab${i === active ? ' active' : ''}`} onClick={() => onSelect(i)}>
            {c.name}
          </button>
        ))}
      </div>
      <div className="lp-claim-body">
        {claims.map((c, i) => (
          <div className="lp-claim-row" key={c.id} style={{ animationDelay: `${i * 60}ms` }}>
            <div className="lp-claim-info">
              <span className="lp-claim-id">{c.id}</span>
              <span className="lp-claim-desc">{c.desc}</span>
            </div>
            <div className="lp-claim-right">
              <span className="lp-claim-amt">{c.amt}</span>
              <span className={`lp-status ${c.status}`}>
                <span className="lp-status-dot" />
                {c.status === 'approved' ? 'Approved' : c.status === 'calling' ? 'Calling' : 'Pending'}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="lp-panel-footer">
        <span className="lp-panel-summary">
          <strong>{approved} of {claims.length}</strong> resolved &middot; <strong>${total.toLocaleString('en-CA', { minimumFractionDigits: 2 })}</strong> total
        </span>
        <div className="lp-live-indicator"><div className="lp-live-dot" />Live</div>
      </div>
    </div>
  )
}

// ─── Stat Counter ─────────────────────────────────────────────────────────────

function StatNum({ target, suffix, label }: { target: number; suffix: string; label: string }) {
  const { val, ref } = useCounter(target)
  return (
    <div className="lp-stat" ref={ref}>
      <div className="lp-stat-num">{val.toLocaleString()}<span>{suffix}</span></div>
      <div className="lp-stat-lbl">{label}</div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const [active, setActive] = useState(0)
  useReveal()

  const to = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })

  return (
    <>
      <style>{STYLES}</style>
      <div className="lp">

        {/* Nav */}
        <nav className="lp-nav">
          <div className="lp-nav-inner">
            <div className="lp-wordmark">
              <div className="lp-wordmark-icon">
                <svg viewBox="0 0 24 24"><path d="M12 2l9 4v6c0 5-3.9 9.7-9 11-5.1-1.3-9-6-9-11V6l9-4z" /></svg>
              </div>
              <span className="lp-wordmark-text">Collect<span>Rx</span></span>
            </div>
            <div className="lp-nav-links">
              <span className="lp-nav-link" onClick={() => to('lp-pipeline')}>How it Works</span>
              <span className="lp-nav-link" onClick={() => to('lp-features')}>Features</span>
              <span className="lp-nav-link" onClick={() => to('lp-carriers')}>Carriers</span>
              <span className="lp-nav-link" onClick={() => to('lp-trust')}>Compliance</span>
            </div>
            <button className="lp-nav-demo" onClick={() => to('lp-cta')}>Request Access</button>
          </div>
        </nav>

        {/* Hero */}
        <section className="lp-hero">
          <div>
            <div className="lp-hero-tag"><div className="lp-hero-tag-dot" />Canadian Dental AR Automation</div>
            <h1 className="lp-h1">Your insurance AR,<br /><em>fully automated.</em></h1>
            <p className="lp-hero-sub">
              CollectRx runs outstanding claims through a complete follow-up pipeline —
              carrier-specific IVR navigation, live adjudication tracking, and denial escalation —
              without your staff on hold.
            </p>
            <div className="lp-hero-btns">
              <button className="lp-btn-primary" onClick={() => to('lp-cta')}>Request Early Access</button>
              <button className="lp-btn-secondary" onClick={() => to('lp-pipeline')}>How it Works</button>
            </div>
            <div className="lp-trust-checks">
              {['PHIPA compliant by design', 'Six major Canadian carriers', 'No IT setup required'].map(t => (
                <div className="lp-trust-item" key={t}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2.5"><path d="M5 13l4 4L19 7" /></svg>
                  {t}
                </div>
              ))}
            </div>
          </div>
          <ClaimPanel active={active} onSelect={setActive} />
        </section>

        {/* Stats */}
        <div className="lp-stats lp-reveal">
          <div className="lp-stats-inner">
            <StatNum target={6}  suffix=" carriers"  label="Major Canadian carriers integrated" />
            <StatNum target={78} suffix="%"           label="Private dental market covered" />
            <StatNum target={12} suffix="h"           label="Front-desk hours recovered per week" />
            <StatNum target={3}  suffix=" attempts"   label="Maximum per claim before escalation" />
          </div>
        </div>

        {/* How it Works */}
        <section className="lp-pipeline lp-reveal" id="lp-pipeline">
          <div className="lp-section-eyebrow">How it Works</div>
          <h2 className="lp-section-h2">Four steps.<br /><em>Zero staff time.</em></h2>
          <div className="lp-pipeline-steps">
            {PIPELINE_STEPS.map((s, i) => (
              <div className="lp-step" key={s.label}>
                <span className="lp-step-index">Step {i + 1}</span>
                <div className="lp-step-num">{s.icon}</div>
                <div className="lp-step-label">{s.label}</div>
                <div className="lp-step-desc">{s.desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section className="lp-features" id="lp-features">
          <div className="lp-reveal">
            <div className="lp-section-eyebrow">Platform</div>
            <h2 className="lp-section-h2">Built for the specific realities<br />of <em>Canadian dental AR.</em></h2>
          </div>
          <div className="lp-feat-grid">
            {FEATURES.map((f, i) => (
              <div className="lp-feat lp-reveal" key={f.h} style={{ transitionDelay: `${i * 60}ms` }}>
                <div className="lp-feat-icon">{f.icon}</div>
                <div className="lp-feat-h">{f.h}</div>
                <div className="lp-feat-p">{f.p}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Carriers */}
        <div className="lp-carriers" id="lp-carriers">
          <div className="lp-carriers-inner">
            <div className="lp-reveal">
              <div className="lp-section-eyebrow">Carrier Coverage</div>
              <h2 className="lp-section-h2" style={{ marginBottom: 8 }}>Six carriers.<br /><em>78% of the market.</em></h2>
              <p style={{ fontSize: 14, color: 'var(--ink2)', marginBottom: 32, lineHeight: 1.7 }}>
                Each integration handles the full call workflow for that carrier — IVR navigation, hold patterns, rep protocols, and status formats.
                Select a carrier to preview how CollectRx processes its claims.
              </p>
            </div>
            <div className="lp-carrier-grid lp-reveal">
              {CARRIERS.map((c, i) => (
                <div
                  key={c.name}
                  className={`lp-carrier-pill${i === active ? ' active' : ''}`}
                  onClick={() => { setActive(i); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                >
                  <span className="lp-carrier-nm">{c.name}</span>
                  <span className="lp-carrier-share">{c.share} market share</span>
                </div>
              ))}
            </div>
            <p className="lp-carrier-note lp-reveal">Together these carriers represent approximately 78% of Canadian private dental insurance.</p>
          </div>
        </div>

        {/* Compliance */}
        <section className="lp-trust" id="lp-trust">
          <div className="lp-reveal">
            <div className="lp-section-eyebrow">Compliance</div>
            <h2 className="lp-section-h2" style={{ marginBottom: 8 }}>Compliance is architecture,<br /><em>not policy.</em></h2>
            <p style={{ fontSize: 15, color: 'var(--ink2)', marginBottom: 40, lineHeight: 1.75, maxWidth: 520 }}>
              In healthcare, privacy cannot be an add-on. Every design decision in CollectRx — from how claims are ingested to how calls are scheduled — treats PHI protection as a structural requirement.
            </p>
          </div>
          <div className="lp-trust-grid lp-reveal">
            {TRUST.map(t => (
              <div className="lp-trust-card" key={t.h}>
                <div className="lp-trust-card-icon">{t.icon}</div>
                <div className="lp-trust-card-h">{t.h}</div>
                <div className="lp-trust-card-p">{t.p}</div>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <div className="lp-cta" id="lp-cta">
          <div className="lp-cta-inner lp-reveal">
            <div className="lp-cta-left">
              <div className="lp-cta-tag">Early Access</div>
              <h2 className="lp-cta-h">The AR work is already<br /><em>getting done.</em></h2>
              <p className="lp-cta-sub">
                Pilot launching with select Canadian dental practices. No setup fees. No long-term contract.
                If CollectRx doesn't recover revenue you were already leaving behind, you pay nothing.
              </p>
            </div>
            <div className="lp-cta-right">
              <button className="lp-cta-btn-white">Request Early Access</button>
              <button className="lp-cta-btn-ghost">Book a Demo</button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="lp-footer">
          <div className="lp-footer-inner">
            <div className="lp-footer-top">
              <div className="lp-footer-brand">
                <span className="lp-wordmark-text" style={{ fontSize: 16 }}>Collect<span style={{ color: 'rgba(255,255,255,0.55)' }}>Rx</span></span>
                <p>Dental insurance AR automation for Canadian practices.</p>
              </div>
              <div className="lp-footer-links">
                <div className="lp-footer-col">
                  <h4>Platform</h4>
                  <a onClick={() => to('lp-pipeline')}>How it Works</a>
                  <a onClick={() => to('lp-features')}>Features</a>
                  <a onClick={() => to('lp-carriers')}>Carriers</a>
                  <a onClick={() => to('lp-trust')}>Compliance</a>
                </div>
                <div className="lp-footer-col">
                  <h4>Company</h4>
                  <a>About</a>
                  <a onClick={() => to('lp-cta')}>Contact</a>
                  <a href="/legal/terms">Terms</a>
                  <a href="/legal/privacy">Privacy</a>
                </div>
              </div>
            </div>
            <div className="lp-footer-bottom">
              <span>© 2026 CollectRx Inc. All rights reserved.</span>
              <span>Built for Canadian dental</span>
            </div>
          </div>
        </footer>

      </div>
    </>
  )
}
