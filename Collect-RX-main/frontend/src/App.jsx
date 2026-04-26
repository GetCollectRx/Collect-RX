import { Routes, Route } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import Claims from './pages/Claims'
import Escalations from './pages/Escalations'
import Reports from './pages/Reports'
import Settings from './pages/Settings'

export default function App() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route path="/"            element={<Dashboard />} />
          <Route path="/claims"      element={<Claims />} />
          <Route path="/escalations" element={<Escalations />} />
          <Route path="/reports"     element={<Reports />} />
          <Route path="/settings"    element={<Settings />} />
        </Routes>
      </main>
    </div>
  )
}
