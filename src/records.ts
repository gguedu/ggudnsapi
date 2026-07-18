import type { CfAccount, DnsRecord, DnsRecordInput, DnsRecordType, DnsUser, Env, ManagedDomain, OwnerRecord, Settings } from './types'
import { createDnsRecord, patchDnsRecord, safeDeleteDnsRecord } from './cloudflare'
import { ResponseError, nowIso, randomId } from './http'
import {
  deleteOwner,
  deleteRecordIndexes,
  getCfAccount,
  getOwner,
  getRecord,
  listDomains,
  listRecords,
  listUserRecords,
  putOwner,
  putRecord
} from './kv'
import { refundPoints, spendPoints } from './points'
import {
  assertBlacklistAllowed,
  assertFullDomainTypeAvailable,
  assertSubdomainAllowed,
  findManagedDomain,
  getSecondLevel,
  validateRecordInput
} from './domain'

export const publicDomain = (domain: ManagedDomain, settings: Settings) => ({
  root: domain.root,
  enabled: domain.enabled,
  allowedTypes: domain.allowedTypes?.length ? domain.allowedTypes : settings.allowedTypes,
  defaultTtl: domain.defaultTtl || settings.defaultTtl,
  proxiedDefault: domain.proxiedDefault || false,
  pointCost: domain.pointCost || 1
})

export const recordsMeta = async (env: Env, settings: Settings) => {
  const domains = await listDomains(env)
  return {
    allowedTypes: settings.allowedTypes,
    defaultTtl: settings.defaultTtl,
    protectionEnabled: settings.protectionEnabled,
    domains: domains.filter(item => item.enabled).map(item => publicDomain(item, settings))
  }
}

export const serializeRecord = (record: DnsRecord) => record

const ensureAccount = async (env: Env, domain: ManagedDomain) => {
  const account = await getCfAccount(env, domain.cfAccountId)
  if (!account) throw new ResponseError('Cloudflare 账户不存在', 500)
  return account
}

const buildRecord = (
  user: DnsUser,
  domain: ManagedDomain,
  input: DnsRecordInput,
  cfRecordId: string,
  secondLevel: string,
  pointCost: number,
  clientIp: string
): DnsRecord => {
  const now = nowIso()
  return {
    id: randomId(),
    uid: user.uid,
    root: domain.root,
    zoneId: domain.zoneId,
    cfAccountId: domain.cfAccountId,
    cfRecordId,
    secondLevel,
    fullDomain: input.fullDomain,
    type: input.type,
    content: input.content,
    ttl: input.ttl || domain.defaultTtl || 600,
    proxied: input.proxied || false,
    priority: input.priority,
    comment: input.comment,
    pointCost,
    enabled: true,
    status: 'active',
    createIp: clientIp,
    createdAt: now,
    updatedAt: now,
    lastRefreshAt: now
  }
}

const ownerForRecord = (user: DnsUser, record: DnsRecord): OwnerRecord => ({
  root: record.root,
  secondLevel: record.secondLevel,
  uid: user.uid,
  firstRecordId: record.id,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt
})

const cleanupOwnerIfUnused = async (env: Env, record: DnsRecord, stillUsed: boolean) => {
  if (stillUsed) return false
  const owner = await getOwner(env, record.root, record.secondLevel)
  if (!owner || owner.uid !== record.uid) return false
  await deleteOwner(env, record.root, record.secondLevel)
  return true
}

export const createUserRecord = async (
  env: Env,
  user: DnsUser,
  settings: Settings,
  domain: ManagedDomain,
  body: Record<string, unknown>,
  clientIp: string,
  currentOwner: OwnerRecord | null
) => {
  const operationId = typeof body.operationId === 'string' && body.operationId.trim() ? body.operationId.trim() : randomId()
  const existingRecord = await getRecord(env, operationId)
  if (existingRecord) {
    if (existingRecord.uid !== user.uid) throw new ResponseError('记录操作标识冲突', 409)
    return { record: serializeRecord(existingRecord), user, ownerClaim: null }
  }
  if (!domain.enabled) throw new ResponseError('域名不在开放域名池内', 400)
  const input = validateRecordInput(body, settings, domain)
  const account = await ensureAccount(env, domain)
  const secondLevel = getSecondLevel(input.fullDomain, domain.root)
  await assertBlacklistAllowed(env, user, input.fullDomain, secondLevel, domain.root)
  const subdomain = await assertSubdomainAllowed(
    env,
    account,
    domain.zoneId,
    user.uid,
    input.fullDomain,
    domain.root,
    settings,
    currentOwner
  )
  await assertFullDomainTypeAvailable(env, account, domain.zoneId, input.fullDomain, input.type)

  const pointCost = domain.pointCost || 1
  if (user.points < pointCost) throw new ResponseError('积分不足', 400)

  const cfRecord = await createDnsRecord(env, account, domain.zoneId, input)
  const record = { ...buildRecord(user, domain, input, cfRecord.id, subdomain.secondLevel, pointCost, clientIp), id: operationId }
  const ownerClaim = subdomain.claimRequired ? ownerForRecord(user, record) : null

  try {
    await putRecord(env, record)
    if (ownerClaim) await putOwner(env, ownerClaim)
    const { user: nextUser } = await spendPoints(env, user, pointCost, record.id)
    return { record: serializeRecord(record), user: nextUser, ownerClaim }
  } catch (error) {
    await safeDeleteDnsRecord(env, account, domain.zoneId, cfRecord.id).catch(() => false)
    await deleteRecordIndexes(env, record).catch(() => undefined)
    if (ownerClaim) {
      const owner = await getOwner(env, record.root, record.secondLevel).catch(() => null)
      if (owner?.uid === ownerClaim.uid && owner.firstRecordId === ownerClaim.firstRecordId) {
        await deleteOwner(env, record.root, record.secondLevel).catch(() => undefined)
      }
    }
    throw error
  }
}

const assertRecordOwner = (record: DnsRecord | null, user: DnsUser) => {
  if (!record) throw new ResponseError('解析记录不存在', 404)
  if (record.uid !== user.uid) throw new ResponseError('无权操作该解析记录', 403)
  return record
}

const mutableInputFromRecord = (record: DnsRecord, body: Record<string, unknown>) => ({
  fullDomain: record.fullDomain,
  type: record.type,
  content: String(body.content ?? record.content),
  ttl: body.ttl === undefined ? record.ttl : Number(body.ttl),
  proxied: body.proxied === undefined ? record.proxied : Boolean(body.proxied),
  priority: body.priority === undefined ? record.priority : Number(body.priority),
  comment: typeof body.comment === 'string' ? body.comment : record.comment
})

export const updateUserRecord = async (env: Env, user: DnsUser, settings: Settings, id: string, body: Record<string, unknown>) => {
  const record = assertRecordOwner(await getRecord(env, id), user)
  const domain = (await listDomains(env)).find(item => item.root === record.root)
  if (!domain) throw new ResponseError('域名池配置不存在', 500)
  const input = validateRecordInput(mutableInputFromRecord(record, body), settings, domain)
  const account = await ensureAccount(env, domain)

  await assertBlacklistAllowed(env, user, input.fullDomain, record.secondLevel, record.root)
  await assertFullDomainTypeAvailable(env, account, record.zoneId, input.fullDomain, input.type, record.cfRecordId)

  let cfRecordId = record.cfRecordId
  if (record.enabled) {
    const cfRecord = await patchDnsRecord(env, account, record.zoneId, record.cfRecordId, input)
    cfRecordId = cfRecord.id
  }

  const next: DnsRecord = {
    ...record,
    cfRecordId,
    content: input.content,
    ttl: input.ttl || record.ttl,
    proxied: input.proxied || false,
    priority: input.priority,
    comment: input.comment,
    status: record.enabled ? 'active' : record.status,
    updatedAt: nowIso(),
    lastRefreshAt: nowIso()
  }
  await putRecord(env, next)
  return serializeRecord(next)
}

export const deleteUserRecord = async (
  env: Env,
  user: DnsUser,
  settings: Settings,
  id: string,
  ownerStillUsed: boolean
) => {
  const record = assertRecordOwner(await getRecord(env, id), user)
  const account = await getCfAccount(env, record.cfAccountId)
  if (!account) throw new ResponseError('Cloudflare 账户不存在', 500)

  if (record.cfRecordId) {
    await safeDeleteDnsRecord(env, account, record.zoneId, record.cfRecordId)
  }
  await deleteRecordIndexes(env, record)
  const ownerDeleted = await cleanupOwnerIfUnused(env, record, ownerStillUsed)

  return { record, user, ownerDeleted }
}

export const refundDeletedRecord = async (env: Env, user: DnsUser, settings: Settings, record: DnsRecord) => {
  if (!settings.deleteRefundEnabled || record.pointCost <= 0) return user
  return (await refundPoints(env, user, record.pointCost, record.id)).user
}

export const toggleUserRecord = async (
  env: Env,
  user: DnsUser,
  settings: Settings,
  id: string,
  domain: ManagedDomain,
  currentOwner: OwnerRecord | null
) => {
  const record = assertRecordOwner(await getRecord(env, id), user)
  if (domain.root !== record.root) throw new ResponseError('域名池配置不存在', 500)
  const account = await ensureAccount(env, domain)

  if (record.enabled) {
    await safeDeleteDnsRecord(env, account, record.zoneId, record.cfRecordId)
    const next: DnsRecord = { ...record, enabled: false, status: 'missing', updatedAt: nowIso(), lastRefreshAt: nowIso() }
    await putRecord(env, next)
    return { record: serializeRecord(next), ownerClaim: null }
  }

  const input: DnsRecordInput = {
    fullDomain: record.fullDomain,
    type: record.type,
    content: record.content,
    ttl: record.ttl,
    proxied: record.proxied,
    priority: record.priority,
    comment: record.comment
  }
  validateRecordInput({ ...input }, settings, domain)
  await assertBlacklistAllowed(env, user, record.fullDomain, record.secondLevel, record.root)
  const subdomain = await assertSubdomainAllowed(
    env,
    account,
    record.zoneId,
    user.uid,
    record.fullDomain,
    record.root,
    settings,
    currentOwner
  )
  await assertFullDomainTypeAvailable(env, account, record.zoneId, record.fullDomain, record.type)
  const cfRecord = await createDnsRecord(env, account, record.zoneId, input)
  const next: DnsRecord = {
    ...record,
    cfRecordId: cfRecord.id,
    enabled: true,
    status: 'active',
    updatedAt: nowIso(),
    lastRefreshAt: nowIso()
  }
  const ownerClaim = subdomain.claimRequired ? ownerForRecord(user, next) : null
  try {
    await putRecord(env, next)
    if (ownerClaim) await putOwner(env, ownerClaim)
    return { record: serializeRecord(next), ownerClaim }
  } catch (error) {
    await safeDeleteDnsRecord(env, account, record.zoneId, cfRecord.id).catch(() => false)
    await deleteRecordIndexes(env, next).catch(() => undefined)
    await putRecord(env, record).catch(() => undefined)
    if (ownerClaim) {
      const owner = await getOwner(env, record.root, record.secondLevel).catch(() => null)
      if (owner?.uid === ownerClaim.uid && owner.firstRecordId === ownerClaim.firstRecordId) {
        await deleteOwner(env, record.root, record.secondLevel).catch(() => undefined)
      }
    }
    throw error
  }
}

export const listUserRecordSummaries = async (env: Env, uid: string) =>
  (await listUserRecords(env, uid)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(serializeRecord)

export const listAllRecordSummaries = async (env: Env) =>
  (await listRecords(env)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(serializeRecord)
