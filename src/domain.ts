import type { BlacklistRule, DnsRecordInput, DnsRecordType, DnsUser, Env, ManagedDomain, OwnerRecord, Settings } from './types'
import { ResponseError } from './http'
import { listBlacklist } from './kv'
import { listDnsRecords } from './cloudflare'
import type { CfAccount } from './types'

const SUPPORTED_TYPES: DnsRecordType[] = [
  'A',
  'AAAA',
  'CNAME',
  'HTTPS',
  'TXT',
  'SRV',
  'LOC',
  'MX',
  'NS',
  'CERT',
  'DNSKEY',
  'DS',
  'NAPTR',
  'SMIMEA',
  'SSHFP',
  'SVCB',
  'TLSA',
  'URI',
  'CAA'
]

export const normalizeHostname = (value: string) => {
  const host = value.trim().toLowerCase().replace(/\.$/, '')
  if (!host || host.length > 253) throw new ResponseError('域名格式不正确', 400)
  if (host.includes('..') || /\s/.test(host)) throw new ResponseError('域名格式不正确', 400)
  const labels = host.split('.')
  for (const label of labels) {
    if (!label || label.length > 63) throw new ResponseError('域名格式不正确', 400)
    if (!/^[a-z0-9-]+$/.test(label)) throw new ResponseError('域名格式不正确', 400)
    if (label.startsWith('-') || label.endsWith('-')) throw new ResponseError('域名格式不正确', 400)
  }
  return host
}

export const getSecondLevel = (fullDomain: string, root: string) => {
  const full = normalizeHostname(fullDomain)
  const normalizedRoot = normalizeHostname(root)
  if (full === normalizedRoot) throw new ResponseError('不能创建主域名本身', 400)
  if (!full.endsWith(`.${normalizedRoot}`)) throw new ResponseError('域名不在开放域名池内', 400)
  const relative = full.slice(0, -(normalizedRoot.length + 1))
  const labels = relative.split('.')
  return `${labels[labels.length - 1]}.${normalizedRoot}`
}

export const findManagedDomain = (fullDomain: string, domains: ManagedDomain[]) => {
  const full = normalizeHostname(fullDomain)
  const enabled = domains.filter(item => item.enabled)
  const matched = enabled
    .filter(item => full === item.root || full.endsWith(`.${item.root}`))
    .sort((a, b) => b.root.length - a.root.length)[0]
  if (!matched) throw new ResponseError('域名不在开放域名池内', 400)
  if (full === matched.root) throw new ResponseError('不能创建主域名本身', 400)
  return matched
}

export const validateRecordInput = (input: Record<string, unknown>, settings: Settings, domain?: ManagedDomain): DnsRecordInput => {
  const fullDomain = normalizeHostname(String(input.fullDomain || ''))
  const type = String(input.type || '').toUpperCase() as DnsRecordType
  const allowedTypes = domain?.allowedTypes?.length ? domain.allowedTypes : settings.allowedTypes
  if (!SUPPORTED_TYPES.includes(type) || !allowedTypes.includes(type)) {
    throw new ResponseError('该解析类型暂未开放', 400)
  }
  const content = String(input.content || '').trim()
  if (!content) throw new ResponseError('解析内容不能为空', 400)
  const ttl = Number(input.ttl || domain?.defaultTtl || settings.defaultTtl || 600)
  if (!Number.isFinite(ttl) || ttl < 60) throw new ResponseError('TTL 不合法', 400)
  const proxied = Boolean(input.proxied)
  const comment = typeof input.comment === 'string' ? input.comment.slice(0, 200) : undefined
  const priority = input.priority === undefined ? undefined : Number(input.priority)
  if (type === 'MX' && (priority === undefined || !Number.isFinite(priority))) {
    throw new ResponseError('MX 记录需要 priority', 400)
  }
  return { fullDomain, type, content, ttl, proxied, comment, priority }
}

const matchWildcard = (pattern: string, value: string) => {
  if (!pattern.includes('*')) return pattern === value
  const [prefix, suffix] = pattern.split('*')
  return value.startsWith(prefix) && value.endsWith(suffix)
}

export const matchesBlacklist = (rules: BlacklistRule[], target: 'domain' | 'user', value: string) => {
  const normalized = value.toLowerCase()
  return rules.some(rule => {
    if (rule.target !== target) return false
    const pattern = rule.pattern.toLowerCase()
    if (rule.type === 'exact') return normalized === pattern
    if (rule.type === 'suffix') return normalized === pattern || normalized.endsWith(`.${pattern}`)
    if (rule.type === 'contains') return normalized.includes(pattern)
    if (rule.type === 'wildcard') return matchWildcard(pattern, normalized)
    return false
  })
}

export const assertBlacklistAllowed = async (env: Env, user: DnsUser, fullDomain: string, secondLevel: string, root: string) => {
  const rules = await listBlacklist(env)
  if (matchesBlacklist(rules, 'user', user.uid) || matchesBlacklist(rules, 'user', user.email)) {
    throw new ResponseError('用户暂时无法使用该服务', 403)
  }
  if (
    matchesBlacklist(rules, 'domain', fullDomain) ||
    matchesBlacklist(rules, 'domain', secondLevel) ||
    matchesBlacklist(rules, 'domain', root)
  ) {
    throw new ResponseError('该域名暂时无法创建', 403)
  }
}

export const assertSubdomainAllowed = async (
  env: Env,
  account: CfAccount,
  zoneId: string,
  uid: string,
  fullDomain: string,
  root: string,
  settings: Settings,
  owner: OwnerRecord | null
) => {
  const secondLevel = getSecondLevel(fullDomain, root)
  if (!settings.protectionEnabled) return { secondLevel, owner: null, claimRequired: false }

  if (owner && owner.uid !== uid) throw new ResponseError('该域名暂时无法创建', 403)
  if (owner) return { secondLevel, owner, claimRequired: false }

  const secondLevelRecords = await listDnsRecords(env, account, zoneId, secondLevel)
  if (secondLevelRecords.length > 0) {
    throw new ResponseError('该域名暂时无法创建', 403)
  }

  return { secondLevel, owner: null, claimRequired: true }
}

export const assertFullDomainTypeAvailable = async (
  env: Env,
  account: CfAccount,
  zoneId: string,
  fullDomain: string,
  type: DnsRecordType,
  ignoreRecordId?: string
) => {
  const records = await listDnsRecords(env, account, zoneId, fullDomain, type)
  const conflict = records.find(item => item.id !== ignoreRecordId)
  if (conflict) throw new ResponseError('该域名已存在', 409)
}
