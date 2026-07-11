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
  return api<DnsUser>(`/api/admin/users/${encodeURIComponent(uid)}/points`, {
    method: 'PATCH',
    body: JSON.stringify({ delta, message: message || '后台手动调整' }),
  })
}

export function banUser(uid: string, banned: boolean, reason?: string) {
  return api<DnsUser>(`/api/admin/users/${encodeURIComponent(uid)}/ban`, {
    method: 'PATCH',
    body: JSON.stringify({ banned, reason: reason || '后台封禁' }),
  })
}

export function deleteUser(uid: string) {
  return api<void>(`/api/admin/users/${encodeURIComponent(uid)}`, { method: 'DELETE' })
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
