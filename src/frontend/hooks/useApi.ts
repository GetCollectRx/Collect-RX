import type {
  DashboardResponse,
  PatientSummary,
  PaginatedPatients,
  PaymentLinkResponse,
  SendEmailResponse,
  PaginationQuery,
} from '../../types';

// Prefer same-origin `/api` (Vite proxy) so httpOnly cookies work. Override with VITE_API_URL for production.
const API_BASE = (import.meta.env.VITE_API_URL as string) || '/api';

let inMemoryPracticeId: string | null = null;

export function setSessionPracticeId(id: string) {
  inMemoryPracticeId = id;
}

function getPracticeId(): string {
  if (inMemoryPracticeId) {
    return inMemoryPracticeId;
  }
  return (
    (window as unknown as { __COLLECTRX_CONFIG__?: { practiceId?: string } }).__COLLECTRX_CONFIG__
      ?.practiceId ||
    new URLSearchParams(location.search).get('practiceId') ||
    'practice_001'
  );
}

function withDefaults(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init.headers },
  };
}

async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, withDefaults({ ...options }));

  if (res.status === 401) {
    throw new Error('Not authenticated');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function loginRequest(practiceId: string, password: string) {
  const d = await apiFetch<{ practiceId: string; practiceName: string }>(`${API_BASE}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ practiceId, password }),
  });
  setSessionPracticeId(d.practiceId);
  return d;
}

export function logoutRequest() {
  inMemoryPracticeId = null;
  return fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
}

export async function getSession() {
  const r = await fetch(`${API_BASE}/auth/me`, { credentials: 'include' });
  if (r.status === 401) {
    return null;
  }
  const d = (await r.json()) as { practice?: { id: string }; role?: string };
  if (d.practice?.id) {
    setSessionPracticeId(d.practice.id);
  }
  return d;
}

export const api = {
  fetchDashboard(): Promise<DashboardResponse> {
    return apiFetch(`${API_BASE}/practices/${getPracticeId()}/dashboard`);
  },

  fetchPatients(params: Partial<PaginationQuery> = {}): Promise<PaginatedPatients<PatientSummary>> {
    const query = new URLSearchParams({ page: '1', limit: '50', ...(params as Record<string, string>) });
    return apiFetch(`${API_BASE}/practices/${getPracticeId()}/patients?${query}`);
  },

  sendReminder(patientId: string): Promise<SendEmailResponse> {
    return apiFetch(`${API_BASE}/patients/${patientId}/send-email`, {
      method: 'POST',
      body: JSON.stringify({ workflowId: 'workflow_followup_1' }),
    });
  },

  generatePaymentLink(patientId: string): Promise<PaymentLinkResponse> {
    return apiFetch(`${API_BASE}/patients/${patientId}/payment-link`, { method: 'POST' });
  },
};
