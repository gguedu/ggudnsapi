import { DurableObject } from 'cloudflare:workers'
import type { BanEvent, Env } from './types'
import { nowIso, randomId } from './http'

export interface BanMutationInput {
  uid: string
  banned: boolean
  reason?: string
  presetId?: string
  actorUid: string
  actorEmail: string
  operationId: string
}

export interface BanStateResult {
  banned: boolean
  reason?: string
  bannedAt?: string
  bannedByUid?: string
  bannedByEmail?: string
  event: BanEvent
}

export interface CurrentBanState {
  banned: boolean
  reason?: string
  bannedAt?: string
  bannedByUid?: string
  bannedByEmail?: string
}

interface StateRow extends Record<string, SqlStorageValue> {
  uid: string
  banned: number
  reason: string | null
  banned_at: string | null
  banned_by_uid: string | null
  banned_by_email: string | null
}

interface EventRow extends Record<string, SqlStorageValue> {
  id: string
  operation_id: string
  uid: string
  action: 'ban' | 'unban'
  reason: string | null
  preset_id: string | null
  actor_uid: string
  actor_email: string
  created_at: string
}

const eventFromRow = (row: EventRow): BanEvent => ({
  id: row.id,
  uid: row.uid,
  action: row.action,
  reason: row.reason || undefined,
  presetId: row.preset_id || undefined,
  actorUid: row.actor_uid,
  actorEmail: row.actor_email,
  createdAt: row.created_at
})

export class UserAccessObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS state (
        uid TEXT PRIMARY KEY,
        banned INTEGER NOT NULL,
        reason TEXT,
        banned_at TEXT,
        banned_by_uid TEXT,
        banned_by_email TEXT
      );
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL UNIQUE,
        uid TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('ban', 'unban')),
        reason TEXT,
        preset_id TEXT,
        actor_uid TEXT NOT NULL,
        actor_email TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_created_at ON events(created_at DESC, id DESC);
    `)
  }

  mutate(input: BanMutationInput): BanStateResult {
    return this.ctx.storage.transactionSync(() => {
      const existingEvent = this.ctx.storage.sql
        .exec<EventRow>('SELECT * FROM events WHERE operation_id = ?', input.operationId)
        .toArray()[0]
      const current = this.ctx.storage.sql
        .exec<StateRow>('SELECT * FROM state WHERE uid = ?', input.uid)
        .toArray()[0]
      if (existingEvent && current) return this.result(current, existingEvent)

      const createdAt = nowIso()
      const event: EventRow = {
        id: randomId(),
        operation_id: input.operationId,
        uid: input.uid,
        action: input.banned ? 'ban' : 'unban',
        reason: input.reason || null,
        preset_id: input.presetId || null,
        actor_uid: input.actorUid,
        actor_email: input.actorEmail,
        created_at: createdAt
      }
      const next: StateRow = {
        uid: input.uid,
        banned: input.banned ? 1 : 0,
        reason: input.banned ? input.reason || null : null,
        banned_at: input.banned ? (current?.banned_at || createdAt) : null,
        banned_by_uid: input.banned ? input.actorUid : null,
        banned_by_email: input.banned ? input.actorEmail : null
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO state (uid, banned, reason, banned_at, banned_by_uid, banned_by_email)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(uid) DO UPDATE SET banned = excluded.banned, reason = excluded.reason,
           banned_at = excluded.banned_at, banned_by_uid = excluded.banned_by_uid,
           banned_by_email = excluded.banned_by_email`,
        next.uid, next.banned, next.reason, next.banned_at, next.banned_by_uid, next.banned_by_email
      )
      this.ctx.storage.sql.exec(
        `INSERT INTO events (id, operation_id, uid, action, reason, preset_id, actor_uid, actor_email, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        event.id, event.operation_id, event.uid, event.action, event.reason,
        event.preset_id, event.actor_uid, event.actor_email, event.created_at
      )
      return this.result(next, event)
    })
  }

  getState(): CurrentBanState | null {
    const state = this.ctx.storage.sql.exec<StateRow>('SELECT * FROM state LIMIT 1').toArray()[0]
    if (!state) return null
    return {
      banned: Boolean(state.banned),
      reason: state.reason || undefined,
      bannedAt: state.banned_at || undefined,
      bannedByUid: state.banned_by_uid || undefined,
      bannedByEmail: state.banned_by_email || undefined
    }
  }

  listEvents(limit = 100): BanEvent[] {
    const safeLimit = Math.min(200, Math.max(1, Math.trunc(limit)))
    return this.ctx.storage.sql
      .exec<EventRow>('SELECT * FROM events ORDER BY created_at DESC, id DESC LIMIT ?', safeLimit)
      .toArray()
      .map(eventFromRow)
  }

  private result(state: StateRow, event: EventRow): BanStateResult {
    return {
      banned: Boolean(state.banned),
      reason: state.reason || undefined,
      bannedAt: state.banned_at || undefined,
      bannedByUid: state.banned_by_uid || undefined,
      bannedByEmail: state.banned_by_email || undefined,
      event: eventFromRow(event)
    }
  }
}
