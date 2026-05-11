import React, { useState } from 'react';
import {
  TrendingUp,
  DollarSign,
  CheckCircle,
  AlertCircle,
  Phone,
  Upload,
  Settings,
  MoreVertical,
  Home,
  FileText,
  PhoneCall,
  Menu,
  User,
  ChevronRight,
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

// Chart data
const weeklyData = [
  { day: 'Mon', processed: 32, approved: 30 },
  { day: 'Tue', processed: 45, approved: 42 },
  { day: 'Wed', processed: 38, approved: 35 },
  { day: 'Thu', processed: 52, approved: 49 },
  { day: 'Fri', processed: 48, approved: 46 },
  { day: 'Sat', processed: 28, approved: 27 },
  { day: 'Sun', processed: 24, approved: 22 },
];

// Recent calls data
const recentCalls = [
  {
    id: 1,
    patientName: 'Sarah Mitchell',
    practice: "Dr. Ahmed's Clinic",
    time: '2:34 PM',
    status: 'approved',
    insurance: 'Sun Life',
    amount: '$1,250',
  },
  {
    id: 2,
    patientName: 'James Chen',
    practice: 'Smile Dental Center',
    time: '1:12 PM',
    status: 'approved',
    insurance: 'Manulife',
    amount: '$890',
  },
  {
    id: 3,
    patientName: 'Emma Thompson',
    practice: "Dr. Hassan's Practice",
    time: '12:45 PM',
    status: 'pending',
    insurance: 'Great-West Life',
    amount: '$2,400',
  },
  {
    id: 4,
    patientName: 'Michael Rodriguez',
    practice: 'Bright Smile Dental',
    time: '11:20 AM',
    status: 'approved',
    insurance: 'Canada Life',
    amount: '$650',
  },
  {
    id: 5,
    patientName: 'Lisa Park',
    practice: 'Downtown Dental',
    time: '10:05 AM',
    status: 'approved',
    insurance: 'Desjardins',
    amount: '$1,100',
  },
];

// Pending claims data
const pendingClaims = [
  {
    id: 1,
    patientName: 'John Smith',
    insurance: 'Sun Life',
    amount: '$2,400',
    reason: 'Coverage verification pending',
    daysAgo: 2,
    urgent: true,
  },
  {
    id: 2,
    patientName: 'Alice Johnson',
    insurance: 'Manulife',
    amount: '$1,800',
    reason: 'Waiting for patient response',
    daysAgo: 1,
    urgent: false,
  },
  {
    id: 3,
    patientName: 'Robert Williams',
    insurance: 'Great-West Life',
    amount: '$3,200',
    reason: 'Pre-authorization required',
    daysAgo: 1,
    urgent: false,
  },
];

// Metric Card Component
const MetricCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string | number;
  trend: string;
  trendPositive: boolean;
}> = ({ icon, label, value, trend, trendPositive }) => (
  <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm hover:shadow-md transition-shadow">
    <div className="flex items-start justify-between mb-4">
      <div className="text-emerald-500">{icon}</div>
    </div>
    <p className="text-gray-600 text-sm mb-2">{label}</p>
    <div className="mb-3">
      <p className="text-3xl font-bold text-gray-900">{value}</p>
    </div>
    <div className={`flex items-center gap-1 text-xs ${trendPositive ? 'text-emerald-600' : 'text-amber-600'}`}>
      {trendPositive ? '↑' : '↑'} {trend}
    </div>
  </div>
);

// Recent Call Item Component
const CallItem: React.FC<(typeof recentCalls)[0]> = ({
  patientName,
  practice,
  time,
  status,
  insurance,
  amount,
}) => (
  <div className="border-b border-gray-200 p-4 hover:bg-gray-50 transition-colors cursor-pointer">
    <div className="flex justify-between items-start mb-2">
      <div>
        <p className="font-medium text-gray-900">{patientName}</p>
        <p className="text-xs text-gray-500">{practice}</p>
      </div>
      <span className="text-xs text-gray-500">{time}</span>
    </div>
    <div className="flex items-center gap-1 mb-2">
      <span
        className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded ${
          status === 'approved'
            ? 'bg-emerald-50 text-emerald-700'
            : 'bg-amber-50 text-amber-700'
        }`}
      >
        {status === 'approved' ? (
          <>
            <CheckCircle size={14} /> Approved
          </>
        ) : (
          <>
            <AlertCircle size={14} /> Pending
          </>
        )}
      </span>
    </div>
    <div className="flex justify-between text-xs text-gray-600">
      <span>{insurance}</span>
      <span className="font-medium text-gray-900">{amount}</span>
    </div>
  </div>
);

// Pending Claim Item Component
const PendingClaimItem: React.FC<(typeof pendingClaims)[0]> = ({
  patientName,
  insurance,
  amount,
  reason,
  daysAgo,
  urgent,
}) => (
  <div
    className={`border-l-4 p-4 rounded-r-lg mb-3 ${
      urgent
        ? 'border-l-red-500 bg-red-50'
        : 'border-l-amber-500 bg-amber-50'
    } hover:shadow-md transition-shadow cursor-pointer`}
  >
    <div className="flex justify-between items-start mb-2">
      <div className="flex items-start gap-2">
        {urgent && <span className="text-lg">🔴</span>}
        <div>
          <p className="font-medium text-gray-900">{patientName}</p>
          <p className="text-xs text-gray-600">{insurance} • {amount}</p>
        </div>
      </div>
      <ChevronRight size={18} className="text-gray-400" />
    </div>
    <p className={`text-xs ${urgent ? 'text-red-700' : 'text-amber-700'} mb-1`}>
      {reason}
    </p>
    <p className="text-xs text-gray-500">Pending since {daysAgo} day{daysAgo > 1 ? 's' : ''} ago</p>
  </div>
);

// Main Dashboard Component
export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('dashboard');

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-gray-200">
        <div className="flex items-center justify-between px-4 py-4 md:px-6 md:py-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center text-white font-bold">
              C
            </div>
            <h1 className="text-xl font-bold text-gray-900 hidden sm:block">CollectRx</h1>
          </div>
          <h2 className="text-lg font-semibold text-gray-900">Dashboard</h2>
          <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <Settings size={20} className="text-gray-700" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="pb-20 md:pb-0">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8">
          {/* Metrics Section */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <MetricCard
              icon={<CheckCircle size={24} />}
              label="Processed this week"
              value={247}
              trend="12% vs last week"
              trendPositive
            />
            <MetricCard
              icon={<DollarSign size={24} />}
              label="Collected this week"
              value="$18,540"
              trend="8% vs last week"
              trendPositive
            />
            <MetricCard
              icon={<TrendingUp size={24} />}
              label="Claims approved"
              value="94%"
              trend="2% vs last week"
              trendPositive
            />
            <MetricCard
              icon={<AlertCircle size={24} />}
              label="Awaiting action"
              value={23}
              trend="3 less than yesterday"
              trendPositive
            />
          </div>

          {/* Chart Section */}
          <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Weekly Performance</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={weeklyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="day" stroke="#6B7280" />
                <YAxis stroke="#6B7280" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#FFFFFF',
                    border: '1px solid #E5E7EB',
                    borderRadius: '6px',
                  }}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="processed"
                  stroke="#10B981"
                  name="Processed"
                  strokeWidth={2}
                  dot={{ fill: '#10B981', r: 4 }}
                />
                <Line
                  type="monotone"
                  dataKey="approved"
                  stroke="#6EE7B7"
                  name="Approved"
                  strokeWidth={2}
                  dot={{ fill: '#6EE7B7', r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Recent Calls & Pending Claims Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Recent Calls Section */}
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Recent Calls</h3>
                    <p className="text-xs text-gray-500 mt-1">Last 24 hours</p>
                  </div>
                  <button className="text-emerald-600 text-sm font-medium hover:text-emerald-700">
                    View all →
                  </button>
                </div>
              </div>
              <div className="divide-y divide-gray-200 max-h-96 overflow-y-auto">
                {recentCalls.map((call) => (
                  <CallItem key={call.id} {...call} />
                ))}
              </div>
            </div>

            {/* Pending Claims Section */}
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Pending Claims</h3>
                  <p className="text-xs text-gray-500 mt-1">Need review or resubmission</p>
                </div>
                <button className="text-emerald-600 text-sm font-medium hover:text-emerald-700">
                  View all →
                </button>
              </div>
              <div className="space-y-3">
                {pendingClaims.map((claim) => (
                  <PendingClaimItem key={claim.id} {...claim} />
                ))}
              </div>
            </div>
          </div>

          {/* Quick Actions Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
            <button className="bg-emerald-500 hover:bg-emerald-600 text-white font-medium py-3 px-6 rounded-lg flex items-center justify-center gap-2 transition-colors shadow-sm">
              <Phone size={20} />
              <span>Start New Call</span>
            </button>
            <button className="bg-white border border-gray-200 hover:bg-gray-50 text-gray-900 font-medium py-3 px-6 rounded-lg flex items-center justify-center gap-2 transition-colors">
              <Upload size={20} />
              <span>Import Claims</span>
            </button>
            <button className="bg-white border border-gray-200 hover:bg-gray-50 text-gray-900 font-medium py-3 px-6 rounded-lg flex items-center justify-center gap-2 transition-colors">
              <Settings size={20} />
              <span>Settings</span>
            </button>
          </div>
        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-gray-50 border-t border-gray-200">
        <div className="flex items-center justify-around h-16">
          {[
            { id: 'dashboard', icon: Home, label: 'Dashboard' },
            { id: 'claims', icon: FileText, label: 'Claims' },
            { id: 'calls', icon: PhoneCall, label: 'Calls' },
            { id: 'settings', icon: Settings, label: 'Settings' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-col items-center justify-center w-16 h-16 gap-1 transition-colors ${
                activeTab === tab.id
                  ? 'text-emerald-500'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <tab.icon size={24} />
              <span className="text-xs font-medium">{tab.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
