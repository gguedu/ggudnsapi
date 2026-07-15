// ---- 用户 ----
export interface DnsUser {
  uid: string
  email: string
  name: string
  points: number
  banned: boolean
  bannedReason?: string
  bannedAt?: string
  bannedByUid?: string
  bannedByEmail?: string
  recordCount: number
}

export interface BanReasonPreset {
  id: string
  reason: string
  active: boolean
  createdAt: string
  updatedAt: string
  createdByUid: string
  createdByEmail: string
}

export interface BanEvent {
  id: string
  uid: string
  action: 'ban' | 'unban'
  reason?: string
  presetId?: string
  actorUid: string
  actorEmail: string
  createdAt: string
}

export interface RedemptionCode {
  id: string
  label: string
  maskedCode: string
  points: number
  maxUses: number
  useCount: number
  active: boolean
  expiresAt?: string
  createdAt: string
  createdByUid: string
  createdByEmail: string
}

export interface RedemptionUse {
  id: string
  codeId: string
  codeLabel: string
  uid: string
  email: string
  points: number
  redeemedAt: string
  pointLogId?: string
  status: 'pending' | 'completed'
}

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
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
