import { NavLink } from 'react-router-dom'

const links = [
  { to: '/',            label: 'Dashboard',   icon: '▦' },
  { to: '/claims',      label: 'Claims',      icon: '📋' },
  { to: '/escalations', label: 'Escalations', icon: '🚨' },
  { to: '/reports',     label: 'Reports',     icon: '📊' },
  { to: '/settings',    label: 'Settings',    icon: '⚙️' },
]

export default function Sidebar() {
  return (
    <aside className="w-56 min-h-screen bg-gray-900 text-white flex flex-col">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-gray-700">
        <span className="text-xl font-bold tracking-tight text-white">Collect<span className="text-sky-400">Rx</span></span>
        <p className="text-xs text-gray-400 mt-0.5">Collections OS</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {links.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-sky-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`
            }
          >
            <span>{icon}</span>
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-gray-700 text-xs text-gray-500">
        Backend: localhost:3000
      </div>
    </aside>
  )
}
