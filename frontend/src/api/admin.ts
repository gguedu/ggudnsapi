import { api } from './client'
import type {
  DnsUser,
  CfAccount,
  ManagedDomain,
  BlacklistRule,
  GlobalSettings,
  DnsRecord,
  AdminLoginResponse,
  AuthMe,
  BanEvent,
  BanReasonPreset,
  Paginated,
  RedemptionCode,
  RedemptionUse,
} from '../types'

// ---- 鉴权 ----
export function adminLogin(email: string, password: string) {
  return api<AdminLoginResponse>(
    '/api/auth/admin-login',
    { method: 'POST', body: JSON.stringify({ email, password }) },
    true,
  )
}

export function getMe() {
  return api<AuthMe>('/api/auth/me')
}

// ---- 用户 ----
export function getUsers() {
  return api<DnsUser[]>('/api/admin/users')
}

export function addUser(data: { email: string; uid?: string; name?: string; points?: number }) {
  return api<DnsUser>('/api/admin/users', { method: 'POST', body: JSON.stringify(data) })
}

export function adjustPoints(uid: string, delta: number, message?: string) {
  return api<{ user: DnsUser }>(`/api/admin/users/${encodeURIComponent(uid)}/points`, {
    method: 'PATCH',
    body: JSON.stringify({ delta, message: message || '后台手动调整', operationId: crypto.randomUUID() }),
  })
}

export function banUser(uid: string, banned: boolean, reason?: string, presetId?: string) {
  return api<{ user: DnsUser; event: BanEvent }>(`/api/admin/users/${encodeURIComponent(uid)}/ban`, {
    method: 'PATCH',
    body: JSON.stringify({ banned, reason, presetId, operationId: crypto.randomUUID() }),
  })
}

export function getUserBanEvents(uid: string) {
  return api<BanEvent[]>(`/api/admin/users/${encodeURIComponent(uid)}/ban-events`)
}

export function deleteUser(uid: string) {
  return api<void>(`/api/admin/users/${encodeURIComponent(uid)}`, { method: 'DELETE' })
}

// ---- 封禁理由预设 ----
export function getBanReasonPresets() {
  return api<BanReasonPreset[]>('/api/admin/ban-reason-presets')
}

export function addBanReasonPreset(reason: string) {
  return api<BanReasonPreset>('/api/admin/ban-reason-presets', {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
}

export function updateBanReasonPreset(id: string, data: Partial<Pick<BanReasonPreset, 'reason' | 'active'>>) {
  return api<BanReasonPreset>(`/api/admin/ban-reason-presets/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export function disableBanReasonPreset(id: string) {
  return api<BanReasonPreset>(`/api/admin/ban-reason-presets/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// ---- 兑换码 ----
export function getRedemptionCodes() {
  return api<RedemptionCode[]>('/api/admin/redemption-codes')
}

export function createRedemptionCode(data: {
  label?: string
  mode: 'generated' | 'custom'
  code?: string
  points: number
  maxUses: number
  expiresAt?: string
}) {
  return api<{ code: RedemptionCode; plainCode: string }>('/api/admin/redemption-codes', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function setRedemptionCodeActive(id: string, active: boolean) {
  return api<RedemptionCode>(`/api/admin/redemption-codes/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ active }),
  })
}

export function getRedemptionCodeUses(id: string, page = 1, pageSize = 50) {
  return api<Paginated<RedemptionUse>>(
    `/api/admin/redemption-codes/${encodeURIComponent(id)}/uses?page=${page}&pageSize=${pageSize}`,
  )
}

// ---- CF 账户 ----
export function getAccounts() {
  return api<CfAccount[]>('/api/admin/cf-accounts')
}

export function addAccount(data: {
  remark: string
  authType: 'token' | 'key_email'
  email?: string
  apiKey?: string
  apiToken?: string
}) {
  return api<CfAccount>('/api/admin/cf-accounts', { method: 'POST', body: JSON.stringify(data) })
}

export function deleteAccount(id: string) {
  return api<void>(`/api/admin/cf-accounts/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// ---- 域名池 ----
export function getDomains() {
  return api<ManagedDomain[]>('/api/admin/domains')
}

export function addDomain(data: { root: string; cfAccountId: string; pointCost?: number }) {
  return api<ManagedDomain>('/api/admin/domains', { method: 'POST', body: JSON.stringify(data) })
}

export function deleteDomain(root: string) {
  return api<void>(`/api/admin/domains/${encodeURIComponent(root)}`, { method: 'DELETE' })
}

// ---- 黑名单 ----
export function getBlacklist() {
  return api<BlacklistRule[]>('/api/admin/blacklist')
}

export function addBlacklist(data: {
  pattern: string
  target: 'domain' | 'user'
  type: 'exact' | 'suffix' | 'contains' | 'wildcard'
  reason: string
}) {
  return api<BlacklistRule>('/api/admin/blacklist', { method: 'POST', body: JSON.stringify(data) })
}

export function deleteBlacklist(id: string) {
  return api<void>(`/api/admin/blacklist/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// ---- 设置 ----
export function getSettings() {
  return api<GlobalSettings>('/api/admin/settings')
}

export function updateSettings(data: Partial<GlobalSettings>) {
  return api<GlobalSettings>('/api/admin/settings', { method: 'PATCH', body: JSON.stringify(data) })
}

// ---- 记录总览 ----
export function getRecords() {
  return api<DnsRecord[]>('/api/admin/records')
}
