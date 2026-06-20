export interface Env {
  DNS_KV: KVNamespace
  ASSETS: Fetcher
  MAIL_API_BASE_URL: string
  ALLOWED_ORIGIN: string
  DNS_ADMIN_EMAILS: string
  DEFAULT_INITIAL_POINTS: string
  DELETE_REFUND_ENABLED: string
  CREDENTIALS_ENCRYPTION_KEY?: string
}

export interface ApiEnvelope<T = unknown> {
  success: boolean
  data?: T
  message?: string
}

export interface MailUserInfo {
  uid: string
  email: string
  name?: string
  raw: unknown
}

export interface DnsUser {
  uid: string
  email: string
  name?: string
  points: number
  initialGrantDone: true
  createdAt: string
  lastSeenAt: string
}

export interface Settings {
  protectionEnabled: boolean
  initialPoints: number
  deleteRefundEnabled: boolean
  allowedTypes: DnsRecordType[]
  defaultTtl: number
  updatedAt: string
}

export type CfAuthType = 'token' | 'key_email'

export interface CfAccount {
  id: string
  name: string
  authType: CfAuthType
  email?: string
  apiTokenEncrypted?: string
  apiKeyEncrypted?: string
  createdAt: string
  updatedAt: string
}

export interface ManagedDomain {
  root: string
  zoneId: string
  cfAccountId: string
  enabled: boolean
  allowedTypes?: DnsRecordType[]
  defaultTtl?: number
  proxiedDefault?: boolean
  pointCost?: number
  createdAt: string
  updatedAt: string
}

export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'TXT' | 'MX'

export interface DnsRecordInput {
  fullDomain: string
  type: DnsRecordType
  content: string
  ttl?: number
  proxied?: boolean
  comment?: string
  priority?: number
}

export interface DnsRecord {
  id: string
  uid: string
  root: string
  zoneId: string
  cfAccountId: string
  cfRecordId: string
  secondLevel: string
  fullDomain: string
  type: DnsRecordType
  content: string
  ttl: number
  proxied: boolean
  priority?: number
  comment?: string
  pointCost: number
  enabled: boolean
  status: 'active' | 'missing' | 'error'
  createIp?: string
  createdAt: string
  updatedAt: string
  lastRefreshAt?: string
}

export interface PointLog {
  id: string
  uid: string
  delta: number
  balanceAfter: number
  reason: 'initial_grant' | 'create_record' | 'delete_refund' | 'admin_adjust'
  recordId?: string
  message?: string
  createdAt: string
}

export interface OwnerRecord {
  root: string
  secondLevel: string
  uid: string
  firstRecordId: string
  createdAt: string
  updatedAt: string
}

export interface BlacklistRule {
  id: string
  pattern: string
  type: 'exact' | 'suffix' | 'contains' | 'wildcard'
  target: 'domain' | 'user'
  reason?: string
  createdAt: string
}

export interface CfZone {
  id: string
  name: string
  status?: string
}

export interface CfDnsRecord {
  id: string
  name: string
  type: string
  content: string
  ttl: number
  proxied?: boolean
  priority?: number
  comment?: string
  created_on?: string
  modified_on?: string
}
