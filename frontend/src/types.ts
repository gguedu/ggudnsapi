// ---- 用户 ----
export interface DnsUser {
  uid: string
  email: string
  name: string
  points: number
  banned: boolean
  recordCount: number
}

// ---- Cloudflare 账户 ----
export interface CfAccount {
  id: string
  remark: string
  name: string
  accountId: string
  authType: 'token' | 'key_email'
  hasApiToken: boolean
  hasApiKey: boolean
}

// ---- 域名 ----
export interface ManagedDomain {
  root: string
  zoneId: string
  cfAccountId: string
  enabled: boolean
  pointCost: number
  allowedTypes: string[]
  defaultTtl: number
  proxiedDefault: boolean
}

// ---- 黑名单规则 ----
export interface BlacklistRule {
  id: string
  pattern: string
  target: 'domain' | 'user'
  type: 'exact' | 'suffix' | 'contains' | 'wildcard'
  reason: string
}

// ---- 全局设置 ----
export interface GlobalSettings {
  allowedTypes: string[]
  protectionEnabled: boolean
  initialPoints: number
  deleteRefundEnabled: boolean
  defaultTtl: number
}

// ---- 解析记录 ----
export interface DnsRecord {
  id: string
  uid: string
  fullDomain: string
  root: string
  type: string
  content: string
  ttl: number
  proxied: boolean
  priority?: number
  comment: string
  enabled: boolean
  status: string
  cfRecordId: string
  cfZoneId: string
  createIp: string
  createdAt: string
  updatedAt: string
}

// ---- 鉴权 ----
export interface AuthMe {
  mailUser: Record<string, unknown>
  user: DnsUser
  isAdmin: boolean
}

export interface AdminLoginResponse extends AuthMe {
  token: string
}

// ---- API 响应信封 ----
export interface ApiEnvelope<T> {
  success: boolean
  data?: T
  message?: string
}
