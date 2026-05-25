import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'

// ─── Design tokens / styles ───────────────────────────────────────────────────
const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,300;12..96,400;12..96,600;12..96,700;12..96,800&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&family=DM+Mono:ital,wght@0,300;0,400;0,500&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg0:   #0c1f16;
    --bg1:   #faf8f4;
    --bg2:   #fffffe;
    --bg3:   #f5f2eb;
    --bg4:   #ebe6dd;
    --bg5:   #e3ddd2;
    --on-green: #ffffff;

    --green:       #0f9d58;
    --green-lo:    rgba(15,157,88,0.1);
    --green-md:    rgba(15,157,88,0.16);
    --green-hi:    rgba(15,157,88,0.28);
    --green-glow:  rgba(15,157,88,0.2);
    --green-dark:  #0A7A43;

    --gold:  #c98f12;
    --blue:  #3b7fd4;
    --red:   #d64545;

    --t0: #0f1f18;
    --t1: #243d32;
    --t2: rgba(36,61,50,0.72);
    --t3: rgba(36,61,50,0.5);
    --t4: rgba(36,61,50,0.32);

    --bdr:  rgba(15,110,86,0.12);
    --bdr2: rgba(15,110,86,0.22);
    --bdr3: rgba(15,110,86,0.32);

    --fn: 'DM Sans', system-ui, sans-serif;
    --fd: 'Bricolage Grotesque', system-ui, sans-serif;
    --fm: 'DM Mono', 'Fira Code', monospace;

    --shadow-panel: 0 1px 2px rgba(15,31,24,0.04), 0 16px 48px rgba(15,31,24,0.08), 0 0 0 1px var(--bdr);
    --shadow-card:  0 1px 3px rgba(15,31,24,0.06), 0 8px 24px rgba(15,31,24,0.06);
    --transition: 0.2s cubic-bezier(0.4,0,0.2,1);
  }

  /* ─── BASE ─────────────────────────────────────── */
  .lp {
    background: var(--bg1);
    color: var(--t1);
    font-family: var(--fn);
    font-weight: 400;
    line-height: 1.6;
    overflow-x: hidden;
    -webkit-font-smoothing: antialiased;
  }

  /* ─── TICKER ────────────────────────────────────── */
  .lp-ticker {
    background: var(--bg3);
    border-bottom: 1px solid var(--bdr);
    height: 32px;
    display: flex; align-items: center;
    overflow: hidden; position: relative;
    z-index: 201;
  }
  .lp-ticker-label {
    flex-shrink: 0;
    display: flex; align-items: center; gap: 6px;
    background: var(--green);
    color: var(--on-green);
    height: 32px; padding: 0 12px;
    font-family: var(--fm); font-size: 10px; font-weight: 500;
    letter-spacing: 0.08em; text-transform: uppercase;
    z-index: 2;
  }
  .lp-ticker-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--on-green); animation: lp-blink 1.2s ease-in-out infinite; }
  .lp-ticker-track {
    display: flex; align-items: center;
    white-space: nowrap;
    animation: lp-ticker 28s linear infinite;
    padding-left: 24px; gap: 40px;
  }
  .lp-ticker-item {
    font-family: var(--fm); font-size: 10.5px; color: var(--t2);
    display: flex; align-items: center; gap: 8px; flex-shrink: 0;
  }
  .lp-ticker-item em { color: var(--green); font-style: normal; font-weight: 500; }
  .lp-ticker-sep { color: var(--t4); }

  @keyframes lp-ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }

  /* ─── NAV ───────────────────────────────────────── */
  .lp-nav {
    position: fixed; top: 32px; left: 0; right: 0; z-index: 200;
    background: rgba(255,254,249,0.92);
    border-bottom: 1px solid var(--bdr);
    backdrop-filter: blur(24px) saturate(180%);
    -webkit-backdrop-filter: blur(24px) saturate(180%);
    transition: top var(--transition);
  }
  .lp-nav.scrolled { top: 0; background: rgba(255,254,249,0.98); }
  .lp-nav-inner {
    max-width: 1240px; margin: 0 auto;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 40px; height: 60px;
  }
  .lp-logo { display: flex; align-items: center; gap: 10px; text-decoration: none; }
  .lp-logo-mark {
    width: 28px; height: 28px; border-radius: 7px;
    background: var(--green);
    display: grid; place-items: center; flex-shrink: 0;
  }
  .lp-logo-mark svg { width: 15px; height: 15px; fill: none; stroke: var(--on-green); stroke-width: 2.5; }
  .lp-logo-text { font-family: var(--fd); font-size: 15.5px; font-weight: 700; color: var(--t0); letter-spacing: -0.03em; }
  .lp-logo-text span { color: var(--green); }
  .lp-nav-links { display: flex; align-items: center; gap: 32px; }
  .lp-nav-link { font-size: 13px; color: var(--t3); cursor: pointer; text-decoration: none; transition: color var(--transition); letter-spacing: -0.01em; }
  .lp-nav-link:hover { color: var(--t1); }
  .lp-nav-right { display: flex; align-items: center; gap: 8px; }
  .lp-nav-signin {
    font-size: 13px; font-weight: 500; color: var(--t2);
    text-decoration: none; padding: 7px 14px; border-radius: 7px;
    transition: color var(--transition), background var(--transition);
  }
  .lp-nav-signin:hover { color: var(--t0); background: var(--green-lo); }
  .lp-nav-cta {
    background: var(--green); color: var(--on-green); border: none;
    padding: 8px 16px; border-radius: 7px;
    font-family: var(--fn); font-size: 13px; font-weight: 700;
    cursor: pointer; letter-spacing: -0.01em;
    transition: opacity var(--transition), transform var(--transition);
    box-shadow: 0 0 24px var(--green-glow);
  }
  .lp-nav-cta:hover { opacity: 0.85; transform: translateY(-1px); }

  /* ─── HERO ──────────────────────────────────────── */
  .lp-hero-wrap {
    background: var(--bg1);
    background-image:
      radial-gradient(ellipse 80% 60% at 80% 40%, rgba(15,157,88,0.08) 0%, transparent 65%),
      radial-gradient(ellipse 50% 80% at 10% 80%, rgba(15,157,88,0.04) 0%, transparent 60%),
      url("data:image/svg+xml,%3Csvg width='32' height='32' viewBox='0 0 32 32' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='16' cy='16' r='1' fill='rgba(15,157,88,0.08)'/%3E%3C/svg%3E");
    background-size: auto, auto, 32px 32px;
    padding-top: 92px;
  }
  .lp-hero {
    max-width: 1240px; margin: 0 auto;
    padding: 80px 40px 96px;
    display: grid; grid-template-columns: 52% 48%;
    gap: 64px; align-items: center;
  }

  /* Left column */
  .lp-hero-eyebrow {
    display: inline-flex; align-items: center; gap: 8px;
    background: var(--green-lo);
    color: var(--green);
    border: 1px solid var(--green-hi);
    padding: 5px 12px; border-radius: 100px;
    font-family: var(--fm); font-size: 10.5px; font-weight: 400;
    letter-spacing: 0.07em; text-transform: uppercase; margin-bottom: 28px;
  }
  .lp-eyebrow-pulse { width: 5px; height: 5px; border-radius: 50%; background: var(--green); animation: lp-blink 1.6s ease-in-out infinite; }
  @keyframes lp-blink { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:0.25; transform:scale(0.7); } }
  .lp-h1 {
    font-family: var(--fd);
    font-size: clamp(42px, 5vw, 70px);
    font-weight: 800; line-height: 1.01;
    letter-spacing: -0.045em; color: var(--t0);
    margin-bottom: 22px;
  }
  .lp-h1 em { font-style: italic; font-weight: 700; color: var(--green); }
  .lp-h1 .lp-h1-dim { color: var(--t2); }
  .lp-hero-body {
    font-size: 16px; color: var(--t2); line-height: 1.8;
    max-width: 460px; margin-bottom: 36px; font-weight: 300;
  }
  .lp-hero-btns { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 36px; }
  .lp-btn-primary {
    background: var(--green); color: var(--on-green); border: none;
    padding: 14px 26px; border-radius: 9px;
    font-family: var(--fn); font-size: 14px; font-weight: 700;
    cursor: pointer; letter-spacing: -0.01em;
    transition: opacity var(--transition), transform var(--transition), box-shadow var(--transition);
    box-shadow: 0 0 36px var(--green-glow);
    display: flex; align-items: center; gap: 8px;
  }
  .lp-btn-primary:hover { opacity: 0.88; transform: translateY(-1px); box-shadow: 0 0 52px var(--green-glow); }
  .lp-btn-primary svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2.2; }
  .lp-btn-ghost {
    background: transparent; color: var(--t1);
    border: 1.5px solid var(--bdr2);
    padding: 13px 26px; border-radius: 9px;
    font-family: var(--fn); font-size: 14px; font-weight: 500;
    cursor: pointer; transition: border-color var(--transition), background var(--transition), color var(--transition);
    display: flex; align-items: center; gap: 8px;
  }
  .lp-btn-ghost:hover { border-color: var(--green-hi); background: var(--green-lo); color: var(--t0); }
  .lp-btn-ghost svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; }
  .lp-trust-row { display: flex; gap: 18px; flex-wrap: wrap; }
  .lp-trust-item { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--t3); }
  .lp-trust-check { color: var(--green); }

  /* ─── OPERATIONS PANEL ───────────────────────────── */
  .lp-ops-panel {
    background: var(--bg2);
    border: 1px solid var(--bdr2);
    border-top: 3px solid var(--green);
    border-radius: 16px; overflow: hidden;
    box-shadow: var(--shadow-panel);
    position: relative;
  }
  .lp-ops-panel::before {
    content: ''; position: absolute;
    top: 0; left: 0; right: 0; height: 1px;
    background: linear-gradient(90deg, transparent, var(--green-hi), transparent);
  }
  .lp-ops-header {
    background: var(--bg3);
    border-bottom: 1px solid var(--bdr);
    padding: 14px 18px;
    display: flex; align-items: center; justify-content: space-between;
  }
  .lp-ops-title { font-family: var(--fd); font-size: 12.5px; font-weight: 600; color: var(--t1); letter-spacing: -0.01em; }
  .lp-ops-live {
    display: flex; align-items: center; gap: 5px;
    font-family: var(--fm); font-size: 10px; color: var(--green); letter-spacing: 0.06em;
  }
  .lp-ops-live-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--green); animation: lp-blink 1.3s ease-in-out infinite; }

  /* Current call */
  .lp-call-banner {
    background: linear-gradient(135deg, rgba(18,201,109,0.08) 0%, rgba(18,201,109,0.03) 100%);
    border-bottom: 1px solid var(--bdr);
    padding: 14px 18px;
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
  }
  .lp-call-info { display: flex; flex-direction: column; gap: 3px; }
  .lp-call-label { font-family: var(--fm); font-size: 9.5px; color: var(--t3); letter-spacing: 0.08em; text-transform: uppercase; }
  .lp-call-carrier { font-family: var(--fd); font-size: 14px; font-weight: 700; color: var(--t0); letter-spacing: -0.02em; }
  .lp-call-claim { font-family: var(--fm); font-size: 10.5px; color: var(--green); margin-top: 1px; }
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

  /* Carrier tabs */
  .lp-carrier-tabs {
    display: flex; gap: 0;
    border-bottom: 1px solid var(--bdr);
    overflow-x: auto; scrollbar-width: none;
    background: var(--bg2);
  }
  .lp-carrier-tabs::-webkit-scrollbar { display: none; }
  .lp-carrier-tab {
    flex-shrink: 0; padding: 9px 14px;
    font-family: var(--fm); font-size: 10.5px; font-weight: 400; color: var(--t3);
    cursor: pointer; background: transparent; border: none; border-bottom: 2px solid transparent;
    font-family: var(--fn); white-space: nowrap;
    transition: color var(--transition), border-color var(--transition);
    letter-spacing: -0.01em;
  }
  .lp-carrier-tab:hover { color: var(--t1); }
  .lp-carrier-tab.active { color: var(--green); border-bottom-color: var(--green); font-weight: 600; }

  /* Claim rows */
  .lp-claims-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 5px; }
  .lp-claim {
    display: flex; align-items: center; justify-content: space-between;
    padding: 9px 12px;
    background: var(--bg3); border: 1px solid var(--bdr); border-radius: 8px;
    animation: lp-slide-in 0.28s cubic-bezier(0.4,0,0.2,1);
    gap: 8px;
  }
  @keyframes lp-slide-in { from { opacity:0; transform:translateX(-6px); } to { opacity:1; transform:none; } }
  .lp-claim-left { min-width: 0; flex: 1; }
  .lp-claim-id { font-family: var(--fm); font-size: 11px; font-weight: 500; color: var(--t1); }
  .lp-claim-desc { font-size: 10.5px; color: var(--t3); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px; }
  .lp-claim-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .lp-claim-amt { font-family: var(--fm); font-size: 11.5px; font-weight: 500; color: var(--t1); }
  .lp-badge {
    display: inline-flex; align-items: center; gap: 3px;
    padding: 2px 8px; border-radius: 100px; font-size: 9.5px; font-weight: 600; white-space: nowrap;
  }
  .lp-badge.approved { background: rgba(18,201,109,0.12); color: var(--green); border: 1px solid rgba(18,201,109,0.2); }
  .lp-badge.calling  { background: rgba(92,154,255,0.12); color: var(--blue);  border: 1px solid rgba(92,154,255,0.2); }
  .lp-badge.pending  { background: rgba(240,180,41,0.12); color: var(--gold);  border: 1px solid rgba(240,180,41,0.2); }
  .lp-badge-dot { width: 4px; height: 4px; border-radius: 50%; background: currentColor; }
  .lp-badge.calling .lp-badge-dot { animation: lp-blink 0.9s ease-in-out infinite; }

  /* Panel footer */
  .lp-ops-footer {
    background: var(--bg3); border-top: 1px solid var(--bdr);
    padding: 10px 18px;
    display: flex; align-items: center; justify-content: space-between;
  }
  .lp-ops-summary { font-family: var(--fm); font-size: 10.5px; color: var(--t3); }
  .lp-ops-summary strong { color: var(--green); }
  .lp-ops-mini-stats { display: flex; gap: 16px; }
  .lp-ops-mini-stat { display: flex; flex-direction: column; align-items: flex-end; }
  .lp-ops-mini-num { font-family: var(--fm); font-size: 13px; font-weight: 500; color: var(--t0); line-height: 1; }
  .lp-ops-mini-lbl { font-size: 9px; color: var(--t4); letter-spacing: 0.06em; text-transform: uppercase; margin-top: 2px; }

  /* ─── STATS BAND ─────────────────────────────────── */
  .lp-stats {
    background: var(--bg2);
    border-top: 1px solid var(--bdr);
    border-bottom: 1px solid var(--bdr);
  }
  .lp-stats-inner {
    max-width: 1240px; margin: 0 auto;
    display: grid; grid-template-columns: repeat(4,1fr);
  }
  .lp-stat {
    padding: 44px 40px;
    border-right: 1px solid var(--bdr);
    position: relative; overflow: hidden;
    transition: background var(--transition);
  }
  .lp-stat:last-child { border-right: none; }
  .lp-stat:hover { background: var(--bg3); }
  .lp-stat::after {
    content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
    background: linear-gradient(90deg, var(--green) 0%, transparent 100%);
    opacity: 0; transition: opacity var(--transition);
  }
  .lp-stat:hover::after { opacity: 1; }
  .lp-stat-num {
    font-family: var(--fd); font-size: 52px; font-weight: 800;
    color: var(--t0); letter-spacing: -0.05em; line-height: 1;
    margin-bottom: 8px; display: flex; align-items: baseline; gap: 3px;
  }
  .lp-stat-num span { font-size: 28px; color: var(--green); }
  .lp-stat-lbl { font-size: 12.5px; color: var(--t3); line-height: 1.5; }

  /* ─── SECTION STRUCTURE ──────────────────────────── */
  .lp-section-inner { max-width: 1240px; margin: 0 auto; }
  .lp-eyebrow {
    font-family: var(--fm); font-size: 10.5px; font-weight: 400;
    letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 14px;
    display: flex; align-items: center; gap: 8px;
  }
  .lp-eyebrow::before {
    content: ''; width: 18px; height: 1px; background: currentColor; opacity: 0.5;
  }
  .lp-eyebrow.green { color: var(--green); }
  .lp-eyebrow.dark  { color: var(--green-dark); }
  .lp-section-h2 {
    font-family: var(--fd);
    font-size: clamp(28px, 3.5vw, 48px);
    font-weight: 800; letter-spacing: -0.04em;
    line-height: 1.05; margin-bottom: 56px;
  }
  .lp-section-h2.on-dark { color: var(--t0); }
  .lp-section-h2.on-dark em { font-style: italic; color: var(--green); font-weight: 700; }
  .lp-section-h2.on-light { color: #0C1A0F; }
  .lp-section-h2.on-light em { font-style: italic; color: var(--green-dark); font-weight: 700; }
  .lp-section-sub { font-size: 15px; color: var(--t2); line-height: 1.78; max-width: 520px; margin-top: -38px; margin-bottom: 48px; font-weight: 300; }
  .lp-section-sub.on-light { color: #445948; }

  /* ─── HOW IT WORKS ───────────────────────────────── */
  .lp-pipeline { background: #F2F6F2; }
  .lp-pipeline .lp-section-inner { padding: 100px 40px; }
  .lp-steps {
    display: grid; grid-template-columns: repeat(4,1fr);
    gap: 0; position: relative;
  }
  .lp-steps::before {
    content: ''; position: absolute;
    top: 25px; left: calc(12.5% + 22px); right: calc(12.5% + 22px);
    height: 1px;
    background: linear-gradient(90deg, #D0DDD1 0%, #A0BDA3 50%, #D0DDD1 100%);
    z-index: 0;
  }
  .lp-step { padding: 0 20px; text-align: center; z-index: 1; }
  .lp-step-num {
    font-family: var(--fm); font-size: 9.5px; font-weight: 500;
    color: var(--green-dark); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 12px;
  }
  .lp-step-icon {
    width: 50px; height: 50px; border-radius: 50%;
    background: white; border: 1.5px solid #D0DDD1;
    display: grid; place-items: center; margin: 0 auto 16px;
    box-shadow: 0 2px 8px rgba(12,26,15,0.07);
    transition: border-color var(--transition), box-shadow var(--transition), transform var(--transition);
    position: relative;
  }
  .lp-step-icon svg { width: 19px; height: 19px; stroke: var(--green-dark); fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .lp-step:hover .lp-step-icon {
    border-color: var(--green-dark);
    box-shadow: 0 4px 16px rgba(10,107,79,0.15);
    transform: translateY(-2px);
  }
  .lp-step-label { font-family: var(--fd); font-size: 13.5px; font-weight: 700; color: #0C1A0F; margin-bottom: 7px; letter-spacing: -0.015em; }
  .lp-step-desc { font-size: 12.5px; color: #5A7060; line-height: 1.68; }

  /* ─── FEATURES ───────────────────────────────────── */
  .lp-features { background: var(--bg2); }
  .lp-features .lp-section-inner { padding: 100px 40px; }
  .lp-feat-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 12px; }
  .lp-feat {
    background: var(--bg3); border: 1px solid var(--bdr); border-radius: 12px;
    padding: 28px 24px;
    transition: border-color var(--transition), transform var(--transition), box-shadow var(--transition);
    position: relative; overflow: hidden;
  }
  .lp-feat::after {
    content: ''; position: absolute; inset: 0;
    background: radial-gradient(circle at 0% 0%, var(--green-lo) 0%, transparent 60%);
    opacity: 0; transition: opacity var(--transition);
    pointer-events: none;
  }
  .lp-feat:hover { border-color: var(--green-hi); transform: translateY(-2px); box-shadow: 0 12px 32px rgba(15,157,88,0.12); }
  .lp-feat:hover::after { opacity: 1; }
  .lp-feat-icon {
    width: 38px; height: 38px; border-radius: 9px;
    background: var(--green-lo); border: 1px solid var(--green-md);
    display: grid; place-items: center; margin-bottom: 16px;
    transition: background var(--transition);
  }
  .lp-feat-icon svg { width: 18px; height: 18px; stroke: var(--green); fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .lp-feat:hover .lp-feat-icon { background: var(--green-md); }
  .lp-feat-h { font-family: var(--fd); font-size: 13.5px; font-weight: 700; color: var(--t0); margin-bottom: 8px; letter-spacing: -0.015em; }
  .lp-feat-p { font-size: 12.5px; color: var(--t2); line-height: 1.72; font-weight: 300; }

  /* ─── CARRIERS ───────────────────────────────────── */
  .lp-carriers { background: white; border-top: 1px solid #E0EAE1; border-bottom: 1px solid #E0EAE1; }
  .lp-carriers .lp-section-inner { padding: 100px 40px; }
  .lp-carrier-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 10px; margin-bottom: 16px; }
  .lp-carrier-card {
    background: white; border: 1.5px solid #E0EAE1; border-radius: 11px;
    padding: 18px 20px; cursor: pointer;
    transition: border-color var(--transition), box-shadow var(--transition);
    display: flex; flex-direction: column; gap: 10px;
  }
  .lp-carrier-card:hover { border-color: var(--green-dark); box-shadow: 0 2px 16px rgba(10,107,79,0.08); }
  .lp-carrier-card.active { border-color: var(--green-dark); background: rgba(10,107,79,0.025); }
  .lp-carrier-row { display: flex; align-items: center; justify-content: space-between; }
  .lp-carrier-name { font-family: var(--fd); font-size: 13px; font-weight: 700; color: #0C1A0F; letter-spacing: -0.01em; }
  .lp-carrier-share-badge {
    font-family: var(--fm); font-size: 10px; font-weight: 400; color: var(--green-dark);
    background: rgba(10,107,79,0.08); border: 1px solid rgba(10,107,79,0.14);
    padding: 2px 8px; border-radius: 100px;
  }
  .lp-carrier-bar-track { height: 3px; background: #E8F0E8; border-radius: 2px; overflow: hidden; }
  .lp-carrier-bar-fill { height: 100%; background: var(--green-dark); border-radius: 2px; transition: width 0.4s cubic-bezier(0.4,0,0.2,1); }
  .lp-carriers-note { font-size: 12.5px; color: #7A9080; text-align: center; margin-top: 16px; }

  /* ─── TESTIMONIALS ───────────────────────────────── */
  .lp-quotes { background: var(--bg1); }
  .lp-quotes .lp-section-inner { padding: 100px 40px; }
  .lp-quote-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .lp-quote {
    background: var(--bg2); border: 1px solid var(--bdr); border-radius: 14px;
    padding: 32px 28px; position: relative;
    transition: border-color var(--transition);
  }
  .lp-quote:hover { border-color: var(--bdr2); }
  .lp-quote-mark {
    font-family: Georgia, serif; font-size: 64px; line-height: 0.5;
    color: var(--green); opacity: 0.35; position: absolute; top: 22px; left: 22px;
  }
  .lp-quote-body { font-size: 14.5px; color: var(--t1); line-height: 1.78; margin-bottom: 24px; font-weight: 300; font-style: italic; padding-top: 16px; }
  .lp-quote-attr { display: flex; align-items: center; gap: 12px; }
  .lp-quote-avatar {
    width: 36px; height: 36px; border-radius: 50%; border: 1.5px solid var(--bdr2);
    background: var(--bg4); display: grid; place-items: center; flex-shrink: 0;
    font-family: var(--fd); font-size: 13px; font-weight: 700; color: var(--green);
  }
  .lp-quote-name { font-family: var(--fd); font-size: 13px; font-weight: 700; color: var(--t0); letter-spacing: -0.01em; }
  .lp-quote-title { font-size: 11.5px; color: var(--t3); margin-top: 2px; }

  /* ─── COMPLIANCE ─────────────────────────────────── */
  .lp-compliance { background: var(--bg3); border-top: 1px solid var(--bdr); }
  .lp-compliance .lp-section-inner { padding: 100px 40px; }
  .lp-compliance-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 12px; }
  .lp-compliance-card {
    background: var(--bg2); border: 1px solid var(--bdr); border-radius: 12px;
    padding: 26px 22px;
    transition: border-color var(--transition), background var(--transition);
  }
  .lp-compliance-card:hover { border-color: var(--green-hi); background: var(--bg3); }
  .lp-compliance-icon {
    width: 40px; height: 40px; border-radius: 9px;
    background: var(--green-lo); border: 1px solid var(--green-md);
    display: grid; place-items: center; margin-bottom: 14px;
  }
  .lp-compliance-icon svg { width: 18px; height: 18px; stroke: var(--green); fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .lp-compliance-h { font-family: var(--fd); font-size: 13px; font-weight: 700; color: var(--t0); margin-bottom: 8px; letter-spacing: -0.01em; }
  .lp-compliance-p { font-size: 12px; color: var(--t2); line-height: 1.68; font-weight: 300; }

  /* ─── CTA ────────────────────────────────────────── */
  .lp-cta-section { background: var(--bg2); border-top: 1px solid var(--bdr); padding: 80px 40px; }
  .lp-cta-inner {
    max-width: 1240px; margin: 0 auto;
    background: var(--bg3);
    border: 1px solid var(--bdr2);
    border-radius: 20px; padding: 72px 64px;
    display: flex; align-items: center; justify-content: space-between;
    gap: 48px; flex-wrap: wrap;
    position: relative; overflow: hidden;
  }
  .lp-cta-inner::before {
    content: ''; position: absolute;
    top: -120px; right: -120px;
    width: 400px; height: 400px; border-radius: 50%;
    background: radial-gradient(circle, rgba(18,201,109,0.08) 0%, transparent 65%);
    pointer-events: none;
  }
  .lp-cta-inner::after {
    content: ''; position: absolute;
    bottom: -80px; left: -80px;
    width: 280px; height: 280px; border-radius: 50%;
    background: radial-gradient(circle, rgba(18,201,109,0.04) 0%, transparent 65%);
    pointer-events: none;
  }
  .lp-cta-tag {
    font-family: var(--fm); font-size: 10px; font-weight: 400; color: var(--t4);
    letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 14px;
    display: flex; align-items: center; gap: 6px;
  }
  .lp-cta-tag::before { content: ''; width: 14px; height: 1px; background: var(--t4); }
  .lp-cta-h {
    font-family: var(--fd);
    font-size: clamp(28px, 3.5vw, 48px); font-weight: 800;
    letter-spacing: -0.04em; color: var(--t0); line-height: 1.05; margin-bottom: 14px;
  }
  .lp-cta-h em { font-style: italic; color: var(--green); font-weight: 700; }
  .lp-cta-body { font-size: 15px; color: var(--t2); line-height: 1.75; max-width: 440px; font-weight: 300; }
  .lp-cta-actions { display: flex; flex-direction: column; gap: 10px; flex-shrink: 0; z-index: 1; }
  .lp-cta-btn-primary {
    background: var(--green); color: var(--on-green); border: none;
    padding: 15px 32px; border-radius: 9px;
    font-family: var(--fn); font-size: 14.5px; font-weight: 700;
    cursor: pointer; white-space: nowrap;
    transition: opacity var(--transition), transform var(--transition), box-shadow var(--transition);
    box-shadow: 0 0 36px var(--green-glow);
  }
  .lp-cta-btn-primary:hover { opacity: 0.87; transform: translateY(-1px); box-shadow: 0 0 52px var(--green-glow); }
  .lp-cta-btn-outline {
    background: transparent; color: var(--t1);
    border: 1.5px solid var(--bdr2);
    padding: 14px 32px; border-radius: 9px;
    font-family: var(--fn); font-size: 14.5px; font-weight: 500;
    cursor: pointer; white-space: nowrap;
    transition: border-color var(--transition), background var(--transition), color var(--transition);
  }
  .lp-cta-btn-outline:hover { border-color: var(--green-hi); background: var(--green-lo); color: var(--t0); }

  /* ─── FOOTER ─────────────────────────────────────── */
  .lp-footer { background: var(--bg3); border-top: 1px solid var(--bdr); padding: 60px 40px 32px; }
  .lp-footer-inner { max-width: 1240px; margin: 0 auto; }
  .lp-footer-top { display: flex; justify-content: space-between; gap: 40px; flex-wrap: wrap; margin-bottom: 48px; }
  .lp-footer-brand-sub { font-size: 12.5px; color: var(--t4); margin-top: 10px; max-width: 200px; line-height: 1.65; font-weight: 300; }
  .lp-footer-cols { display: flex; gap: 56px; }
  .lp-footer-col h4 { font-family: var(--fm); font-size: 9.5px; font-weight: 400; color: var(--t4); letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 16px; }
  .lp-footer-col a {
    display: block; font-size: 12.5px; color: var(--t2); text-decoration: none;
    margin-bottom: 10px; cursor: pointer; transition: color var(--transition);
  }
  .lp-footer-col a:hover { color: var(--t0); }
  .lp-footer-bottom {
    border-top: 1px solid var(--bdr); padding-top: 22px;
    display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px;
  }
  .lp-footer-bottom span { font-family: var(--fm); font-size: 11px; color: var(--t4); }

  /* ─── SCROLL REVEAL ──────────────────────────────── */
  .lp-reveal { opacity:0; transform:translateY(20px); transition:opacity 0.65s ease, transform 0.65s ease; }
  .lp-reveal.visible { opacity:1; transform:none; }

  /* ─── RESPONSIVE ─────────────────────────────────── */
  @media (max-width: 1100px) {
    .lp-hero { grid-template-columns: 1fr; padding: 80px 32px 72px; gap: 56px; }
    .lp-stats-inner { grid-template-columns: 1fr 1fr; }
    .lp-stat { padding: 36px 28px; }
    .lp-feat-grid { grid-template-columns: 1fr 1fr; }
    .lp-compliance-grid { grid-template-columns: 1fr 1fr; }
    .lp-steps { grid-template-columns: 1fr 1fr; gap: 36px; }
    .lp-steps::before { display: none; }
    .lp-carrier-grid { grid-template-columns: 1fr 1fr; }
    .lp-cta-inner { padding: 52px 44px; }
    .lp-quote-grid { grid-template-columns: 1fr; }
  }
  @media (max-width: 768px) {
    .lp-nav-links { display: none; }
    .lp-nav-inner { padding: 0 24px; }
    .lp-pipeline .lp-section-inner,
    .lp-features .lp-section-inner,
    .lp-carriers .lp-section-inner,
    .lp-quotes .lp-section-inner,
    .lp-compliance .lp-section-inner { padding-left: 24px; padding-right: 24px; }
    .lp-cta-section, .lp-footer { padding-left: 24px; padding-right: 24px; }
    .lp-feat-grid { grid-template-columns: 1fr; }
    .lp-steps { grid-template-columns: 1fr 1fr; }
    .lp-cta-inner { padding: 40px 28px; flex-direction: column; }
  }
  @media (max-width: 480px) {
    .lp-compliance-grid, .lp-steps { grid-template-columns: 1fr; }
    .lp-carrier-grid { grid-template-columns: 1fr; }
    .lp-stats-inner { grid-template-columns: 1fr 1fr; }
    .lp-stat-num { font-size: 40px; }
    .lp-hero { padding-top: 60px; }
    .lp-ticker { display: none; }
    .lp-nav { top: 0; }
    .lp-hero-wrap { padding-top: 60px; }
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
    { id: '#SL-847291', desc: 'Crown — Unit 14, D2710',      amt: '$1,240', status: 'approved' },
    { id: '#SL-847180', desc: 'Root Canal — Unit 26, D3330', amt: '$890',   status: 'calling'  },
    { id: '#SL-847055', desc: 'Scaling & Root Planing',      amt: '$420',   status: 'approved' },
    { id: '#SL-846990', desc: 'Composite Restoration',       amt: '$280',   status: 'pending'  },
  ],
  'Canada Life': [
    { id: '#CL-1048231', desc: 'Full Gold Crown — D2710',  amt: '$1,480', status: 'approved' },
    { id: '#CL-1048189', desc: 'Periodontal Maintenance',  amt: '$310',   status: 'calling'  },
    { id: '#CL-1048102', desc: 'Bitewing X-rays ×4',       amt: '$96',    status: 'approved' },
  ],
  'Manulife': [
    { id: '#MFC-39821', desc: 'Implant Crown — D6065', amt: '$2,100', status: 'calling'  },
    { id: '#MFC-39799', desc: 'Extraction, Surgical',  amt: '$380',   status: 'approved' },
    { id: '#MFC-39744', desc: 'Night Guard — D9940',   amt: '$560',   status: 'pending'  },
  ],
  'Green Shield': [
    { id: '#GS-20847', desc: 'Bridge Pontic — D6240',   amt: '$940', status: 'approved' },
    { id: '#GS-20831', desc: 'Composite — Class II',     amt: '$245', status: 'approved' },
    { id: '#GS-20810', desc: 'Recall + Prophylaxis',     amt: '$182', status: 'calling'  },
  ],
  'RBC Insurance': [
    { id: '#RBC-58320', desc: 'Porcelain Crown — D2712', amt: '$1,320', status: 'approved' },
    { id: '#RBC-58291', desc: 'Emergency Exam + PA',      amt: '$130',   status: 'approved' },
  ],
  'TELUS AdjudiCare': [
    { id: '#TA-67021', desc: 'Scaling, per unit ×4',   amt: '$310', status: 'approved' },
    { id: '#TA-66998', desc: 'Inlay, Ceramic — D2410', amt: '$780', status: 'calling'  },
  ],
}

const TICKER_ITEMS = [
  { carrier: 'Sun Life',         id: '#SL-847291', amt: '$1,240', action: 'resolved' },
  { carrier: 'Canada Life',      id: '#CL-1048231', amt: '$1,480', action: 'resolved' },
  { carrier: 'Manulife',         id: '#MFC-39799', amt: '$380',   action: 'resolved' },
  { carrier: 'Green Shield',     id: '#GS-20847',  amt: '$940',   action: 'resolved' },
  { carrier: 'Sun Life',         id: '#SL-847055', amt: '$420',   action: 'resolved' },
  { carrier: 'RBC Insurance',    id: '#RBC-58320', amt: '$1,320', action: 'resolved' },
  { carrier: 'TELUS AdjudiCare', id: '#TA-67021',  amt: '$310',   action: 'resolved' },
  { carrier: 'Canada Life',      id: '#CL-1048102', amt: '$96',   action: 'resolved' },
]

const FEATURES = [
  {
    icon: <svg viewBox="0 0 24 24"><path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>,
    h: 'Carrier-Specific IVR Navigation',
    p: 'Each of the six carriers runs a different IVR structure. CollectRx maintains dedicated navigation paths per carrier, updated whenever systems change.',
  },
  {
    icon: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>,
    h: 'Live Claim Status Propagation',
    p: 'As each call resolves, claim state is written back in real time. Your team sees current status on every outstanding claim without touching a phone.',
  },
  {
    icon: <svg viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>,
    h: 'PHI Tokenization at the Boundary',
    p: 'Patient identifiers are replaced with UUID tokens before any data reaches the AI layer. Names, DOBs, and health card numbers never leave your server.',
  },
  {
    icon: <svg viewBox="0 0 24 24"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
    h: 'Structured Denial Escalation',
    p: 'Denied claims immediately capture the reason code, flag re-submission requirements, and route persistent denials to human review with full context.',
  },
  {
    icon: <svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><path d="M8 21h8M12 17v4" /></svg>,
    h: 'Direct PMS Integration',
    p: 'Works with any practice management software. A weekly export of outstanding insurance balances is all it takes — no API integration, no IT setup.',
  },
  {
    icon: <svg viewBox="0 0 24 24"><path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
    h: 'AR Intelligence Reporting',
    p: 'Weekly summaries show collected revenue, pending adjudication by carrier, denial rates, and claims requiring human attention — by type and aging bucket.',
  },
]

const TRUST = [
  {
    icon: <svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>,
    h: 'PHIPA Architecture',
    p: 'Patient health information is tokenized before it reaches the AI layer. Compliance is enforced structurally, not by policy.',
  },
  {
    icon: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20" /></svg>,
    h: 'PIPEDA Compliant',
    p: 'Built to Canadian federal privacy standards. Data residency, consent handling, and subject access rights are built into the platform.',
  },
  {
    icon: <svg viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg>,
    h: 'PHI On Your Infrastructure',
    p: 'No patient identifiers are transmitted to any external service or US-hosted AI. Health data stays within your system boundaries.',
  },
  {
    icon: <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>,
    h: 'Business Hours Enforcement',
    p: 'All carrier calls are placed Mon–Fri, 8am–5pm Eastern. Call frequency limits and scheduling windows are enforced at the system level.',
  },
]

const PIPELINE_STEPS = [
  {
    icon: <svg viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>,
    label: 'Claim Detected',
    desc: 'Outstanding claims pulled from your PMS automatically. No manual entry required.',
  },
  {
    icon: <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>,
    label: 'PHI Removed',
    desc: 'Patient identifiers replaced with secure UUID tokens before any AI processing.',
  },
  {
    icon: <svg viewBox="0 0 24 24"><path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>,
    label: 'Carrier Called',
    desc: 'AI navigates the carrier IVR, speaks with reps, and captures adjudication status.',
  },
  {
    icon: <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>,
    label: 'Status Written Back',
    desc: 'Result recorded: approved, denied with reason code, or escalated for human review.',
  },
]

const TESTIMONIALS = [
  {
    body: "We were spending four to five hours a week just on hold with insurance carriers. That time is completely gone now. The claims that used to age past 90 days are now resolved by day 35.",
    name: 'Dr. Sarah Chen',
    title: 'Practice Owner — North York, ON',
    initials: 'SC',
  },
  {
    body: "The PHIPA compliance piece was what convinced us. We had reservations about any AI touching patient workflows. Knowing that identifiers never leave our server made this a straightforward decision.",
    name: 'Dr. Michael Patel',
    title: 'Managing Partner — Dental Group, Mississauga',
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
function Ticker() {
  const items = [...TICKER_ITEMS, ...TICKER_ITEMS] // double for seamless loop
  return (
    <div className="lp-ticker">
      <div className="lp-ticker-label">
        <div className="lp-ticker-dot" />
        Live
      </div>
      <div style={{ overflow: 'hidden', flex: 1 }}>
        <div className="lp-ticker-track">
          {items.map((t, i) => (
            <span className="lp-ticker-item" key={i}>
              <span className="lp-ticker-sep">▪</span>
              {t.carrier} · {t.id} · <em>{t.amt}</em> {t.action}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function Waveform() {
  return (
    <div className="lp-waveform">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="lp-wave-bar" />
      ))}
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
        <div className="lp-ops-live"><div className="lp-ops-live-dot" />Live</div>
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
          <strong>{approved}/{claims.length}</strong> resolved · <strong>${total.toLocaleString('en-CA')}</strong>
        </span>
        <div className="lp-ops-mini-stats">
          <div className="lp-ops-mini-stat">
            <span className="lp-ops-mini-num">14</span>
            <span className="lp-ops-mini-lbl">Today</span>
          </div>
          <div className="lp-ops-mini-stat">
            <span className="lp-ops-mini-num">$24.2k</span>
            <span className="lp-ops-mini-lbl">Resolved</span>
          </div>
        </div>
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

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const [active, setActive] = useState(0)
  const scrolled = useScrolled()
  useReveal()

  const scrollTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })

  return (
    <>
      <style>{STYLES}</style>
      <div className="lp">

        {/* ── TICKER ── */}
        <Ticker />

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
              <span className="lp-nav-link" onClick={() => scrollTo('how-it-works')}>How it Works</span>
              <span className="lp-nav-link" onClick={() => scrollTo('features')}>Features</span>
              <span className="lp-nav-link" onClick={() => scrollTo('carriers')}>Carriers</span>
              <span className="lp-nav-link" onClick={() => scrollTo('compliance')}>Compliance</span>
            </div>
            <div className="lp-nav-right">
              <Link to="/login" className="lp-nav-signin">Practice sign in</Link>
              <button type="button" className="lp-nav-cta" onClick={() => scrollTo('cta')}>
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
              <div className="lp-hero-eyebrow">
                <div className="lp-eyebrow-pulse" />
                Canadian Dental AR Automation · Early Access
              </div>
              <h1 className="lp-h1">
                Your insurance AR,<br />
                <em>resolved automatically.</em>
              </h1>
              <p className="lp-hero-body">
                CollectRx runs outstanding claims through a complete AI follow-up pipeline —
                carrier-specific IVR navigation, live adjudication tracking, and denial
                escalation, without your staff on hold.
              </p>
              <div className="lp-hero-btns">
                <button className="lp-btn-primary" onClick={() => scrollTo('cta')}>
                  Request Early Access
                  <svg viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                </button>
                <button className="lp-btn-ghost" onClick={() => scrollTo('how-it-works')}>
                  <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" /></svg>
                  See how it works
                </button>
              </div>
              <div className="lp-trust-row">
                {['PHIPA compliant by design', '6 major Canadian carriers', 'No IT setup required'].map(t => (
                  <div className="lp-trust-item" key={t}>
                    <svg className="lp-trust-check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8">
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                    {t}
                  </div>
                ))}
              </div>
            </div>

            {/* Right — Operations Panel */}
            <OpsPanel active={active} onSelect={setActive} />
          </section>
        </div>

        {/* ── STATS BAND ── */}
        <div className="lp-stats lp-reveal">
          <div className="lp-stats-inner">
            <StatNum target={6}  suffix=" carriers" label="Major Canadian carriers integrated" />
            <StatNum target={78} suffix="%"          label="Private dental market covered" />
            <StatNum target={12} suffix="h"          label="Front-desk hours recovered per week" />
            <StatNum target={3}  suffix=" attempts"  label="Maximum per claim before escalation" />
          </div>
        </div>

        {/* ── HOW IT WORKS ── */}
        <section className="lp-pipeline" id="how-it-works">
          <div className="lp-section-inner">
            <div className="lp-reveal">
              <div className="lp-eyebrow dark">How it Works</div>
              <h2 className="lp-section-h2 on-light">
                Four steps.<br /><em>Zero staff time.</em>
              </h2>
            </div>
            <div className="lp-steps lp-reveal">
              {PIPELINE_STEPS.map((s, i) => (
                <div className="lp-step" key={s.label}>
                  <div className="lp-step-num">Step {i + 1}</div>
                  <div className="lp-step-icon">{s.icon}</div>
                  <div className="lp-step-label">{s.label}</div>
                  <div className="lp-step-desc">{s.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── FEATURES ── */}
        <section className="lp-features" id="features">
          <div className="lp-section-inner">
            <div className="lp-reveal">
              <div className="lp-eyebrow green">Platform</div>
              <h2 className="lp-section-h2 on-dark">
                Built for the specific realities<br />of <em>Canadian dental AR.</em>
              </h2>
            </div>
            <div className="lp-feat-grid">
              {FEATURES.map((f, i) => (
                <div className="lp-feat lp-reveal" key={f.h} style={{ transitionDelay: `${i * 55}ms` }}>
                  <div className="lp-feat-icon">{f.icon}</div>
                  <div className="lp-feat-h">{f.h}</div>
                  <div className="lp-feat-p">{f.p}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CARRIERS ── */}
        <section className="lp-carriers" id="carriers">
          <div className="lp-section-inner">
            <div className="lp-reveal">
              <div className="lp-eyebrow dark">Carrier Coverage</div>
              <h2 className="lp-section-h2 on-light" style={{ marginBottom: 14 }}>
                Six carriers.<br /><em>78% of the market.</em>
              </h2>
              <p className="lp-section-sub on-light">
                Each integration handles the full call workflow for that carrier — IVR navigation,
                hold patterns, rep protocols, and status formats. Select a carrier to preview
                how CollectRx processes its claims.
              </p>
            </div>
            <div className="lp-carrier-grid lp-reveal">
              {CARRIERS.map((c, i) => (
                <div
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
                </div>
              ))}
            </div>
            <p className="lp-carriers-note lp-reveal">
              Together these carriers represent approximately 78% of Canadian private dental insurance.
            </p>
          </div>
        </section>

        {/* ── TESTIMONIALS ── */}
        <section className="lp-quotes">
          <div className="lp-section-inner">
            <div className="lp-reveal" style={{ padding: '100px 40px 0' }}>
              <div className="lp-eyebrow green">Early Access</div>
              <h2 className="lp-section-h2 on-dark" style={{ marginBottom: 40 }}>
                What practices say.
              </h2>
            </div>
            <div className="lp-quote-grid lp-reveal" style={{ padding: '0 40px 100px' }}>
              {TESTIMONIALS.map(t => (
                <div className="lp-quote" key={t.name}>
                  <div className="lp-quote-mark">"</div>
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
            <div className="lp-reveal" style={{ padding: '100px 40px 0' }}>
              <div className="lp-eyebrow green">Compliance</div>
              <h2 className="lp-section-h2 on-dark" style={{ marginBottom: 14 }}>
                Compliance is the architecture,<br /><em>not the afterthought.</em>
              </h2>
              <p className="lp-section-sub">
                In healthcare, privacy built in after the fact is privacy that fails.
                In CollectRx, PHI protection is a structural requirement — not a configuration option.
              </p>
            </div>
            <div className="lp-compliance-grid lp-reveal" style={{ padding: '0 40px 100px' }}>
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
            <div>
              <div className="lp-cta-tag">Early Access</div>
              <h2 className="lp-cta-h">
                The AR work is already<br /><em>getting done.</em>
              </h2>
              <p className="lp-cta-body">
                Now live with Canadian dental practices. No setup fees.
                No long-term contract. If CollectRx doesn't recover revenue you were
                already leaving behind, you pay nothing.
              </p>
            </div>
            <div className="lp-cta-actions">
              <button className="lp-cta-btn-primary">Request Early Access</button>
              <button className="lp-cta-btn-outline">Book a Demo</button>
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
                  <a onClick={() => scrollTo('how-it-works')}>How it Works</a>
                  <a onClick={() => scrollTo('features')}>Features</a>
                  <a onClick={() => scrollTo('carriers')}>Carriers</a>
                  <a onClick={() => scrollTo('compliance')}>Compliance</a>
                </div>
                <div className="lp-footer-col">
                  <h4>Access</h4>
                  <Link to="/login">Practice sign in</Link>
                  <a onClick={() => scrollTo('cta')}>Request access</a>
                  <a onClick={() => scrollTo('cta')}>Book a demo</a>
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

      </div>
    </>
  )
}
