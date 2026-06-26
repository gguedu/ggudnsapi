import type {
  BlacklistRule,
  CfAccount,
  DnsRecord,
  DnsUser,
  Env,
  ManagedDomain,
  OwnerRecord,
  PointLog,
  Settings
} from './types'
import { nowIso } from './http'

export const keys = {
  settings: 'settings:global',
  cfAccount: (id: string) => `cf-account:${id}`,
  cfAccountIndex: (id: string) => `cf-account-index:${id}`,
  domain: (root: string) => `domain:${root}`,
  domainIndex: (root: string) => `domain-index:${root}`,
  user: (uid: string) => `user:${uid}`,
  userEmail: (email: string) => `user-email:${email}`,
  pointLog: (uid: string, stamp: string, id: string) => `point-log:${uid}:${stamp}:${id}`,
  owner: (root: string, secondLevel: string) => `owner:${root}:${secondLevel}`,
  record: (id: string) => `record:${id}`,
  userRecord: (uid: string, id: string) => `user-record:${uid}:${id}`,
  domainRecord: (root: string, id: string) => `domain-record:${root}:${id}`,
  cfRecord: (cfRecordId: string) => `cf-record:${cfRecordId}`,
  blacklist: (id: string) => `blacklist:${id}`
}

export const kvGet = async <T>(env: Env, key: string) => env.DNS_KV.get<T>(key, 'json')

export const kvPut = async (env: Env, key: string, value: unknown) => {
  await env.DNS_KV.put(key, JSON.stringify(value))
}

export const kvDelete = async (env: Env, key: string) => env.DNS_KV.delete(key)

export const listValues = async <T>(env: Env, prefix: string) => {
  const values: T[] = []
  let cursor: string | undefined
  do {
    const page = await env.DNS_KV.list({ prefix, cursor })
    for (const item of page.keys) {
      const value = await kvGet<T>(env, item.name)
      if (value) values.push(value)
    }
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)
  return values
}

export const getSettings = async (env: Env): Promise<Settings> => {
  const existing = await kvGet<Settings>(env, keys.settings)
  if (existing) return existing
  const settings: Settings = {
    protectionEnabled: true,
    initialPoints: Number(env.DEFAULT_INITIAL_POINTS || 1),
    deleteRefundEnabled: env.DELETE_REFUND_ENABLED === 'true',
    allowedTypes: [],
    defaultTtl: 600,
    updatedAt: nowIso()
  }
  await kvPut(env, keys.settings, settings)
  return settings
}

export const putSettings = (env: Env, settings: Settings) => kvPut(env, keys.settings, settings)

export const listCfAccounts = (env: Env) => listValues<CfAccount>(env, 'cf-account:')
export const getCfAccount = (env: Env, id: string) => kvGet<CfAccount>(env, keys.cfAccount(id))
export const putCfAccount = async (env: Env, account: CfAccount) => {
  await kvPut(env, keys.cfAccount(account.id), account)
  await kvPut(env, keys.cfAccountIndex(account.id), { id: account.id })
}
export const deleteCfAccount = async (env: Env, id: string) => {
  await kvDelete(env, keys.cfAccount(id))
  await kvDelete(env, keys.cfAccountIndex(id))
}

export const listDomains = (env: Env) => listValues<ManagedDomain>(env, 'domain:')
export const getDomain = (env: Env, root: string) => kvGet<ManagedDomain>(env, keys.domain(root))
export const putDomain = async (env: Env, domain: ManagedDomain) => {
  await kvPut(env, keys.domain(domain.root), domain)
  await kvPut(env, keys.domainIndex(domain.root), { root: domain.root })
}
export const deleteDomain = async (env: Env, root: string) => {
  await kvDelete(env, keys.domain(root))
  await kvDelete(env, keys.domainIndex(root))
}

export const getUser = (env: Env, uid: string) => kvGet<DnsUser>(env, keys.user(uid))
export const getUserByEmail = async (env: Env, email: string) => {
  const marker = await kvGet<{ uid: string }>(env, keys.userEmail(email.toLowerCase()))
  return marker ? getUser(env, marker.uid) : null
}
export const putUser = async (env: Env, user: DnsUser) => {
  await kvPut(env, keys.user(user.uid), user)
  await kvPut(env, keys.userEmail(user.email.toLowerCase()), { uid: user.uid })
}
export const deleteUser = async (env: Env, user: DnsUser) => {
  await kvDelete(env, keys.user(user.uid))
  await kvDelete(env, keys.userEmail(user.email.toLowerCase()))
}
export const listUsers = (env: Env) => listValues<DnsUser>(env, 'user:')

export const putPointLog = (env: Env, log: PointLog) => kvPut(env, keys.pointLog(log.uid, log.createdAt, log.id), log)
export const listUserPointLogs = async (env: Env, uid: string) => {
  const logs = await listValues<PointLog>(env, `point-log:${uid}:`)
  return logs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export const getOwner = (env: Env, root: string, secondLevel: string) =>
  kvGet<OwnerRecord>(env, keys.owner(root, secondLevel))
export const putOwner = (env: Env, owner: OwnerRecord) => kvPut(env, keys.owner(owner.root, owner.secondLevel), owner)
export const deleteOwner = (env: Env, root: string, secondLevel: string) => kvDelete(env, keys.owner(root, secondLevel))
export const listOwners = (env: Env, root?: string) => listValues<OwnerRecord>(env, root ? `owner:${root}:` : 'owner:')

export const getRecord = (env: Env, id: string) => kvGet<DnsRecord>(env, keys.record(id))
export const putRecord = async (env: Env, record: DnsRecord) => {
  await kvPut(env, keys.record(record.id), record)
  await kvPut(env, keys.userRecord(record.uid, record.id), { id: record.id })
  await kvPut(env, keys.domainRecord(record.root, record.id), { id: record.id })
  await kvPut(env, keys.cfRecord(record.cfRecordId), { id: record.id })
}
export const deleteRecordIndexes = async (env: Env, record: DnsRecord) => {
  await kvDelete(env, keys.record(record.id))
  await kvDelete(env, keys.userRecord(record.uid, record.id))
  await kvDelete(env, keys.domainRecord(record.root, record.id))
  await kvDelete(env, keys.cfRecord(record.cfRecordId))
}
export const listRecords = (env: Env) => listValues<DnsRecord>(env, 'record:')
export const listUserRecords = async (env: Env, uid: string) => {
  const markers = await listValues<{ id: string }>(env, `user-record:${uid}:`)
  const records: DnsRecord[] = []
  for (const marker of markers) {
    const record = await getRecord(env, marker.id)
    if (record) records.push(record)
  }
  return records
}
export const listDomainRecords = async (env: Env, root: string) => {
  const markers = await listValues<{ id: string }>(env, `domain-record:${root}:`)
  const records: DnsRecord[] = []
  for (const marker of markers) {
    const record = await getRecord(env, marker.id)
    if (record) records.push(record)
  }
  return records
}

export const listBlacklist = (env: Env) => listValues<BlacklistRule>(env, 'blacklist:')
export const putBlacklist = (env: Env, rule: BlacklistRule) => kvPut(env, keys.blacklist(rule.id), rule)
export const deleteBlacklist = (env: Env, id: string) => kvDelete(env, keys.blacklist(id))
