import React from 'react';
import * as Icons from './Icons';

type Page =
  | 'dashboard'
  | 'balances'
  | 'patient-ar'
  | 'estimates'
  | 'analytics'
  | 'report'
  | 'admin';

interface SidebarProps {
  currentPage: Page;
  setPage: (page: Page) => void;
}

const NAV_ITEMS: { id: Page; label: string; Icon: React.FC }[] = [
  { id: 'dashboard', label: 'Dashboard', Icon: Icons.Home },
  { id: 'balances', label: 'Insurance AR', Icon: Icons.DollarSign },
  { id: 'patient-ar', label: 'Patient AR', Icon: Icons.Users },
  { id: 'estimates', label: 'Estimates', Icon: Icons.FileText },
  { id: 'analytics', label: 'Analytics', Icon: Icons.BarChart },
  { id: 'report', label: 'Monthly Report', Icon: Icons.Calendar },
  { id: 'admin', label: 'Settings', Icon: Icons.Settings },
];

export function Sidebar({ currentPage, setPage }: SidebarProps) {
  return (
    <nav className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <div className="logo-icon"><Icons.Zap /></div>
          <span className="logo-text">CollectRx</span>
        </div>
      </div>

      <div className="sidebar-nav">
        <div className="nav-section">
          <div className="nav-section-title">Menu</div>
          {NAV_ITEMS.map(({ id, label, Icon }) => (
            <div
              key={id}
              className={`nav-item ${currentPage === id ? 'active' : ''}`}
              onClick={() => setPage(id)}
            >
              <Icon />
              {label}
            </div>
          ))}
        </div>
      </div>

      <div className="sidebar-footer">
        <div className="practice-selector">
          <div className="practice-avatar">SD</div>
          <div className="practice-info">
            <div className="practice-name">Smile Dental Care</div>
            <div className="practice-detail">Toronto, ON</div>
          </div>
        </div>
      </div>
    </nav>
  );
}
