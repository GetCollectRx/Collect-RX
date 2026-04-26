import { useState, useEffect } from 'react'
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDivider,
  Input,
  Breadcrumb,
  Badge,
  useToast,
  type ToastVariant,
} from '../components/base'

interface AppSettings {
  abeldentServer?      : string
  abeldentDatabase?    : string
  practiceId?          : string
  railwayUrl?          : string
  railwayToken?        : string
  syncIntervalMinutes? : number
}

interface SyncStatus {
  status    : string
  message   : string
  lastSyncAt: string | null
}

const isElectron = typeof window !== 'undefined' && !!(window as any).collectrx

function syncVariant(status: string): 'success' | 'error' | 'warning' | 'neutral' {
  if (status === 'healthy')  return 'success'
  if (status === 'error')    return 'error'
  if (status === 'starting') return 'warning'
  return 'neutral'
}

function formatLastSync(iso: string | null) {
  if (!iso) return 'Never'
  return new Date(iso).toLocaleString()
}

export default function Settings() {
  const { toast } = useToast()
  const showToast = (variant: ToastVariant, title: string) => toast({ variant, title })
  const [settings, setSettings]     = useState<AppSettings>({})
  const [saved, setSaved]           = useState(false)
  const [saving, setSaving]         = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [testing, setTesting]       = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    if (!isElectron) return
    ;(window as any).collectrx.getSettings().then((s: AppSettings) => {
      setSettings({
        abeldentServer      : s.abeldentServer      ?? '',
        abeldentDatabase    : s.abeldentDatabase    ?? 'AbelDent',
        practiceId          : s.practiceId          ?? '',
        railwayUrl          : s.railwayUrl          ?? '',
        railwayToken        : s.railwayToken        ?? '',
        syncIntervalMinutes : s.syncIntervalMinutes ?? 15,
      })
    }).catch(console.error)

    ;(window as any).collectrx.getSyncStatus().then(setSyncStatus).catch(console.error)

    const unsub = (window as any).collectrx.onSyncStatusChange((s: SyncStatus) => setSyncStatus(s))
    return unsub
  }, [])

  function handleChange(field: keyof AppSettings, value: string | number) {
    setSettings(prev => ({ ...prev, [field]: value }))
    setSaved(false)
    setTestResult(null)
  }

  async function handleSave() {
    setSaving(true)
    try {
      if (isElectron) {
        const result = await (window as any).collectrx.saveSettings(settings)
        if (result.ok) {
          setSaved(true)
          showToast('success', 'Settings saved')
          setTimeout(() => setSaved(false), 3000)
        } else {
          showToast('error', 'Failed to save settings')
        }
      } else {
        const res = await fetch('/api/admin/settings', {
          method : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body   : JSON.stringify(settings),
        })
        if (res.ok) {
          setSaved(true)
          showToast('success', 'Settings saved')
          setTimeout(() => setSaved(false), 3000)
        } else {
          showToast('error', 'Failed to save settings')
        }
      }
    } catch (e: any) {
      showToast('error', e.message || 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  async function handleTestConnection() {
    setTesting(true)
    setTestResult(null)
    try {
      if (isElectron) {
        await (window as any).collectrx.saveSettings(settings)
        await (window as any).collectrx.triggerManualSync()
        await new Promise(r => setTimeout(r, 8000))
        const status = await (window as any).collectrx.getSyncStatus()
        const ok = status.status === 'healthy'
        setTestResult({ ok, message: status.message || (ok ? 'Connection successful!' : 'Connection failed.') })
        showToast(ok ? 'success' : 'error', ok ? 'Connection successful!' : 'Connection failed')
      } else {
        setTestResult({ ok: false, message: 'Connection test is only available in the desktop app.' })
      }
    } catch (e: any) {
      setTestResult({ ok: false, message: e.message })
      showToast('error', e.message)
    } finally {
      setTesting(false)
    }
  }

  return (
    <main className="px-4 py-6 md:px-6 pb-20 md:pb-6 max-w-2xl mx-auto space-y-6">
      <Breadcrumb items={[{ label: 'Dashboard', href: '/' }, { label: 'Settings' }]} />

      <div>
        <h1 className="text-xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Configure your AbelDent connection and sync preferences.</p>
      </div>

      {/* Sync status */}
      {syncStatus && (
        <Card padding="sm" className="flex items-center gap-3">
          <Badge variant={syncVariant(syncStatus.status)} dot size="md">
            {syncStatus.status.charAt(0).toUpperCase() + syncStatus.status.slice(1)}
          </Badge>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-500 truncate">{syncStatus.message}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs text-gray-400">Last sync</p>
            <p className="text-xs font-medium text-gray-600 tabular-nums">{formatLastSync(syncStatus.lastSyncAt)}</p>
          </div>
        </Card>
      )}

      {/* AbelDent connection */}
      <Card padding="md">
        <CardHeader>
          <CardTitle>AbelDent Database Connection</CardTitle>
        </CardHeader>
        <CardDivider />
        <div className="space-y-4 pt-4">
          <Input
            label="SQL Server Host"
            hint="e.g. (local)\\ABELDENT or 192.168.1.10"
            type="text"
            value={settings.abeldentServer ?? ''}
            onChange={e => handleChange('abeldentServer', e.target.value)}
            placeholder="(local)\ABELDENT"
          />
          <Input
            label="Database Name"
            type="text"
            value={settings.abeldentDatabase ?? ''}
            onChange={e => handleChange('abeldentDatabase', e.target.value)}
            placeholder="AbelDent"
          />
          <Input
            label="Practice ID"
            hint="UUID of this practice in CollectRx"
            type="text"
            value={settings.practiceId ?? ''}
            onChange={e => handleChange('practiceId', e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          />
        </div>
      </Card>

      {/* CollectRx backend */}
      <Card padding="md">
        <CardHeader>
          <CardTitle>CollectRx Backend</CardTitle>
        </CardHeader>
        <CardDivider />
        <div className="space-y-4 pt-4">
          <Input
            label="API URL"
            type="url"
            value={settings.railwayUrl ?? ''}
            onChange={e => handleChange('railwayUrl', e.target.value)}
            placeholder="https://collectrx.up.railway.app"
          />
          <Input
            label="API Token"
            hint="Service account JWT — never share this"
            type="password"
            value={settings.railwayToken ?? ''}
            onChange={e => handleChange('railwayToken', e.target.value)}
            placeholder="eyJ…"
            className="font-mono"
          />
        </div>
      </Card>

      {/* Sync settings */}
      <Card padding="md">
        <CardHeader>
          <CardTitle>Sync Settings</CardTitle>
        </CardHeader>
        <CardDivider />
        <div className="pt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Sync Interval
            <span className="ml-1.5 text-xs text-gray-400 font-normal">5–60 minutes</span>
          </label>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={5} max={60} step={5}
              value={settings.syncIntervalMinutes ?? 15}
              onChange={e => handleChange('syncIntervalMinutes', parseInt(e.target.value))}
              className="flex-1 accent-emerald-500"
              aria-label="Sync interval in minutes"
            />
            <span className="w-16 text-center text-sm font-semibold text-gray-700 bg-gray-100 py-1.5 px-2 rounded-md tabular-nums">
              {settings.syncIntervalMinutes ?? 15} min
            </span>
          </div>
        </div>
      </Card>

      {/* Test result */}
      {testResult && (
        <div className={`rounded-lg border px-4 py-3 text-sm flex items-center gap-2 ${
          testResult.ok
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            {testResult.ok ? (
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
            ) : (
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
            )}
          </svg>
          {testResult.message}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 pb-4">
        <Button
          onClick={handleSave}
          loading={saving}
          disabled={saving}
        >
          {saved ? 'Saved!' : 'Save Settings'}
        </Button>

        {isElectron && (
          <Button
            variant="secondary"
            onClick={handleTestConnection}
            loading={testing}
            disabled={testing || saving}
          >
            Test Connection
          </Button>
        )}
      </div>

      {!isElectron && (
        <p className="text-xs text-gray-400 pb-2">
          AbelDent connection settings are only active in the Windows desktop app.
        </p>
      )}
    </main>
  )
}
