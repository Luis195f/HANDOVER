import { API_BASE_URL } from '../config/env';
import type { AlertSummary, StaffActivity, UnitSummary } from '../types/admin';
import { mockAlertSummaries, mockStaffActivity, mockUnitSummaries } from '../mock/admin/dashboard-fixture';
import { fetchWithRetry } from './net';

export interface AdminDashboardData {
  units: UnitSummary[];
  staff: StaffActivity[];
  alerts: AlertSummary[];
}

function buildUrl(path: string): string {
  const base = (API_BASE_URL ?? '').replace(/\/$/, '');
  const normalizedPath = path.replace(/^\//, '');
  if (!base) return `/${normalizedPath}`;
  return `${base}/${normalizedPath}`;
}

async function safeRequest<T>(path: string): Promise<T | null> {
  try {
    const response = await fetchWithRetry(buildUrl(path), { method: 'GET' });
    if (!response.ok) return null;
    const json = (await response.json()) as T;
    return json;
  } catch {
    return null;
  }
}

export async function fetchAdminDashboardData(): Promise<AdminDashboardData> {
  const [units, staff, alerts] = await Promise.all([
    safeRequest<UnitSummary[]>('/admin/units-summary'),
    safeRequest<StaffActivity[]>('/admin/staff-activity'),
    safeRequest<AlertSummary[]>('/admin/alerts'),
  ]);

  return {
    units: units ?? mockUnitSummaries,
    staff: staff ?? mockStaffActivity,
    alerts: alerts ?? mockAlertSummaries,
  };
}
