import type { PracticeSettings } from '../../types/practiceSettings.js';

export interface ReadinessItem {
  id: string;
  title: string;
  detail: string;
  done: boolean;
  href: string;
}

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Settings-level conditions that must hold before any carrier call can be
 * placed, each with a plain-language reason (B-13). Mirrors the gates in
 * `checkCarrierAuthorizationGate` and the staff gate so a practice sees why
 * nothing is dialing before it asks.
 */
export function dialReadinessItems(settings: PracticeSettings): ReadinessItem[] {
  const ready = settings.carrierConfigs.filter(
    (c) => c.enabled && c.authorizationSubmitted && (c.providerNumber ?? '').trim() !== '',
  );
  const humanAssisted = settings.humanAssistedMode !== false;
  const items: ReadinessItem[] = [
    {
      id: 'carrier_authorized',
      title: 'At least one carrier ready to call',
      detail:
        'Enable a carrier, enter your provider number, and confirm the authorization letter has been sent to that carrier.',
      done: ready.length > 0,
      href: '/settings',
    },
  ];
  if (humanAssisted) {
    items.push({
      id: 'staff_phone',
      title: 'Front desk phone number',
      detail: 'This is the line we transfer to when a carrier rep answers.',
      done: E164.test((settings.escalationPhoneNumber ?? '').trim()),
      href: '/settings',
    });
    items.push({
      id: 'staff_availability',
      title: 'Hours staff can take a call',
      detail:
        'Set when someone can pick up so calls are not placed while the front desk is busy. Without hours, calls can ring at any time in the call window.',
      done: (settings.staffAvailability?.windows?.length ?? 0) > 0,
      href: '/settings',
    });
  }
  return items;
}
