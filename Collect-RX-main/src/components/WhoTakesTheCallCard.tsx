import { Button, Card, CardHeader, Input, Select } from './ui'
import { ROLE_LABELS, type PracticeRole } from '../lib/authTypes'
import {
  STAFFED_DAYS,
  STAFFED_DAY_LABELS,
  defaultStaffedHours,
  type StaffedDay,
  type StaffedDayHours,
} from '../lib/staffedHours'
import type { PracticeSettings } from '../types/practiceSettings'

export interface StaffOption {
  id: string
  displayName: string
  role: PracticeRole
  isActive: boolean
}

interface WhoTakesTheCallCardProps {
  settings: PracticeSettings
  onChange: (next: PracticeSettings) => void
  disabled: boolean
  /** The practice's IANA timezone, shown so staff know which clock the hours use. */
  timeZone: string
  staff: StaffOption[]
  staffLoadFailed: boolean
}

const timeInputClass =
  'text-sm border rounded px-2 py-1 dark:bg-gray-800 dark:border-gray-600 disabled:opacity-50'

export function WhoTakesTheCallCard({
  settings,
  onChange,
  disabled,
  timeZone,
  staff,
  staffLoadFailed,
}: WhoTakesTheCallCardProps) {
  const hours = settings.staffedHours
  const activeStaff = staff.filter((s) => s.isActive)
  const designated = settings.designatedIndividualUserId ?? ''
  const designatedMissing = designated !== '' && !activeStaff.some((s) => s.id === designated)

  function setDay(day: StaffedDay, patch: Partial<StaffedDayHours>) {
    const base = hours ?? defaultStaffedHours()
    onChange({ ...settings, staffedHours: { ...base, [day]: { ...base[day], ...patch } } })
  }

  return (
    <Card>
      <CardHeader
        title="Who takes the call, and when"
        subtitle="When a carrier rep answers, the call transfers to the designated individual's phone and a screen alert goes to the desk."
      />
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl">
          <Select
            label="Designated individual"
            value={designated}
            disabled={disabled}
            onChange={(e) => onChange({ ...settings, designatedIndividualUserId: e.target.value })}
          >
            <option value="">Not chosen yet</option>
            {designatedMissing && <option value={designated}>(no longer an active user)</option>}
            {activeStaff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.displayName} ({ROLE_LABELS[s.role]})
              </option>
            ))}
          </Select>
          <Input
            label="Escalation phone (E.164)"
            hint="Where calls transfer to your staff once a rep answers. Start with + and the country code, like +16135550100."
            value={settings.escalationPhoneNumber}
            disabled={disabled}
            onChange={(e) => onChange({ ...settings, escalationPhoneNumber: e.target.value })}
          />
        </div>
        {staffLoadFailed && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Your staff list could not be loaded, so the designated individual cannot be changed right now.
          </p>
        )}

        <div className="space-y-2">
          <div>
            <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Staffed hours</h4>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              When someone is at the desk to take a transferred call. Times use your practice clock
              ({timeZone || 'Eastern, the default'}). CollectRx only starts a call when both these hours and its own
              calling hours (Mon to Fri, 08:00 to 17:00 Eastern) are open.
            </p>
          </div>
          {hours ? (
            <div className="space-y-2 max-w-xl">
              {STAFFED_DAYS.map((day) => {
                const d = hours[day]
                return (
                  <div key={day} className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-300">
                    <label className="flex items-center gap-2 w-40">
                      <input
                        type="checkbox"
                        checked={d.open}
                        disabled={disabled}
                        onChange={(e) => setDay(day, { open: e.target.checked })}
                        className="rounded border-gray-300 text-crx-600 focus:ring-crx-500"
                      />
                      {STAFFED_DAY_LABELS[day]}
                    </label>
                    {d.open ? (
                      <>
                        <input
                          type="time"
                          aria-label={`${STAFFED_DAY_LABELS[day]} start`}
                          className={timeInputClass}
                          value={d.start}
                          disabled={disabled}
                          onChange={(e) => setDay(day, { start: e.target.value })}
                        />
                        <span>to</span>
                        <input
                          type="time"
                          aria-label={`${STAFFED_DAY_LABELS[day]} end`}
                          className={timeInputClass}
                          value={d.end}
                          disabled={disabled}
                          onChange={(e) => setDay(day, { end: e.target.value })}
                        />
                      </>
                    ) : (
                      <span className="text-gray-400 dark:text-gray-500">Closed</span>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                No staffed hours set yet, so calls follow CollectRx's calling hours only.
              </p>
              <Button
                variant="secondary"
                size="sm"
                disabled={disabled}
                onClick={() => onChange({ ...settings, staffedHours: defaultStaffedHours() })}
              >
                Set staffed hours
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
