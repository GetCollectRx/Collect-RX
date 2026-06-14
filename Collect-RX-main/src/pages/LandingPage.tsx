import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import roiAssumptions from '../config/roi-assumptions.json'

// ─── Design tokens / styles ───────────────────────────────────────────────────
// HubSpot-inspired editorial system: warm cream/parchment canvas, hairline
// borders, Source Serif 4 headlines + Inter body, single accent color
// (CollectRx green standing in for HubSpot's "sprout orange").
const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,500&family=Inter:opsz,wght@14..32,300;14..32,400;14..32,500;14..32,600&family=DM+Mono:ital,wght@0,400;0,500&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --cream:      #fcfcfa;
    --parchment:  #f8f5ee;
    --card:       #fcfcfa;

    --ink:        #1f1f1f;
    --graphite:   #60605f;
    --mist:       #cacac8;

    --green:      #0f9d58;
    --green-dark: #0b5b47;
    --green-lo:   rgba(15,157,88,0.08);
    --green-md:   rgba(15,157,88,0.14);
    --green-hi:   rgba(15,157,88,0.28);

    --gold: #c98f12;
    --blue: #3b7fd4;

    --bdr:  rgba(31,31,31,0.10);
    --bdr2: rgba(31,31,31,0.18);

    --fn: 'Inter', system-ui, sans-serif;
    --fs: 'Source Serif 4', Georgia, 'Times New Roman', serif;
    --fm: 'DM Mono', 'Fira Code', monospace;

    --radius-card: 16px;
    --radius-btn:  8px;
    --radius-badge: 4px;

    --transition: 0.2s cubic-bezier(0.4,0,0.2,1);
  }

  /* ─── BASE ─────────────────────────────────────── */
  .lp {
    background: var(--cream);
    color: var(--ink);
    font-family: var(--fn);
    font-weight: 400;
    line-height: 1.56;
    overflow-x: hidden;
    -webkit-font-smoothing: antialiased;
  }

  /* ─── NAV ───────────────────────────────────────── */
  .lp-nav {
    position: fixed; top: 0; left: 0; right: 0; z-index: 200;
    background: rgba(252,252,250,0.92);
    border-bottom: 1px solid var(--bdr);
    backdrop-filter: blur(20px) saturate(160%);
    -webkit-backdrop-filter: blur(20px) saturate(160%);
    transition: background var(--transition);
  }
  .lp-nav.scrolled { background: rgba(252,252,250,0.98); }
  .lp-nav-inner {
    max-width: 1200px; margin: 0 auto;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 40px; height: 68px;
  }
  .lp-logo { display: flex; align-items: center; gap: 10px; text-decoration: none; }
  .lp-logo-mark {
    width: 28px; height: 28px; border-radius: 8px;
    background: var(--green);
    display: grid; place-items: center; flex-shrink: 0;
  }
  .lp-logo-mark svg { width: 15px; height: 15px; fill: none; stroke: #fcfcfa; stroke-width: 2.5; }
  .lp-logo-text { font-family: var(--fn); font-size: 16px; font-weight: 600; color: var(--ink); letter-spacing: -0.01em; }
  .lp-logo-text span { color: var(--green); }
  .lp-nav-links { display: flex; align-items: center; gap: 32px; }
  .lp-nav-link { font-family: var(--fn); font-size: 16px; font-weight: 400; color: var(--ink); cursor: pointer; text-decoration: none; transition: color var(--transition); background: none; border: none; }
  .lp-nav-link:hover { color: var(--green); }
  .lp-nav-right { display: flex; align-items: center; gap: 10px; }
  .lp-nav-signin {
    font-family: var(--fn); font-size: 14px; font-weight: 500; color: var(--ink);
    text-decoration: none; padding: 8px 14px; border-radius: var(--radius-btn);
    transition: color var(--transition), background var(--transition);
  }
  .lp-nav-signin:hover { color: var(--green-dark); background: var(--green-lo); }

  /* ─── BUTTONS ────────────────────────────────────── */
  .lp-btn-primary {
    background: var(--green); color: #fcfcfa; border: none;
    padding: 12px 24px; border-radius: var(--radius-btn);
    font-family: var(--fn); font-size: 16px; font-weight: 500;
    cursor: pointer; white-space: nowrap;
    transition: background var(--transition), transform var(--transition);
    display: inline-flex; align-items: center; gap: 8px;
  }
  .lp-btn-primary:hover { background: var(--green-dark); transform: translateY(-1px); }
  .lp-btn-primary svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2.2; }

  .lp-btn-ghost {
    background: transparent; color: var(--green);
    border: 1.5px solid var(--green);
    padding: 11px 24px; border-radius: var(--radius-btn);
    font-family: var(--fn); font-size: 16px; font-weight: 500;
    cursor: pointer; white-space: nowrap;
    transition: background var(--transition), color var(--transition);
    display: inline-flex; align-items: center; gap: 8px;
  }
  .lp-btn-ghost:hover { background: var(--green-lo); }
  .lp-btn-ghost svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; }

  .lp-cta-pair { display: flex; gap: 12px; flex-wrap: wrap; }

  /* ─── AI BADGE ───────────────────────────────────── */
  .lp-ai-badge {
    display: inline-flex; align-items: center; gap: 6px;
    background: var(--cream);
    border: 1px solid var(--bdr2);
    padding: 6px 12px; border-radius: var(--radius-badge);
    font-family: var(--fn); font-size: 12px; font-weight: 500; color: var(--ink);
    margin-bottom: 24px;
  }
  .lp-ai-badge svg { width: 12px; height: 12px; fill: var(--green); }

  /* ─── HERO ──────────────────────────────────────── */
  .lp-hero-wrap {
    background: var(--cream);
    background-image: linear-gradient(257deg, rgba(15,157,88,0.05) -32%, rgba(15,157,88,0.10) 24%, rgba(15,157,88,0.03) 80%, transparent 100%);
    padding-top: 68px;
  }
  .lp-hero {
    max-width: 1200px; margin: 0 auto;
    padding: 72px 40px 96px;
    display: grid; grid-template-columns: 54% 46%;
    gap: 64px; align-items: center;
  }

  /* Left column */
  .lp-h1 {
    font-family: var(--fs);
    font-size: clamp(40px, 6vw, 80px);
    font-weight: 500; line-height: 1.10;
    letter-spacing: -0.01em; color: var(--ink);
    margin-bottom: 24px;
  }
  .lp-h1 .lp-dot { color: var(--green); }
  .lp-hero-body {
    font-family: var(--fn);
    font-size: 18px; color: var(--graphite); line-height: 1.67;
    max-width: 460px; margin-bottom: 32px; font-weight: 400;
  }
  .lp-hero-btns { margin-bottom: 36px; }
  .lp-trust-row { display: flex; gap: 20px; flex-wrap: wrap; }
  .lp-trust-item { display: flex; align-items: center; gap: 6px; font-family: var(--fn); font-size: 14px; color: var(--graphite); }
  .lp-trust-check { color: var(--green); flex-shrink: 0; }

  /* ─── OPERATIONS PANEL ───────────────────────────── */
  .lp-ops-panel {
    background: var(--card);
    border: 1px solid var(--bdr2);
    border-top: 3px solid var(--green);
    border-radius: var(--radius-card); overflow: hidden;
  }
  .lp-ops-header {
    background: var(--parchment);
    border-bottom: 1px solid var(--bdr);
    padding: 14px 18px;
    display: flex; align-items: center; justify-content: space-between;
  }
  .lp-ops-title { font-family: var(--fn); font-size: 13px; font-weight: 600; color: var(--ink); letter-spacing: -0.01em; }
  .lp-ops-sample {
    display: flex; align-items: center; gap: 5px;
    font-family: var(--fm); font-size: 10px; color: var(--mist); letter-spacing: 0.06em; text-transform: uppercase;
  }
  .lp-ops-sample-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--mist); }

  /* Current call */
  .lp-call-banner {
    background: var(--green-lo);
    border-bottom: 1px solid var(--bdr);
    padding: 14px 18px;
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
  }
  .lp-call-info { display: flex; flex-direction: column; gap: 3px; }
  .lp-call-label { font-family: var(--fm); font-size: 9.5px; color: var(--graphite); letter-spacing: 0.08em; text-transform: uppercase; }
  .lp-call-carrier { font-family: var(--fn); font-size: 14px; font-weight: 600; color: var(--ink); letter-spacing: -0.01em; }
  .lp-call-claim { font-family: var(--fm); font-size: 10.5px; color: var(--green-dark); margin-top: 1px; }
  .lp-waveform { display: flex; align-items: center; gap: 2.5px; height: 28px; }
  .lp-wave-bar {
    width: 3px; border-radius: 2px; background: var(--green);
    animation: lp-wave 0.8s ease-in-out infinite alternate;
  }
  .lp-wave-bar:nth-child(1)  { height: 6px;  animation-delay: 0.0s; }
  .lp-wave-bar:nth-child(2)  { height: 14px; animation-delay: 0.07s; }
  .lp-wave-bar:nth-child(3)  { height: 22px; animation-delay: 0.14s; }
  .lp-wave-bar:nth-child(4)  { height: 16px; animation-delay: 0.21s; }
  .lp-wave-bar:nth-child(5)  { height: 28px; animation-delay: 0.28s; }
  .lp-wave-bar:nth-child(6)  { height: 20px; animation-delay: 0.21s; }
  .lp-wave-bar:nth-child(7)  { height: 24px; animation-delay: 0.14s; }
  .lp-wave-bar:nth-child(8)  { height: 12px; animation-delay: 0.07s; }
  .lp-wave-bar:nth-child(9)  { height: 18px; animation-delay: 0.14s; }
  .lp-wave-bar:nth-child(10) { height: 8px;  animation-delay: 0.21s; }
  .lp-wave-bar:nth-child(11) { height: 20px; animation-delay: 0.28s; }
  .lp-wave-bar:nth-child(12) { height: 14px; animation-delay: 0.35s; }
  @keyframes lp-wave { from { transform: scaleY(0.3); opacity: 0.4; } to { transform: scaleY(1); opacity: 1; } }
  @keyframes lp-blink { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:0.25; transform:scale(0.7); } }

  /* Carrier tabs */
  .lp-carrier-tabs {
    display: flex; gap: 0;
    border-bottom: 1px solid var(--bdr);
    overflow-x: auto; scrollbar-width: none;
    background: var(--card);
  }
  .lp-carrier-tabs::-webkit-scrollbar { display: none; }
  .lp-carrier-tab {
    flex-shrink: 0; padding: 10px 14px;
    font-family: var(--fn); font-size: 13px; font-weight: 400; color: var(--graphite);
    cursor: pointer; background: transparent; border: none; border-bottom: 2px solid transparent;
    white-space: nowrap;
    transition: color var(--transition), border-color var(--transition);
  }
  .lp-carrier-tab:hover { color: var(--ink); }
  .lp-carrier-tab.active { color: var(--green-dark); border-bottom-color: var(--green); font-weight: 600; }

  /* Claim rows */
  .lp-claims-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; }
  .lp-claim {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 12px;
    background: var(--parchment); border: 1px solid var(--bdr); border-radius: var(--radius-btn);
    animation: lp-slide-in 0.28s cubic-bezier(0.4,0,0.2,1);
    gap: 8px;
  }
  @keyframes lp-slide-in { from { opacity:0; transform:translateX(-6px); } to { opacity:1; transform:none; } }
  .lp-claim-left { min-width: 0; flex: 1; }
  .lp-claim-id { font-family: var(--fm); font-size: 11px; font-weight: 500; color: var(--ink); }
  .lp-claim-desc { font-family: var(--fn); font-size: 11px; color: var(--graphite); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px; }
  .lp-claim-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .lp-claim-amt { font-family: var(--fm); font-size: 12px; font-weight: 500; color: var(--ink); }
  .lp-badge {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 9px; border-radius: var(--radius-badge); font-family: var(--fn); font-size: 11px; font-weight: 500; white-space: nowrap;
  }
  .lp-badge.approved { background: var(--green-lo); color: var(--green-dark); border: 1px solid var(--green-hi); }
  .lp-badge.calling  { background: rgba(59,127,212,0.10);  color: var(--blue);  border: 1px solid rgba(59,127,212,0.25); }
  .lp-badge.pending  { background: rgba(201,143,18,0.10);  color: var(--gold);  border: 1px solid rgba(201,143,18,0.25); }
  .lp-badge-dot { width: 4px; height: 4px; border-radius: 50%; background: currentColor; }
  .lp-badge.calling .lp-badge-dot { animation: lp-blink 0.9s ease-in-out infinite; }

  /* Panel footer */
  .lp-ops-footer {
    background: var(--parchment); border-top: 1px solid var(--bdr);
    padding: 12px 18px;
    display: flex; align-items: center;
  }
  .lp-ops-summary { font-family: var(--fm); font-size: 11px; color: var(--graphite); }
  .lp-ops-summary strong { color: var(--green-dark); }

  /* ─── STATS BAND ─────────────────────────────────── */
  .lp-stats {
    background: var(--parchment);
    border-top: 1px solid var(--bdr);
    border-bottom: 1px solid var(--bdr);
  }
  .lp-stats-inner {
    max-width: 1200px; margin: 0 auto;
    display: grid; grid-template-columns: repeat(4,1fr);
  }
  .lp-stat {
    padding: 48px 40px;
    border-right: 1px solid var(--bdr);
  }
  .lp-stat:last-child { border-right: none; }
  .lp-stat-num {
    font-family: var(--fs); font-size: 48px; font-weight: 500;
    color: var(--ink); letter-spacing: -0.01em; line-height: 1.1;
    margin-bottom: 8px; display: flex; align-items: baseline; gap: 4px;
  }
  .lp-stat-num span { font-size: 24px; color: var(--green); font-family: var(--fn); font-weight: 500; }
  .lp-stat-lbl { font-family: var(--fn); font-size: 14px; color: var(--graphite); line-height: 1.57; }

  /* ─── SECTION STRUCTURE ──────────────────────────── */
  .lp-section-inner { max-width: 1200px; margin: 0 auto; padding: 80px 40px; }
  .lp-section-heading {
    text-align: center; max-width: 700px; margin: 0 auto 56px;
  }
  .lp-eyebrow {
    font-family: var(--fn); font-size: 14px; font-weight: 500;
    letter-spacing: 0.02em; text-transform: uppercase; color: var(--green);
    margin-bottom: 14px;
  }
  .lp-section-h2 {
    font-family: var(--fs);
    font-size: clamp(28px, 4vw, 48px);
    font-weight: 500; letter-spacing: -0.01em;
    line-height: 1.15; color: var(--ink); margin-bottom: 24px;
  }
  .lp-section-h2 .lp-dot { color: var(--green); }
  .lp-section-sub { font-family: var(--fn); font-size: 18px; color: var(--graphite); line-height: 1.67; }

  /* Two-column feature split */
  .lp-split { display: grid; grid-template-columns: 1fr 1fr; gap: 80px; align-items: center; }
  .lp-split-h2 {
    font-family: var(--fs); font-size: clamp(28px, 3.5vw, 40px); font-weight: 500;
    letter-spacing: -0.01em; line-height: 1.15; color: var(--ink); margin-bottom: 24px;
  }
  .lp-split-p { font-family: var(--fn); font-size: 16px; color: var(--graphite); line-height: 1.56; margin-bottom: 16px; }

  /* ─── HOW IT WORKS ───────────────────────────────── */
  .lp-pipeline { background: var(--cream); }

  /* Interactive claim walkthrough */
  .lp-walk { display: grid; grid-template-columns: 320px 1fr; gap: 20px; align-items: stretch; }
  .lp-walk-tabs { display: flex; flex-direction: column; gap: 8px; }
  .lp-walk-tab {
    background: var(--card); border: 1px solid var(--bdr); border-radius: var(--radius-card);
    padding: 16px 18px; cursor: pointer; text-align: left;
    transition: border-color var(--transition), background var(--transition);
    position: relative; overflow: hidden;
  }
  .lp-walk-tab.active { border-color: var(--green); background: var(--green-lo); }
  .lp-walk-tab-top { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; }
  .lp-walk-tab-icon {
    width: 32px; height: 32px; border-radius: var(--radius-btn); flex-shrink: 0;
    background: var(--bdr); border: 1px solid var(--bdr2);
    display: grid; place-items: center;
    transition: background var(--transition), border-color var(--transition);
  }
  .lp-walk-tab-icon svg { width: 15px; height: 15px; stroke: var(--graphite); fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; transition: stroke var(--transition); }
  .lp-walk-tab.active .lp-walk-tab-icon { background: var(--green); border-color: var(--green); }
  .lp-walk-tab.active .lp-walk-tab-icon svg { stroke: #fcfcfa; }
  .lp-walk-tab-step { font-family: var(--fn); font-size: 11px; font-weight: 600; color: var(--mist); text-transform: uppercase; letter-spacing: 0.06em; transition: color var(--transition); }
  .lp-walk-tab.active .lp-walk-tab-step { color: var(--green-dark); }
  .lp-walk-tab-label { font-family: var(--fn); font-size: 15px; font-weight: 600; color: var(--ink); margin-top: 1px; }
  .lp-walk-tab-desc { font-family: var(--fn); font-size: 13px; color: var(--graphite); line-height: 1.5; padding-left: 44px; }
  .lp-walk-tab-progress {
    position: absolute; bottom: 0; left: 0; height: 2px; background: var(--green);
    width: 0%; transition: width 60ms linear;
  }

  /* Demo card */
  .lp-walk-card {
    background: var(--card); border: 1px solid var(--bdr2); border-radius: var(--radius-card);
    border-top: 3px solid var(--mist);
    overflow: hidden; display: flex; flex-direction: column;
    transition: border-top-color 0.4s ease;
  }
  .lp-walk-card.state-pending  { border-top-color: var(--gold); }
  .lp-walk-card.state-tokenize { border-top-color: var(--graphite); }
  .lp-walk-card.state-calling  { border-top-color: var(--blue); }
  .lp-walk-card.state-approved { border-top-color: var(--green); }
  .lp-walk-header {
    background: var(--parchment); border-bottom: 1px solid var(--bdr);
    padding: 14px 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px;
  }
  .lp-walk-header-left { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .lp-walk-claim-id { font-family: var(--fm); font-size: 11px; color: var(--graphite); }
  .lp-walk-claim-title { font-family: var(--fn); font-size: 15px; font-weight: 600; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lp-badge.neutral { background: rgba(96,96,95,0.08); color: var(--graphite); border: 1px solid var(--bdr2); }

  .lp-walk-body { padding: 24px; min-height: 224px; display: flex; flex-direction: column; justify-content: center; }
  .lp-walk-fade { animation: lp-fade-up 0.4s ease both; display: flex; flex-direction: column; gap: 14px; }
  @keyframes lp-fade-up { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

  .lp-walk-row { display: grid; grid-template-columns: 110px 1fr; gap: 12px; align-items: baseline; }
  .lp-walk-row-label { font-family: var(--fn); font-size: 11px; font-weight: 600; color: var(--mist); text-transform: uppercase; letter-spacing: 0.06em; }
  .lp-walk-row-value { font-family: var(--fn); font-size: 14px; color: var(--ink); line-height: 1.5; }
  .lp-walk-row-value.mono { font-family: var(--fm); }

  .lp-walk-token-old { color: var(--graphite); text-decoration: line-through; opacity: 0.55; }
  .lp-walk-token-arrow { color: var(--mist); margin: 0 8px; }
  .lp-walk-token-new { font-family: var(--fm); color: var(--green-dark); font-weight: 500; }
  .lp-walk-note { font-family: var(--fn); font-size: 13px; color: var(--graphite); line-height: 1.6; padding-top: 4px; border-top: 1px solid var(--bdr); }

  .lp-walk-call-head { display: flex; align-items: center; justify-content: space-between; }
  .lp-walk-call-label { font-family: var(--fn); font-size: 15px; font-weight: 600; color: var(--ink); }
  .lp-walk-transcript {
    background: var(--parchment); border: 1px solid var(--bdr); border-radius: var(--radius-btn);
    padding: 14px 16px; display: flex; flex-direction: column; gap: 7px; min-height: 132px;
  }
  .lp-walk-transcript-line { font-family: var(--fm); font-size: 12.5px; color: var(--graphite); animation: lp-fade-up 0.35s ease both; }
  .lp-walk-transcript-line.active { color: var(--green-dark); font-weight: 500; }

  .lp-walk-check-circle {
    width: 32px; height: 32px; border-radius: 50%; background: var(--green-lo); border: 1px solid var(--green-hi);
    display: grid; place-items: center; flex-shrink: 0;
    animation: lp-pop 0.4s cubic-bezier(0.34,1.56,0.64,1) both;
  }
  .lp-walk-check-circle svg { width: 16px; height: 16px; stroke: var(--green); fill: none; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }
  @keyframes lp-pop { from { transform: scale(0.5); opacity: 0; } to { transform: scale(1); opacity: 1; } }

  .lp-walk-caption { font-family: var(--fn); font-size: 13px; color: var(--mist); text-align: center; margin-top: 20px; }

  /* ─── PRODUCT HUB CARDS (Features) ──────────────── */
  .lp-features { background: var(--parchment); }
  .lp-feat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .lp-feat {
    background: var(--card); border: 1px solid var(--bdr); border-radius: var(--radius-card);
    padding: 28px;
    transition: border-color var(--transition);
  }
  .lp-feat:hover { border-color: var(--green-hi); }
  .lp-feat-icon {
    width: 40px; height: 40px; border-radius: var(--radius-btn);
    background: var(--green-lo); border: 1px solid var(--green-md);
    display: grid; place-items: center; margin-bottom: 18px;
  }
  .lp-feat-icon svg { width: 18px; height: 18px; stroke: var(--green); fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .lp-feat-h { font-family: var(--fn); font-size: 22px; font-weight: 500; color: var(--ink); margin-bottom: 10px; letter-spacing: -0.01em; }
  .lp-feat-p { font-family: var(--fn); font-size: 16px; color: var(--graphite); line-height: 1.56; margin-bottom: 16px; }
  .lp-feat-check { display: flex; align-items: flex-start; gap: 8px; font-family: var(--fn); font-size: 14px; color: var(--ink); margin-bottom: 16px; }
  .lp-feat-check svg { width: 14px; height: 14px; stroke: var(--green); fill: none; stroke-width: 2.6; flex-shrink: 0; margin-top: 2px; }
  .lp-feat-link {
    display: inline-flex; align-items: center; gap: 6px;
    font-family: var(--fn); font-size: 14px; font-weight: 500; color: var(--green-dark);
    text-decoration: none;
  }
  .lp-feat-link svg { width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 2.2; }

  /* ─── ROI CALCULATOR ──────────────────────────────── */
  .lp-roi { background: var(--cream); }
  .lp-roi-card {
    background: var(--card); border: 1px solid var(--bdr); border-radius: var(--radius-card);
    padding: 40px; display: grid; grid-template-columns: 1fr 1fr; gap: 56px;
  }
  .lp-roi-inputs { display: flex; flex-direction: column; gap: 32px; justify-content: center; }
  .lp-roi-field-label {
    display: flex; justify-content: space-between; align-items: baseline;
    font-family: var(--fn); font-size: 15px; color: var(--ink); margin-bottom: 12px;
  }
  .lp-roi-field-value { font-family: var(--fs); font-size: 20px; font-weight: 500; color: var(--green-dark); }
  .lp-roi-field input[type="range"] {
    width: 100%; accent-color: var(--green); cursor: pointer;
  }
  .lp-roi-outputs { display: flex; flex-direction: column; gap: 16px; justify-content: center; }
  .lp-roi-output {
    background: var(--green-lo); border: 1px solid var(--green-md); border-radius: var(--radius-card);
    padding: 20px 24px;
  }
  .lp-roi-output-num {
    font-family: var(--fs); font-size: 32px; font-weight: 500; letter-spacing: -0.01em;
    color: var(--ink); line-height: 1.1; margin-bottom: 4px;
  }
  .lp-roi-output-lbl { font-family: var(--fn); font-size: 14px; color: var(--graphite); line-height: 1.5; }
  .lp-roi-note { font-family: var(--fn); font-size: 13px; color: var(--mist); text-align: center; margin-top: 24px; }

  /* ─── CARRIERS (feature split) ───────────────────── */
  .lp-carriers { background: var(--cream); }
  .lp-carrier-grid { display: flex; flex-direction: column; gap: 10px; }
  .lp-carrier-card {
    background: var(--card); border: 1px solid var(--bdr); border-radius: var(--radius-card);
    padding: 16px 20px; cursor: pointer;
    transition: border-color var(--transition), background var(--transition);
    display: flex; flex-direction: column; gap: 10px;
  }
  .lp-carrier-card:hover { border-color: var(--green-hi); }
  .lp-carrier-card.active { border-color: var(--green); background: var(--green-lo); }
  .lp-carrier-row { display: flex; align-items: center; justify-content: space-between; }
  .lp-carrier-name { font-family: var(--fn); font-size: 16px; font-weight: 500; color: var(--ink); }
  .lp-carrier-share-badge {
    font-family: var(--fm); font-size: 11px; font-weight: 400; color: var(--green-dark);
    background: var(--green-lo); border: 1px solid var(--green-hi);
    padding: 2px 9px; border-radius: var(--radius-badge);
  }
  .lp-carrier-bar-track { height: 4px; background: var(--bdr); border-radius: 999px; overflow: hidden; }
  .lp-carrier-bar-fill { height: 100%; background: var(--green); border-radius: 999px; transition: width 0.4s cubic-bezier(0.4,0,0.2,1); }
  .lp-carriers-note { font-family: var(--fn); font-size: 14px; color: var(--graphite); margin-top: 16px; }

  /* ─── TESTIMONIALS ───────────────────────────────── */
  .lp-quotes { background: var(--parchment); }
  .lp-quote-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .lp-quote {
    background: var(--card); border: 1px solid var(--bdr); border-radius: var(--radius-card);
    padding: 32px;
  }
  .lp-quote-mark {
    font-family: var(--fs); font-size: 56px; line-height: 0.5;
    color: var(--green); position: relative; top: 16px;
  }
  .lp-quote-body { font-family: var(--fn); font-size: 16px; color: var(--ink); line-height: 1.67; margin-bottom: 24px; font-weight: 400; }
  .lp-quote-attr { display: flex; align-items: center; gap: 12px; }
  .lp-quote-avatar {
    width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--bdr2);
    background: var(--green-lo); display: grid; place-items: center; flex-shrink: 0;
    font-family: var(--fn); font-size: 13px; font-weight: 600; color: var(--green-dark);
  }
  .lp-quote-name { font-family: var(--fn); font-size: 14px; font-weight: 600; color: var(--ink); }
  .lp-quote-title { font-family: var(--fn); font-size: 13px; color: var(--graphite); margin-top: 2px; }

  /* ─── COMPLIANCE (product hub cards) ─────────────── */
  .lp-compliance { background: var(--cream); }
  .lp-compliance-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 16px; }
  .lp-compliance-card {
    background: var(--card); border: 1px solid var(--bdr); border-radius: var(--radius-card);
    padding: 24px;
    transition: border-color var(--transition);
  }
  .lp-compliance-card:hover { border-color: var(--green-hi); }
  .lp-compliance-icon {
    width: 40px; height: 40px; border-radius: var(--radius-btn);
    background: var(--green-lo); border: 1px solid var(--green-md);
    display: grid; place-items: center; margin-bottom: 16px;
  }
  .lp-compliance-icon svg { width: 18px; height: 18px; stroke: var(--green); fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .lp-compliance-h { font-family: var(--fn); font-size: 16px; font-weight: 600; color: var(--ink); margin-bottom: 8px; letter-spacing: -0.01em; }
  .lp-compliance-p { font-family: var(--fn); font-size: 14px; color: var(--graphite); line-height: 1.57; }

  /* ─── CTA ────────────────────────────────────────── */
  .lp-cta-section { background: var(--parchment); border-top: 1px solid var(--bdr); padding: 80px 40px; }
  .lp-cta-inner {
    max-width: 1200px; margin: 0 auto;
    text-align: center;
  }
  .lp-cta-tag {
    font-family: var(--fn); font-size: 14px; font-weight: 500; color: var(--green);
    letter-spacing: 0.02em; text-transform: uppercase; margin-bottom: 14px;
  }
  .lp-cta-h {
    font-family: var(--fs);
    font-size: clamp(28px, 4vw, 48px); font-weight: 500;
    letter-spacing: -0.01em; color: var(--ink); line-height: 1.15; margin-bottom: 16px;
  }
  .lp-cta-h .lp-dot { color: var(--green); }
  .lp-cta-body { font-family: var(--fn); font-size: 18px; color: var(--graphite); line-height: 1.67; max-width: 560px; margin: 0 auto 32px; }
  .lp-cta-actions { display: flex; justify-content: center; gap: 12px; flex-wrap: wrap; }

  /* ─── ACCESS / DEMO MODAL ────────────────────────── */
  .lp-modal-overlay {
    position: fixed; inset: 0; z-index: 1000;
    background: rgba(31,31,31,0.45);
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
    animation: lp-modal-fade 0.15s ease-out both;
  }
  @keyframes lp-modal-fade { from { opacity: 0; } to { opacity: 1; } }
  .lp-modal {
    position: relative;
    background: var(--cream);
    border-radius: var(--radius-card);
    border: 1px solid var(--bdr);
    box-shadow: 0 24px 64px -16px rgba(31,31,31,0.35);
    width: 100%; max-width: 440px;
    max-height: calc(100vh - 48px);
    overflow-y: auto;
    padding: 36px;
  }
  .lp-modal-close {
    position: absolute; top: 16px; right: 16px;
    width: 32px; height: 32px; border-radius: 8px;
    background: transparent; border: none; cursor: pointer;
    display: grid; place-items: center;
    color: var(--graphite);
    transition: background var(--transition), color var(--transition);
  }
  .lp-modal-close:hover { background: var(--green-lo); color: var(--ink); }
  .lp-modal-close svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; }
  .lp-modal-h {
    font-family: var(--fs); font-size: 24px; font-weight: 500;
    color: var(--ink); letter-spacing: -0.01em; margin-bottom: 8px; padding-right: 24px;
  }
  .lp-modal-sub { font-family: var(--fn); font-size: 14px; color: var(--graphite); line-height: 1.6; margin-bottom: 24px; }
  .lp-modal-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
  .lp-modal-field label { font-family: var(--fn); font-size: 13px; font-weight: 500; color: var(--ink); }
  .lp-modal-field input {
    font-family: var(--fn); font-size: 15px; color: var(--ink);
    background: var(--cream); border: 1px solid var(--bdr2); border-radius: var(--radius-btn);
    padding: 10px 12px; outline: none;
    transition: border-color var(--transition);
  }
  .lp-modal-field input:focus { border-color: var(--green); }
  .lp-modal-error { font-family: var(--fn); font-size: 13px; color: #c0392b; margin: -4px 0 16px; }
  .lp-modal-submit { width: 100%; justify-content: center; margin-top: 4px; }
  .lp-modal-submit:disabled { opacity: 0.6; cursor: default; transform: none; }
  .lp-modal-success { text-align: center; padding: 8px 0; }
  .lp-modal-success-icon {
    width: 48px; height: 48px; border-radius: 50%;
    background: var(--green-lo); color: var(--green);
    display: grid; place-items: center; margin: 0 auto 16px;
  }
  .lp-modal-success-icon svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2.6; }
  .lp-modal-success .lp-modal-h { padding-right: 0; }
  .lp-modal-success .lp-btn-primary { margin-top: 8px; }

  /* ─── FOOTER ─────────────────────────────────────── */
  .lp-footer { background: var(--cream); border-top: 1px solid var(--bdr); padding: 64px 40px 32px; }
  .lp-footer-inner { max-width: 1200px; margin: 0 auto; }
  .lp-footer-top { display: flex; justify-content: space-between; gap: 40px; flex-wrap: wrap; margin-bottom: 48px; }
  .lp-footer-brand-sub { font-family: var(--fn); font-size: 14px; color: var(--graphite); margin-top: 12px; max-width: 220px; line-height: 1.57; }
  .lp-footer-cols { display: flex; gap: 64px; }
  .lp-footer-col h4 { font-family: var(--fn); font-size: 12px; font-weight: 600; color: var(--mist); letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 16px; }
  .lp-footer-col a, .lp-footer-col button {
    display: block; font-family: var(--fn); font-size: 14px; color: var(--graphite); text-decoration: none;
    margin-bottom: 10px; cursor: pointer; transition: color var(--transition);
    background: none; border: none; padding: 0; text-align: left;
  }
  .lp-footer-col a:hover, .lp-footer-col button:hover { color: var(--green-dark); }
  .lp-footer-bottom {
    border-top: 1px solid var(--bdr); padding-top: 24px;
    display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px;
  }
  .lp-footer-bottom span { font-family: var(--fn); font-size: 13px; color: var(--mist); }

  /* ─── SCROLL REVEAL ──────────────────────────────── */
  .lp-reveal { opacity:0; transform:translateY(16px); transition:opacity 0.6s ease, transform 0.6s ease; }
  .lp-reveal.visible { opacity:1; transform:none; }

  /* ─── RESPONSIVE ─────────────────────────────────── */
  @media (max-width: 1100px) {
    .lp-hero { grid-template-columns: 1fr; padding: 64px 32px 64px; gap: 48px; }
    .lp-stats-inner { grid-template-columns: 1fr 1fr; }
    .lp-feat-grid { grid-template-columns: 1fr; }
    .lp-roi-card { grid-template-columns: 1fr; gap: 32px; padding: 32px; }
    .lp-compliance-grid { grid-template-columns: 1fr 1fr; }
    .lp-walk { grid-template-columns: 1fr; }
    .lp-split { grid-template-columns: 1fr; gap: 40px; }
    .lp-quote-grid { grid-template-columns: 1fr; }
  }
  @media (max-width: 768px) {
    .lp-nav-links { display: none; }
    .lp-nav-inner { padding: 0 24px; }
    .lp-section-inner { padding: 56px 24px; }
    .lp-cta-section, .lp-footer { padding-left: 24px; padding-right: 24px; }
  }
  @media (max-width: 480px) {
    .lp-compliance-grid, .lp-stats-inner { grid-template-columns: 1fr; }
    .lp-stat-num { font-size: 36px; }
    .lp-hero { padding-top: 48px; }
    .lp-hero-wrap { padding-top: 64px; }
    .lp-walk-row { grid-template-columns: 1fr; gap: 4px; }
    .lp-nav-inner { padding: 0 16px; }
    .lp-logo-text { font-size: 14px; }
    .lp-nav-right { gap: 4px; }
    .lp-nav-signin { padding: 6px 8px; font-size: 12px; white-space: nowrap; }
    .lp-nav-right .lp-btn-primary { padding: 8px 12px; font-size: 13px; }
    .lp-modal { padding: 24px; }
    .lp-modal-h { font-size: 20px; }
  }
`

// ─── Data ─────────────────────────────────────────────────────────────────────
const CARRIERS = [
  { name: 'Sun Life',         share: '31%', pct: 31 },
  { name: 'Canada Life',      share: '22%', pct: 22 },
  { name: 'Manulife',         share: '12%', pct: 12 },
  { name: 'Green Shield',     share: '7%',  pct:  7 },
  { name: 'RBC Insurance',    share: '4%',  pct:  4 },
  { name: 'TELUS AdjudiCare', share: '2%',  pct:  2 },
]

const CLAIM_DATA: Record<string, { id: string; desc: string; amt: string; status: 'approved' | 'calling' | 'pending' }[]> = {
  'Sun Life': [
    { id: '#SL-847291', desc: 'Crown (Unit 14, D2710)',      amt: '$1,240', status: 'approved' },
    { id: '#SL-847180', desc: 'Root Canal (Unit 26, D3330)', amt: '$890',   status: 'calling'  },
    { id: '#SL-847055', desc: 'Scaling & Root Planing',      amt: '$420',   status: 'approved' },
    { id: '#SL-846990', desc: 'Composite Restoration',       amt: '$280',   status: 'pending'  },
  ],
  'Canada Life': [
    { id: '#CL-1048231', desc: 'Full Gold Crown (D2710)',  amt: '$1,480', status: 'approved' },
    { id: '#CL-1048189', desc: 'Periodontal Maintenance',  amt: '$310',   status: 'calling'  },
    { id: '#CL-1048102', desc: 'Bitewing X-rays ×4',       amt: '$96',    status: 'approved' },
  ],
  'Manulife': [
    { id: '#MFC-39821', desc: 'Implant Crown (D6065)', amt: '$2,100', status: 'calling'  },
    { id: '#MFC-39799', desc: 'Extraction, Surgical',  amt: '$380',   status: 'approved' },
    { id: '#MFC-39744', desc: 'Night Guard (D9940)',   amt: '$560',   status: 'pending'  },
  ],
  'Green Shield': [
    { id: '#GS-20847', desc: 'Bridge Pontic (D6240)',   amt: '$940', status: 'approved' },
    { id: '#GS-20831', desc: 'Composite, Class II',     amt: '$245', status: 'approved' },
    { id: '#GS-20810', desc: 'Recall + Prophylaxis',     amt: '$182', status: 'calling'  },
  ],
  'RBC Insurance': [
    { id: '#RBC-58320', desc: 'Porcelain Crown (D2712)', amt: '$1,320', status: 'approved' },
    { id: '#RBC-58291', desc: 'Emergency Exam + PA',      amt: '$130',   status: 'approved' },
  ],
  'TELUS AdjudiCare': [
    { id: '#TA-67021', desc: 'Scaling, per unit ×4',   amt: '$310', status: 'approved' },
    { id: '#TA-66998', desc: 'Inlay, Ceramic (D2410)', amt: '$780', status: 'calling'  },
  ],
}

const FEATURES = [
  {
    icon: <svg viewBox="0 0 24 24"><path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>,
    h: 'Carrier-specific IVR navigation',
    p: 'Each of the six carriers runs a different IVR structure. CollectRx maintains dedicated navigation paths per carrier, updated whenever systems change.',
    check: 'Maintained for all six major Canadian carriers',
  },
  {
    icon: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>,
    h: 'Live claim status propagation',
    p: 'As each call resolves, claim state is written back in real time. Your team sees current status on every outstanding claim without touching a phone.',
    check: 'Status updates the moment a call ends',
  },
  {
    icon: <svg viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>,
    h: 'PHI tokenization at the boundary',
    p: 'Patient identifiers are replaced with UUID tokens before any data reaches the AI layer. Names, DOBs, and health card numbers never leave your server.',
    check: 'Built to PHIPA and PIPEDA requirements',
  },
  {
    icon: <svg viewBox="0 0 24 24"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
    h: 'Structured denial escalation',
    p: 'Denied claims immediately capture the reason code, flag re-submission requirements, and route persistent denials to human review with full context.',
    check: 'Reason codes captured on every denial',
  },
  {
    icon: <svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><path d="M8 21h8M12 17v4" /></svg>,
    h: 'Direct PMS integration',
    p: 'Works with any practice management software. A weekly export of outstanding insurance balances is all it takes, no API integration, no IT setup.',
    check: 'No IT setup or API integration required',
  },
  {
    icon: <svg viewBox="0 0 24 24"><path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
    h: 'Collections metrics',
    p: 'Sync-verified dollars recovered, open insurance outstanding, and claims in follow-up. Compare CollectRx results to your PMS aging reports.',
    check: 'Recovery metrics in your dashboard',
  },
  {
    icon: <svg viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-5 9l2 2 4-4" /></svg>,
    h: 'CDCP reconsideration handling',
    p: 'Denied Canadian Dental Care Plan claims are routed through the CDCP Contact Centre for Level 1 Reconsideration, with denial reason codes mapped to the required evidence checklist.',
    check: 'Built for the CDCP rollout, not bolted on',
  },
]

const TRUST = [
  {
    icon: <svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>,
    h: 'PHIPA architecture',
    p: 'Identifiers are tokenized before data is processed outside your controlled environment. Compliance is enforced structurally, not by policy.',
  },
  {
    icon: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20" /></svg>,
    h: 'PIPEDA compliant',
    p: 'Built to Canadian federal privacy standards. Data residency, consent handling, and subject access rights are built into the platform.',
  },
  {
    icon: <svg viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg>,
    h: 'PHI on your infrastructure',
    p: 'No identifiers are transmitted to external services without tokenization. Health data stays within your system boundaries.',
  },
  {
    icon: <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>,
    h: 'Business hours enforcement',
    p: 'All carrier calls are placed Mon–Fri, 8am–5pm Eastern. Call frequency limits and scheduling windows are enforced at the system level.',
  },
]

const PIPELINE_STEPS = [
  {
    icon: <svg viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>,
    label: 'Claim detected',
    desc: 'Outstanding claims pulled from your PMS automatically. No manual entry required.',
  },
  {
    icon: <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>,
    label: 'PHI removed',
    desc: 'Patient identifiers replaced with secure UUID tokens before any AI processing.',
  },
  {
    icon: <svg viewBox="0 0 24 24"><path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>,
    label: 'Carrier called',
    desc: 'AI navigates the carrier IVR, speaks with reps, and captures adjudication status.',
  },
  {
    icon: <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>,
    label: 'Status written back',
    desc: 'Result recorded: approved, denied with reason code, or escalated for human review.',
  },
]

// Single illustrative claim used to drive the "How it Works" walkthrough.
const DEMO_CLAIM = {
  id: '#SL-204871',
  procedure: 'Crown, Unit 14 (D2710)',
  carrier: 'Sun Life',
  group: '88421',
  amount: '$1,240',
  patientName: 'Sarah Mitchell',
  patientDob: '04/12/1985',
  token: '7f3a-92d1-44e0',
  daysOutstanding: 32,
}

const IVR_TRANSCRIPT = [
  'Dialing Sun Life provider line…',
  '"For claims status, press 2."',
  'Entering group number 8 8 4 2 1…',
  '"Please hold for the next representative."',
  'Speaking with rep, referencing claim #SL-204871…',
  'Adjudication status received.',
]

const TESTIMONIALS = [
  {
    body: "We were spending four to five hours a week just on hold with insurance carriers. That time is completely gone now. The claims that used to age past 90 days are now resolved by day 35.",
    name: 'Dr. Sarah Chen',
    title: 'Practice Owner, North York, ON',
    initials: 'SC',
  },
  {
    body: "The PHIPA compliance piece was what convinced us. We had reservations about any AI touching patient workflows. Knowing that identifiers never leave our server made this a straightforward decision.",
    name: 'Dr. Michael Patel',
    title: 'Managing Partner, Dental Group, Mississauga',
    initials: 'MP',
  },
]

// ─── Hooks ─────────────────────────────────────────────────────────────────────
function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('.lp-reveal')
    const obs = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible') }),
      { threshold: 0.08 }
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

function useScrolled() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [])
  return scrolled
}

// ─── Components ────────────────────────────────────────────────────────────────
function Waveform() {
  return (
    <div className="lp-waveform">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="lp-wave-bar" />
      ))}
    </div>
  )
}

function ClaimWalkthrough() {
  const STEP_DURATION = 5200
  const TICK = 50
  const [step, setStep] = useState(0)
  const [progress, setProgress] = useState(0)
  const [lineCount, setLineCount] = useState(1)

  // Auto-advance through the four steps on a loop, with a progress bar per tab.
  useEffect(() => {
    setProgress(0)
    let elapsed = 0
    const id = setInterval(() => {
      elapsed += TICK
      setProgress(Math.min((elapsed / STEP_DURATION) * 100, 100))
      if (elapsed >= STEP_DURATION) {
        setStep(s => (s + 1) % PIPELINE_STEPS.length)
      }
    }, TICK)
    return () => clearInterval(id)
  }, [step])

  // Reveal the IVR transcript line-by-line while "Carrier called" is active.
  useEffect(() => {
    if (step !== 2) { setLineCount(1); return }
    setLineCount(1)
    const id = setInterval(() => {
      setLineCount(n => (n < IVR_TRANSCRIPT.length ? n + 1 : n))
    }, 750)
    return () => clearInterval(id)
  }, [step])

  const stateClass = ['state-pending', 'state-tokenize', 'state-calling', 'state-approved'][step]
  const badge = [
    { label: 'Outstanding', cls: 'pending' },
    { label: 'Tokenizing',  cls: 'neutral' },
    { label: 'Calling',     cls: 'calling' },
    { label: 'Approved',    cls: 'approved' },
  ][step]

  return (
    <div className="lp-walk">
      <div className="lp-walk-tabs">
        {PIPELINE_STEPS.map((s, i) => (
          <button
            key={s.label}
            type="button"
            className={`lp-walk-tab${i === step ? ' active' : ''}`}
            onClick={() => setStep(i)}
          >
            <div className="lp-walk-tab-top">
              <div className="lp-walk-tab-icon">{s.icon}</div>
              <div>
                <div className="lp-walk-tab-step">Step {i + 1}</div>
                <div className="lp-walk-tab-label">{s.label}</div>
              </div>
            </div>
            <div className="lp-walk-tab-desc">{s.desc}</div>
            {i === step && <div className="lp-walk-tab-progress" style={{ width: `${progress}%` }} />}
          </button>
        ))}
      </div>

      <div className={`lp-walk-card ${stateClass}`}>
        <div className="lp-walk-header">
          <div className="lp-walk-header-left">
            <span className="lp-walk-claim-id">{DEMO_CLAIM.id}</span>
            <span className="lp-walk-claim-title">{DEMO_CLAIM.procedure}</span>
          </div>
          <span className={`lp-badge ${badge.cls}`}>
            <span className="lp-badge-dot" />
            {badge.label}
          </span>
        </div>

        <div className="lp-walk-body">
          {step === 0 && (
            <div className="lp-walk-fade" key="step0">
              <div className="lp-walk-row">
                <span className="lp-walk-row-label">Patient</span>
                <span className="lp-walk-row-value">{DEMO_CLAIM.patientName} · DOB {DEMO_CLAIM.patientDob}</span>
              </div>
              <div className="lp-walk-row">
                <span className="lp-walk-row-label">Carrier</span>
                <span className="lp-walk-row-value">{DEMO_CLAIM.carrier} · Group #{DEMO_CLAIM.group}</span>
              </div>
              <div className="lp-walk-row">
                <span className="lp-walk-row-label">Amount</span>
                <span className="lp-walk-row-value mono">{DEMO_CLAIM.amount}</span>
              </div>
              <div className="lp-walk-row">
                <span className="lp-walk-row-label">Status</span>
                <span className="lp-walk-row-value">{DEMO_CLAIM.daysOutstanding} days outstanding, entering follow-up queue</span>
              </div>
            </div>
          )}
          {step === 1 && (
            <div className="lp-walk-fade" key="step1">
              <div className="lp-walk-row">
                <span className="lp-walk-row-label">Patient</span>
                <span className="lp-walk-row-value">
                  <span className="lp-walk-token-old">{DEMO_CLAIM.patientName} · DOB {DEMO_CLAIM.patientDob}</span>
                  <span className="lp-walk-token-arrow">→</span>
                  <span className="lp-walk-token-new">token {DEMO_CLAIM.token}</span>
                </span>
              </div>
              <div className="lp-walk-row">
                <span className="lp-walk-row-label">Carrier</span>
                <span className="lp-walk-row-value">{DEMO_CLAIM.carrier} · Group #{DEMO_CLAIM.group}</span>
              </div>
              <div className="lp-walk-row">
                <span className="lp-walk-row-label">Amount</span>
                <span className="lp-walk-row-value mono">{DEMO_CLAIM.amount}</span>
              </div>
              <p className="lp-walk-note">
                Only the UUID token is sent to the voice agent. Names, dates of birth, and health card numbers stay on the backend.
              </p>
            </div>
          )}
          {step === 2 && (
            <div className="lp-walk-fade" key="step2">
              <div className="lp-walk-call-head">
                <span className="lp-walk-call-label">Calling {DEMO_CLAIM.carrier}…</span>
                <Waveform />
              </div>
              <div className="lp-walk-transcript">
                {IVR_TRANSCRIPT.slice(0, lineCount).map((line, i) => (
                  <div key={line} className={`lp-walk-transcript-line${i === lineCount - 1 ? ' active' : ''}`}>
                    {line}
                  </div>
                ))}
              </div>
            </div>
          )}
          {step === 3 && (
            <div className="lp-walk-fade" key="step3" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 16 }}>
              <div className="lp-walk-check-circle">
                <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" /></svg>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="lp-walk-row">
                  <span className="lp-walk-row-label">Result</span>
                  <span className="lp-walk-row-value">Approved: {DEMO_CLAIM.amount} adjudicated</span>
                </div>
                <div className="lp-walk-row">
                  <span className="lp-walk-row-label">Token</span>
                  <span className="lp-walk-row-value mono">{DEMO_CLAIM.token}</span>
                </div>
                <div className="lp-walk-row">
                  <span className="lp-walk-row-label">Synced</span>
                  <span className="lp-walk-row-value">Written back to PMS, no staff action required</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function OpsPanel({ active, onSelect }: { active: number; onSelect: (i: number) => void }) {
  const carrier = CARRIERS[active]
  const claims = CLAIM_DATA[carrier.name] ?? []
  const callingClaim = claims.find(c => c.status === 'calling')
  const approved = claims.filter(c => c.status === 'approved').length
  const total = claims.reduce((s, c) => s + parseFloat(c.amt.replace(/[$,]/g, '')), 0)

  return (
    <div className="lp-ops-panel">
      {/* Header */}
      <div className="lp-ops-header">
        <span className="lp-ops-title">Operations Center</span>
        <div className="lp-ops-sample"><div className="lp-ops-sample-dot" />Sample workflow</div>
      </div>

      {/* Current call */}
      {callingClaim && (
        <div className="lp-call-banner">
          <div className="lp-call-info">
            <div className="lp-call-label">Currently calling</div>
            <div className="lp-call-carrier">{carrier.name}</div>
            <div className="lp-call-claim">{callingClaim.id} · {callingClaim.amt}</div>
          </div>
          <Waveform />
        </div>
      )}

      {/* Carrier tabs */}
      <div className="lp-carrier-tabs">
        {CARRIERS.map((c, i) => (
          <button key={c.name} className={`lp-carrier-tab${i === active ? ' active' : ''}`} onClick={() => onSelect(i)}>
            {c.name}
          </button>
        ))}
      </div>

      {/* Claims */}
      <div className="lp-claims-body">
        {claims.map((c, i) => (
          <div className="lp-claim" key={c.id} style={{ animationDelay: `${i * 50}ms` }}>
            <div className="lp-claim-left">
              <div className="lp-claim-id">{c.id}</div>
              <div className="lp-claim-desc">{c.desc}</div>
            </div>
            <div className="lp-claim-right">
              <span className="lp-claim-amt">{c.amt}</span>
              <span className={`lp-badge ${c.status}`}>
                <span className="lp-badge-dot" />
                {c.status === 'approved' ? 'Approved' : c.status === 'calling' ? 'Calling' : 'Pending'}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="lp-ops-footer">
        <span className="lp-ops-summary">
          Example: <strong>{approved}/{claims.length}</strong> claims resolved · <strong>${total.toLocaleString('en-CA')}</strong>
        </span>
      </div>
    </div>
  )
}

function StatNum({ target, suffix, label }: { target: number; suffix: string; label: string }) {
  const { val, ref } = useCounter(target)
  return (
    <div className="lp-stat" ref={ref}>
      <div className="lp-stat-num">{val.toLocaleString()}<span>{suffix}</span></div>
      <div className="lp-stat-lbl">{label}</div>
    </div>
  )
}

const fmtUSD = (n: number) => `$${Math.round(n).toLocaleString('en-CA')}`

function RoiCalculator() {
  const [outstandingAr, setOutstandingAr] = useState(12000)
  const [holdHours, setHoldHours] = useState(8)

  const hoursPerYear = holdHours * 52
  const timeValuePerYear = hoursPerYear * roiAssumptions.hourlyRateCAD
  const atRiskLow = outstandingAr * roiAssumptions.writeOffRateLow
  const atRiskHigh = outstandingAr * roiAssumptions.writeOffRateHigh

  return (
    <div className="lp-roi-card">
      <div className="lp-roi-inputs">
        <div className="lp-roi-field">
          <div className="lp-roi-field-label">
            <span>Outstanding insurance claims right now</span>
            <span className="lp-roi-field-value">{fmtUSD(outstandingAr)}</span>
          </div>
          <input
            type="range" min={1000} max={50000} step={500}
            value={outstandingAr}
            onChange={(e) => setOutstandingAr(Number(e.target.value))}
            aria-label="Outstanding insurance claims right now"
          />
        </div>
        <div className="lp-roi-field">
          <div className="lp-roi-field-label">
            <span>Hours/week your team spends on hold with carriers</span>
            <span className="lp-roi-field-value">{holdHours} hrs</span>
          </div>
          <input
            type="range" min={0} max={20} step={1}
            value={holdHours}
            onChange={(e) => setHoldHours(Number(e.target.value))}
            aria-label="Hours per week spent on hold with insurance carriers"
          />
        </div>
      </div>
      <div className="lp-roi-outputs">
        <div className="lp-roi-output">
          <div className="lp-roi-output-num">{hoursPerYear.toLocaleString()} hrs / year</div>
          <div className="lp-roi-output-lbl">
            Front-desk time freed up, worth roughly {fmtUSD(timeValuePerYear)}/year at ${roiAssumptions.hourlyRateCAD}/hr
          </div>
        </div>
        <div className="lp-roi-output">
          <div className="lp-roi-output-num">{fmtUSD(atRiskLow)} to {fmtUSD(atRiskHigh)}</div>
          <div className="lp-roi-output-lbl">
            Of your current outstanding claims, at typical industry write-off rates for AR aged past 90 days
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const [active, setActive] = useState(0)
  const scrolled = useScrolled()
  useReveal()

  const scrollTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })

  // ── Request Early Access / Book a Demo modal ──────────────────────────────
  const [accessOpen, setAccessOpen] = useState(false)
  const [accessIntent, setAccessIntent] = useState<'access' | 'demo'>('access')
  const [accessForm, setAccessForm] = useState({ name: '', email: '', practiceName: '', phone: '' })
  const [accessStatus, setAccessStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [accessError, setAccessError] = useState('')

  const openAccess = (intent: 'access' | 'demo') => {
    setAccessIntent(intent)
    setAccessStatus('idle')
    setAccessError('')
    setAccessOpen(true)
  }

  const closeAccess = () => {
    setAccessOpen(false)
    setAccessStatus('idle')
    setAccessError('')
    setAccessForm({ name: '', email: '', practiceName: '', phone: '' })
  }

  useEffect(() => {
    if (!accessOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAccess() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [accessOpen])

  const submitAccess = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!accessForm.name.trim() || !accessForm.email.trim()) {
      setAccessError('Please enter your name and email.')
      return
    }
    setAccessStatus('submitting')
    setAccessError('')
    try {
      const res = await fetch('/api/early-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...accessForm, intent: accessIntent }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Something went wrong. Please try again.')
      }
      setAccessStatus('success')
    } catch (err) {
      setAccessStatus('error')
      setAccessError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    }
  }

  return (
    <>
      <style>{STYLES}</style>
      <div className="lp">

        {/* ── NAV ── */}
        <nav className={`lp-nav${scrolled ? ' scrolled' : ''}`}>
          <div className="lp-nav-inner">
            <div className="lp-logo">
              <div className="lp-logo-mark">
                <svg viewBox="0 0 24 24"><path d="M12 2l9 4v6c0 5-3.9 9.7-9 11-5.1-1.3-9-6-9-11V6l9-4z" /></svg>
              </div>
              <span className="lp-logo-text">Collect<span>Rx</span></span>
            </div>
            <div className="lp-nav-links">
              <button type="button" className="lp-nav-link" onClick={() => scrollTo('how-it-works')}>How it Works</button>
              <Link to="/demo" className="lp-nav-link">Product demo</Link>
              <button type="button" className="lp-nav-link" onClick={() => scrollTo('roi')}>ROI Calculator</button>
              <button type="button" className="lp-nav-link" onClick={() => scrollTo('features')}>Features</button>
              <button type="button" className="lp-nav-link" onClick={() => scrollTo('carriers')}>Carriers</button>
              <button type="button" className="lp-nav-link" onClick={() => scrollTo('compliance')}>Compliance</button>
            </div>
            <div className="lp-nav-right">
              <Link to="/login" className="lp-nav-signin">Practice sign in</Link>
              <button type="button" className="lp-btn-primary" onClick={() => openAccess('access')}>
                Request Access
              </button>
            </div>
          </div>
        </nav>

        {/* ── HERO ── */}
        <div className="lp-hero-wrap">
          <section className="lp-hero">
            {/* Left */}
            <div>
              <div className="lp-ai-badge">
                <svg viewBox="0 0 24 24"><path d="M12 0l2.5 9.5L24 12l-9.5 2.5L12 24l-2.5-9.5L0 12l9.5-2.5z" /></svg>
                Canadian Insurance AR Automation · Early Access
              </div>
              <h1 className="lp-h1">
                Collect outstanding insurance AR<br />
                without staff on hold<span className="lp-dot">.</span>
              </h1>
              <p className="lp-hero-body">
                Unresolved insurance AR costs twice: staff hours on carrier phones, and revenue
                that never lands. CollectRx runs follow-up to six major Canadian insurers, tracks
                claim status, and handles denials, from a simple PMS export.
              </p>
              <div className="lp-hero-btns">
                <div className="lp-cta-pair">
                  <button className="lp-btn-primary" onClick={() => openAccess('access')}>
                    Request Early Access
                    <svg viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                  </button>
                  <Link to="/demo" className="lp-btn-ghost">
                    See how it works
                  </Link>
                </div>
              </div>
              <div className="lp-trust-row">
                {['PHIPA compliant by design', '6 major Canadian carriers', 'No IT setup required'].map(t => (
                  <div className="lp-trust-item" key={t}>
                    <svg className="lp-trust-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8">
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                    {t}
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Operations Panel */}
            <OpsPanel active={active} onSelect={setActive} />
          </section>
        </div>

        {/* ── STATS BAND ── */}
        <div className="lp-stats lp-reveal">
          <div className="lp-stats-inner">
            <StatNum target={6}  suffix=" carriers" label="Major Canadian insurers integrated" />
            <StatNum target={78} suffix="%"          label="Private dental market covered" />
            <StatNum target={100} suffix="%"         label="Insurance AR focus (not patient balances)" />
            <StatNum target={3}  suffix=" attempts"  label="Maximum per claim before escalation" />
          </div>
        </div>

        {/* ── ROI CALCULATOR ── */}
        <section className="lp-roi" id="roi">
          <div className="lp-section-inner">
            <div className="lp-section-heading lp-reveal">
              <div className="lp-eyebrow">Your numbers</div>
              <h2 className="lp-section-h2">
                What's this worth to your practice<span className="lp-dot">?</span>
              </h2>
              <p className="lp-section-sub">
                Adjust the sliders to match your practice. These are estimates to help you
                size the opportunity, not a guarantee.
              </p>
            </div>
            <div className="lp-reveal">
              <RoiCalculator />
              <p className="lp-roi-note">
                Estimates only, based on industry-typical figures. Actual results depend on your
                claim mix, carriers, and current follow-up process.
              </p>
            </div>
          </div>
        </section>

        {/* ── HOW IT WORKS ── */}
        <section className="lp-pipeline" id="how-it-works">
          <div className="lp-section-inner">
            <div className="lp-section-heading lp-reveal">
              <div className="lp-eyebrow">How it Works</div>
              <h2 className="lp-section-h2">
                Four steps. Less staff time on hold<span className="lp-dot">.</span>
              </h2>
              <p className="lp-section-sub">
                From the moment a claim ages into the queue to the moment its status is
                written back, insurance follow-up runs without your team calling carriers.
                Click a step, or watch it run on its own.
              </p>
            </div>
            <div className="lp-reveal">
              <ClaimWalkthrough />
              <p className="lp-walk-caption">
                Illustrative walkthrough: claim and patient details shown are simulated, not live data.
              </p>
            </div>
          </div>
        </section>

        {/* ── FEATURES (Product Hub Cards) ── */}
        <section className="lp-features" id="features">
          <div className="lp-section-inner">
            <div className="lp-section-heading lp-reveal">
              <div className="lp-eyebrow">Platform</div>
              <h2 className="lp-section-h2">
                Built for the specific realities of Canadian dental AR<span className="lp-dot">.</span>
              </h2>
            </div>
            <div className="lp-feat-grid">
              {FEATURES.map((f, i) => (
                <div className="lp-feat lp-reveal" key={f.h} style={{ transitionDelay: `${i * 55}ms` }}>
                  <div className="lp-feat-icon">{f.icon}</div>
                  <div className="lp-feat-h">{f.h}</div>
                  <p className="lp-feat-p">{f.p}</p>
                  <div className="lp-feat-check">
                    <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" /></svg>
                    {f.check}
                  </div>
                  <Link to="/product" className="lp-feat-link">
                    Learn more
                    <svg viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CARRIERS (feature split) ── */}
        <section className="lp-carriers" id="carriers">
          <div className="lp-section-inner">
            <div className="lp-split lp-reveal">
              <div>
                <div className="lp-eyebrow">Carrier Coverage</div>
                <h2 className="lp-split-h2">
                  Six carriers. 78% of the market<span className="lp-dot">.</span>
                </h2>
                <p className="lp-split-p">
                  Each integration handles the full call workflow for that carrier: IVR navigation,
                  hold patterns, rep protocols, and status formats.
                </p>
                <p className="lp-split-p">
                  Select a carrier to preview how CollectRx processes its claims in the
                  Operations Center above.
                </p>
                <p className="lp-carriers-note">
                  Together these carriers represent approximately 78% of Canadian private dental insurance.
                </p>
              </div>
              <div className="lp-carrier-grid">
                {CARRIERS.map((c, i) => (
                  <button
                    type="button"
                    key={c.name}
                    className={`lp-carrier-card${i === active ? ' active' : ''}`}
                    onClick={() => { setActive(i); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                  >
                    <div className="lp-carrier-row">
                      <span className="lp-carrier-name">{c.name}</span>
                      <span className="lp-carrier-share-badge">{c.share}</span>
                    </div>
                    <div className="lp-carrier-bar-track">
                      <div className="lp-carrier-bar-fill" style={{ width: `${(c.pct / 31) * 100}%` }} />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── TESTIMONIALS ── */}
        <section className="lp-quotes">
          <div className="lp-section-inner">
            <div className="lp-section-heading lp-reveal">
              <div className="lp-eyebrow">Early Access</div>
              <h2 className="lp-section-h2">What practices say<span className="lp-dot">.</span></h2>
            </div>
            <div className="lp-quote-grid lp-reveal">
              {TESTIMONIALS.map(t => (
                <div className="lp-quote" key={t.name}>
                  <div className="lp-quote-mark">&ldquo;</div>
                  <p className="lp-quote-body">{t.body}</p>
                  <div className="lp-quote-attr">
                    <div className="lp-quote-avatar">{t.initials}</div>
                    <div>
                      <div className="lp-quote-name">{t.name}</div>
                      <div className="lp-quote-title">{t.title}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── COMPLIANCE ── */}
        <section className="lp-compliance" id="compliance">
          <div className="lp-section-inner">
            <div className="lp-section-heading lp-reveal">
              <div className="lp-eyebrow">Compliance</div>
              <h2 className="lp-section-h2">
                Compliance is the architecture, not the afterthought<span className="lp-dot">.</span>
              </h2>
              <p className="lp-section-sub">
                In healthcare, privacy built in after the fact is privacy that fails.
                In CollectRx, PHI protection is a structural requirement, not a configuration option.
              </p>
            </div>
            <div className="lp-compliance-grid lp-reveal">
              {TRUST.map(t => (
                <div className="lp-compliance-card" key={t.h}>
                  <div className="lp-compliance-icon">{t.icon}</div>
                  <div className="lp-compliance-h">{t.h}</div>
                  <div className="lp-compliance-p">{t.p}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA ── */}
        <div className="lp-cta-section" id="cta">
          <div className="lp-cta-inner lp-reveal">
            <div className="lp-cta-tag">Early Access</div>
            <h2 className="lp-cta-h">
              The AR work is already getting done<span className="lp-dot">.</span>
            </h2>
            <p className="lp-cta-body">
              Annual partnership for Canadian dental practices. No setup fees.
              Collections metrics show what we recovered on your outstanding insurance AR.
            </p>
            <div className="lp-cta-actions">
              <button className="lp-btn-primary" onClick={() => openAccess('access')}>
                Request Early Access
                <svg viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
              </button>
              <Link to="/demo" className="lp-btn-ghost">See the product demo</Link>
            </div>
          </div>
        </div>

        {/* ── FOOTER ── */}
        <footer className="lp-footer">
          <div className="lp-footer-inner">
            <div className="lp-footer-top">
              <div>
                <div className="lp-logo">
                  <div className="lp-logo-mark">
                    <svg viewBox="0 0 24 24"><path d="M12 2l9 4v6c0 5-3.9 9.7-9 11-5.1-1.3-9-6-9-11V6l9-4z" /></svg>
                  </div>
                  <span className="lp-logo-text">Collect<span>Rx</span></span>
                </div>
                <p className="lp-footer-brand-sub">Dental insurance AR automation for Canadian practices.</p>
              </div>
              <div className="lp-footer-cols">
                <div className="lp-footer-col">
                  <h4>Platform</h4>
                  <button type="button" onClick={() => scrollTo('how-it-works')}>How it Works</button>
                  <Link to="/demo">Product demo</Link>
                  <button type="button" onClick={() => scrollTo('features')}>Features</button>
                  <button type="button" onClick={() => scrollTo('carriers')}>Carriers</button>
                  <button type="button" onClick={() => scrollTo('compliance')}>Compliance</button>
                </div>
                <div className="lp-footer-col">
                  <h4>Access</h4>
                  <Link to="/login">Practice sign in</Link>
                  <button type="button" onClick={() => openAccess('access')}>Request access</button>
                  <Link to="/demo">Watch demo</Link>
                  <button type="button" onClick={() => openAccess('demo')}>Book a setup call</button>
                </div>
                <div className="lp-footer-col">
                  <h4>Legal</h4>
                  <Link to="/legal/terms">Terms of Service</Link>
                  <Link to="/legal/privacy">Privacy Policy</Link>
                  <Link to="/product">Product one-pager</Link>
                </div>
              </div>
            </div>
            <div className="lp-footer-bottom">
              <span>© 2026 CollectRx Inc. All rights reserved.</span>
              <span>Built for Canadian dental.</span>
            </div>
          </div>
        </footer>

        {/* ── ACCESS / DEMO MODAL ── */}
        {accessOpen && (
          <div className="lp-modal-overlay" onClick={closeAccess}>
            <div className="lp-modal" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="lp-modal-close" onClick={closeAccess} aria-label="Close">
                <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
              {accessStatus === 'success' ? (
                <div className="lp-modal-success">
                  <div className="lp-modal-success-icon">
                    <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" /></svg>
                  </div>
                  <h3 className="lp-modal-h">Request received</h3>
                  <p className="lp-modal-sub">
                    Thanks{accessForm.name.trim() ? `, ${accessForm.name.trim().split(' ')[0]}` : ''}.
                    We'll be in touch within one business day.
                  </p>
                  <button type="button" className="lp-btn-primary" onClick={closeAccess}>Done</button>
                </div>
              ) : (
                <form onSubmit={submitAccess}>
                  <h3 className="lp-modal-h">{accessIntent === 'demo' ? 'Book a demo' : 'Request early access'}</h3>
                  <p className="lp-modal-sub">
                    Tell us a bit about your practice and we'll reach out to set things up.
                  </p>
                  <div className="lp-modal-field">
                    <label htmlFor="access-name">Name</label>
                    <input
                      id="access-name" type="text" required autoComplete="name"
                      value={accessForm.name}
                      onChange={(e) => setAccessForm(f => ({ ...f, name: e.target.value }))}
                    />
                  </div>
                  <div className="lp-modal-field">
                    <label htmlFor="access-email">Email</label>
                    <input
                      id="access-email" type="email" required autoComplete="email"
                      value={accessForm.email}
                      onChange={(e) => setAccessForm(f => ({ ...f, email: e.target.value }))}
                    />
                  </div>
                  <div className="lp-modal-field">
                    <label htmlFor="access-practice">Practice name</label>
                    <input
                      id="access-practice" type="text" autoComplete="organization"
                      value={accessForm.practiceName}
                      onChange={(e) => setAccessForm(f => ({ ...f, practiceName: e.target.value }))}
                    />
                  </div>
                  <div className="lp-modal-field">
                    <label htmlFor="access-phone">Phone (optional)</label>
                    <input
                      id="access-phone" type="tel" autoComplete="tel"
                      value={accessForm.phone}
                      onChange={(e) => setAccessForm(f => ({ ...f, phone: e.target.value }))}
                    />
                  </div>
                  {accessError && <p className="lp-modal-error">{accessError}</p>}
                  <button type="submit" className="lp-btn-primary lp-modal-submit" disabled={accessStatus === 'submitting'}>
                    {accessStatus === 'submitting' ? 'Sending…' : (accessIntent === 'demo' ? 'Request demo' : 'Request access')}
                  </button>
                </form>
              )}
            </div>
          </div>
        )}

      </div>
    </>
  )
}
