import type { DomainCoordinator } from './domain-coordinator'
import type { RedemptionCodeObject } from './redemption'
import type { UserAccessObject } from './user-access'
import type { UserCoordinator } from './user-coordinator'
import type { UserPointsObject } from './user-points'

export interface Env {
  DNS_KV: KVNamespace
  ASSETS: Fetcher
  DOMAIN_COORDINATOR: DurableObjectNamespace<DomainCoordinator>
  REDEMPTION_CODES: DurableObjectNamespace<RedemptionCodeObject>
  USER_ACCESS: DurableObjectNamespace<UserAccessObject>
  USER_COORDINATOR: DurableObjectNamespace<UserCoordinator>
  USER_POINTS: DurableObjectNamespace<UserPointsObject>
  MAIL_API_BASE_URL: string
  ALLOWED_ORIGIN: string
  DNS_ADMIN_EMAILS: string
  DEFAULT_INITIAL_POINTS: string
  DELETE_REFUND_ENABLED: string
  CREDENTIALS_ENCRYPTION_KEY?: string
}

export interface ApiErrorData {
  code?: string
  reason?: string
  bannedAt?: string
  [key: string]: unknown
}

export interface ApiEnvelope<T = unknown> {
  success: boolean
  data?: T | ApiErrorData
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
  banned?: boolean
  bannedReason?: string
  bannedAt?: string
  bannedByUid?: string
  bannedByEmail?: string
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
  remark?: string
  accountId?: string
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

export type DnsRecordType =
  | 'A'
  | 'AAAA'
  | 'CNAME'
  | 'HTTPS'
  | 'TXT'
  | 'SRV'
  | 'LOC'
  | 'MX'
  | 'NS'
  | 'CERT'
  | 'DNSKEY'
  | 'DS'
  | 'NAPTR'
  | 'SMIMEA'
  | 'SSHFP'
  | 'SVCB'
  | 'TLSA'
  | 'URI'
  | 'CAA'

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
  reason: 'initial_grant' | 'create_record' | 'delete_refund' | 'admin_adjust' | 'redeem_code'
  recordId?: string
  redemptionCodeId?: string
  message?: string
  createdAt: string
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

export interface RedemptionCodeSummary {
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

export interface RedemptionCodeRecord extends RedemptionCodeSummary {
  secretHash: string
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
