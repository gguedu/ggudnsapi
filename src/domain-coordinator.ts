import { DurableObject } from 'cloudflare:workers'
import type { DnsRecord, DnsUser, Env, ManagedDomain, OwnerRecord, Settings } from './types'
import { ResponseError, nowIso } from './http'
import {
  deleteDomain,
  getDomain,
  getOwner,
  getRecord,
  listOwners,
  listRecords,
  putDomain,
  putOwner
} from './kv'
import { createUserRecord, deleteUserRecord, refundDeletedRecord, toggleUserRecord, updateUserRecord } from './records'
import { getSecondLevel } from './domain'

interface CoordinatorRequest {
  action: 'get-domain' | 'put-domain' | 'delete-domain' | 'has-record' | 'create-record' | 'update-record' | 'toggle-record' | 'delete-record'
  root: string
  payload: unknown
}

interface PutDomainPayload {
  domain: ManagedDomain
  mode: 'create' | 'update'
}

interface CreateRecordPayload {
  user: DnsUser
  settings: Settings
  body: Record<string, unknown>
  clientIp: string
}

interface RecordMutationPayload {
  user: DnsUser
  settings: Settings
  id: string
  body?: Record<string, unknown>
}

interface StoredMeta {
  root: string
  domain: ManagedDomain | null
  deleted: boolean
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

export class DomainCoordinator extends DurableObject<Env> {
  private tail: Promise<void> = Promise.resolve()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS owners (
          second_level TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS records (
          id TEXT PRIMARY KEY,
          second_level TEXT NOT NULL,
          value TEXT NOT NULL
        );
      `)
    })
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json({ success: false, message: '接口不存在', status: 404 }, 404)

    let input: CoordinatorRequest
    try {
      input = await request.json<CoordinatorRequest>()
    } catch {
      return json({ success: false, message: '请求体格式不正确', status: 400 }, 400)
    }

    return this.enqueue(async () => {
      try {
        await this.ensureInitialized(input.root)
        const data = await this.dispatch(input)
        return json({ success: true, data })
      } catch (error) {
        const status = error instanceof ResponseError ? error.status : 500
        const message = error instanceof Error ? error.message : '域名操作失败'
        const data = error instanceof ResponseError ? error.data : undefined
        return json({ success: false, message, status, data }, status)
      }
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation)
    this.tail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private getMeta(): StoredMeta | null {
    const row = this.ctx.storage.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'state'").toArray()[0]
    return row ? (JSON.parse(row.value) as StoredMeta) : null
  }

  private putMeta(meta: StoredMeta) {
    this.ctx.storage.sql.exec(
      "INSERT INTO meta (key, value) VALUES ('state', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      JSON.stringify(meta)
    )
  }

  private getStoredOwner(secondLevel: string): OwnerRecord | null {
    const row = this.ctx.storage.sql
      .exec<{ value: string }>('SELECT value FROM owners WHERE second_level = ?', secondLevel)
      .toArray()[0]
    return row ? (JSON.parse(row.value) as OwnerRecord) : null
  }

  private putStoredOwner(owner: OwnerRecord) {
    this.ctx.storage.sql.exec(
      'INSERT INTO owners (second_level, value) VALUES (?, ?) ON CONFLICT(second_level) DO UPDATE SET value = excluded.value',
      owner.secondLevel,
      JSON.stringify(owner)
    )
  }

  private deleteStoredOwner(secondLevel: string) {
    this.ctx.storage.sql.exec('DELETE FROM owners WHERE second_level = ?', secondLevel)
  }

  private putStoredRecord(record: DnsRecord) {
    this.ctx.storage.sql.exec(
      'INSERT INTO records (id, second_level, value) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET second_level = excluded.second_level, value = excluded.value',
      record.id,
      record.secondLevel,
      JSON.stringify(record)
    )
  }

  private deleteStoredRecord(id: string) {
    this.ctx.storage.sql.exec('DELETE FROM records WHERE id = ?', id)
  }

  private recordCount() {
    return this.ctx.storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM records').one().count
  }

  private ownerStillUsed(secondLevel: string, excludingId: string, ownerUid?: string) {
    const query = ownerUid
      ? 'SELECT COUNT(*) AS count FROM records WHERE second_level = ? AND id != ? AND json_extract(value, \'$.uid\') = ?'
      : 'SELECT COUNT(*) AS count FROM records WHERE second_level = ? AND id != ?'
    const args = ownerUid ? [secondLevel, excludingId, ownerUid] : [secondLevel, excludingId]
    return this.ctx.storage.sql.exec<{ count: number }>(query, ...args).one().count > 0
  }

  private async ensureInitialized(root: string) {
    const existing = this.getMeta()
    if (existing) {
      if (existing.root !== root) throw new ResponseError('域名协调器标识不一致', 500)
      return
    }

    const [domain, owners, records] = await Promise.all([getDomain(this.env, root), listOwners(this.env, root), listRecords(this.env)])
    const rootRecords = records.filter(record => record.root === root)
    for (const record of rootRecords) this.putStoredRecord(record)
    for (const owner of owners) {
      const ownedRecordExists = rootRecords.some(
        record => record.secondLevel === owner.secondLevel && record.uid === owner.uid
      )
      if (ownedRecordExists) this.putStoredOwner(owner)
    }
    this.putMeta({ root, domain, deleted: false })
  }

  private async dispatch(input: CoordinatorRequest) {
    if (input.action === 'get-domain') return this.getMeta()?.domain || null
    if (input.action === 'put-domain') return this.putDomain(input.payload as PutDomainPayload)
    if (input.action === 'delete-domain') return this.deleteDomain()
    if (input.action === 'has-record') {
      const payload = input.payload as { id: string; uid: string }
      const record = this.ctx.storage.sql
        .exec<{ value: string }>('SELECT value FROM records WHERE id = ?', payload.id)
        .toArray()[0]
      return record ? (JSON.parse(record.value) as DnsRecord).uid === payload.uid : false
    }
    if (input.action === 'create-record') return this.createRecord(input.payload as CreateRecordPayload)
    if (input.action === 'update-record') return this.updateRecord(input.payload as RecordMutationPayload)
    if (input.action === 'toggle-record') return this.toggleRecord(input.payload as RecordMutationPayload)
    if (input.action === 'delete-record') return this.deleteRecord(input.payload as RecordMutationPayload)
    throw new ResponseError('接口不存在', 404)
  }

  private async putDomain(payload: PutDomainPayload) {
    const meta = this.getMeta()
    if (!meta) throw new ResponseError('域名协调器未初始化', 500)
    if (payload.domain.root !== meta.root) throw new ResponseError('域名不可修改', 400)
    if (payload.mode === 'create' && meta.domain && !meta.deleted) throw new ResponseError('域名已存在', 409)
    if (payload.mode === 'update' && (!meta.domain || meta.deleted)) throw new ResponseError('域名不存在', 404)

    await putDomain(this.env, payload.domain)
    this.putMeta({ root: meta.root, domain: payload.domain, deleted: false })
    return payload.domain
  }

  private async deleteDomain() {
    const meta = this.getMeta()
    if (!meta?.domain || meta.deleted) throw new ResponseError('域名不存在', 404)

    const disabled: ManagedDomain = { ...meta.domain, enabled: false, updatedAt: nowIso() }
    if (this.recordCount() > 0) {
      await putDomain(this.env, disabled)
      this.putMeta({ root: meta.root, domain: disabled, deleted: false })
      return disabled
    }

    await deleteDomain(this.env, meta.root)
    this.putMeta({ root: meta.root, domain: null, deleted: true })
    return { root: meta.root }
  }

  private activeDomain() {
    const meta = this.getMeta()
    if (!meta?.domain || meta.deleted || !meta.domain.enabled) throw new ResponseError('域名不在开放域名池内', 400)
    return meta.domain
  }

  private async createRecord(payload: CreateRecordPayload) {
    const domain = this.activeDomain()
    const secondLevel = getSecondLevel(String(payload.body.fullDomain || ''), domain.root)
    const owner = payload.settings.protectionEnabled ? this.getStoredOwner(secondLevel) : null
    const result = await createUserRecord(
      this.env,
      payload.user,
      payload.settings,
      domain,
      payload.body,
      payload.clientIp,
      owner
    )

    this.putStoredRecord(result.record)
    if (result.ownerClaim) this.putStoredOwner(result.ownerClaim)
    const latestBalance = await this.env.USER_POINTS.getByName(payload.user.uid).getBalance(result.user.points)
    return { record: result.record, user: { ...result.user, points: latestBalance ?? result.user.points } }
  }

  private async updateRecord(payload: RecordMutationPayload) {
    const existing = await getRecord(this.env, payload.id)
    if (!existing || existing.root !== this.getMeta()?.root) throw new ResponseError('解析记录不存在', 404)
    const next = await updateUserRecord(this.env, payload.user, payload.settings, payload.id, payload.body || {})
    this.putStoredRecord(next)
    return next
  }

  private async toggleRecord(payload: RecordMutationPayload) {
    const record = await getRecord(this.env, payload.id)
    if (!record || record.root !== this.getMeta()?.root) throw new ResponseError('解析记录不存在', 404)
    const domain = this.activeDomain()
    const owner = payload.settings.protectionEnabled ? this.getStoredOwner(record.secondLevel) : null
    const result = await toggleUserRecord(this.env, payload.user, payload.settings, payload.id, domain, owner)
    this.putStoredRecord(result.record)
    if (result.ownerClaim) this.putStoredOwner(result.ownerClaim)
    return result.record
  }

  private async deleteRecord(payload: RecordMutationPayload) {
    const record = await getRecord(this.env, payload.id)
    if (!record || record.root !== this.getMeta()?.root) throw new ResponseError('解析记录不存在', 404)
    const owner = this.getStoredOwner(record.secondLevel)
    const stillUsed = this.ownerStillUsed(record.secondLevel, record.id, owner?.uid)
    const result = await deleteUserRecord(this.env, payload.user, payload.settings, payload.id, stillUsed)
    this.deleteStoredRecord(record.id)

    if (!stillUsed && owner?.uid === record.uid) this.deleteStoredOwner(record.secondLevel)
    const nextUser = await refundDeletedRecord(this.env, result.user, payload.settings, result.record)
    return { record: result.record, user: nextUser }
  }
}
