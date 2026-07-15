import { DurableObject } from 'cloudflare:workers'
import type { Env, RedemptionCodeRecord, RedemptionCodeSummary, RedemptionUse } from './types'
import { nowIso, randomId } from './http'

export interface CreateRedemptionCodeInput {
  id: string
  label: string
  secretHash: string
  maskedCode: string
  points: number
  maxUses: number
  expiresAt?: string
  createdAt: string
  createdByUid: string
  createdByEmail: string
}

export interface RedemptionReservation {
  ok: boolean
  reason?: 'already_redeemed' | 'inactive' | 'expired' | 'exhausted' | 'not_found'
  resumed?: boolean
  use?: RedemptionUse
  code?: RedemptionCodeSummary
}

interface CodeRow extends Record<string, SqlStorageValue> {
  id: string
  label: string
  secret_hash: string
  masked_code: string
  points: number
  max_uses: number
  active: number
  expires_at: string | null
  created_at: string
  created_by_uid: string
  created_by_email: string
}

interface UseRow extends Record<string, SqlStorageValue> {
  id: string
  code_id: string
  code_label: string
  uid: string
  email: string
  points: number
  redeemed_at: string
  point_log_id: string | null
  status: 'pending' | 'completed'
}

const useFromRow = (row: UseRow): RedemptionUse => ({
  id: row.id,
  codeId: row.code_id,
  codeLabel: row.code_label,
  uid: row.uid,
  email: row.email,
  points: row.points,
  redeemedAt: row.redeemed_at,
  pointLogId: row.point_log_id || undefined,
  status: row.status
})

const summaryFromRow = (row: CodeRow, useCount: number): RedemptionCodeSummary => ({
  id: row.id,
  label: row.label,
  maskedCode: row.masked_code,
  points: row.points,
  maxUses: row.max_uses,
  useCount,
  active: Boolean(row.active),
  expiresAt: row.expires_at || undefined,
  createdAt: row.created_at,
  createdByUid: row.created_by_uid,
  createdByEmail: row.created_by_email
})

export class RedemptionCodeObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS code (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        secret_hash TEXT NOT NULL UNIQUE,
        masked_code TEXT NOT NULL,
        points INTEGER NOT NULL CHECK(points > 0),
        max_uses INTEGER NOT NULL CHECK(max_uses > 0),
        active INTEGER NOT NULL DEFAULT 1,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        created_by_uid TEXT NOT NULL,
        created_by_email TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS uses (
        id TEXT PRIMARY KEY,
        code_id TEXT NOT NULL,
        code_label TEXT NOT NULL,
        uid TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL,
        points INTEGER NOT NULL,
        redeemed_at TEXT NOT NULL,
        point_log_id TEXT,
        status TEXT NOT NULL CHECK(status IN ('pending', 'completed'))
      );
      CREATE INDEX IF NOT EXISTS uses_redeemed_at ON uses(redeemed_at DESC, id DESC);
    `)
  }

  private codeRow(): CodeRow | undefined {
    return this.ctx.storage.sql.exec<CodeRow>('SELECT * FROM code LIMIT 1').toArray()[0]
  }

  private usageCount(): number {
    return Number(this.ctx.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM uses WHERE status = 'completed'").one().count)
  }

  private expirePending(): void {
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    this.ctx.storage.sql.exec("DELETE FROM uses WHERE status = 'pending' AND redeemed_at < ?", cutoff)
  }

  create(input: CreateRedemptionCodeInput): { created: boolean; code: RedemptionCodeSummary } {
    return this.ctx.storage.transactionSync(() => {
      const existing = this.codeRow()
      if (existing) return { created: false, code: summaryFromRow(existing, this.usageCount()) }
      this.ctx.storage.sql.exec(
        `INSERT INTO code (
          id, label, secret_hash, masked_code, points, max_uses, active,
          expires_at, created_at, created_by_uid, created_by_email
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        input.id,
        input.label,
        input.secretHash,
        input.maskedCode,
        input.points,
        input.maxUses,
        input.expiresAt || null,
        input.createdAt,
        input.createdByUid,
        input.createdByEmail
      )
      const row = this.codeRow()
      if (!row) throw new Error('兑换码创建失败')
      return { created: true, code: summaryFromRow(row, 0) }
    })
  }

  getCode(): RedemptionCodeRecord | null {
    const row = this.codeRow()
    if (!row) return null
    return { ...summaryFromRow(row, this.usageCount()), secretHash: row.secret_hash }
  }

  setActive(active: boolean): RedemptionCodeSummary | null {
    return this.ctx.storage.transactionSync(() => {
      const row = this.codeRow()
      if (!row) return null
      this.ctx.storage.sql.exec('UPDATE code SET active = ?', active ? 1 : 0)
      return summaryFromRow({ ...row, active: active ? 1 : 0 }, this.usageCount())
    })
  }

  getUse(uid: string): RedemptionUse | null {
    const row = this.ctx.storage.sql.exec<UseRow>('SELECT * FROM uses WHERE uid = ?', uid).toArray()[0]
    return row ? useFromRow(row) : null
  }

  cancel(useId: string): boolean {
    return this.ctx.storage.transactionSync(() => {
      const row = this.ctx.storage.sql.exec<UseRow>('SELECT * FROM uses WHERE id = ?', useId).toArray()[0]
      if (!row || row.status !== 'pending') return false
      this.ctx.storage.sql.exec('DELETE FROM uses WHERE id = ?', useId)
      return true
    })
  }

  reserve(uid: string, email: string): RedemptionReservation {
    return this.ctx.storage.transactionSync(() => {
      this.expirePending()
      const code = this.codeRow()
      if (!code) return { ok: false, reason: 'not_found' }
      const summary = summaryFromRow(code, this.usageCount())
      const prior = this.ctx.storage.sql.exec<UseRow>('SELECT * FROM uses WHERE uid = ?', uid).toArray()[0]
      if (prior?.status === 'completed') return { ok: false, reason: 'already_redeemed', code: summary }
      if (!summary.active) return { ok: false, reason: 'inactive', code: summary }
      if (summary.expiresAt && Date.parse(summary.expiresAt) <= Date.now()) {
        return { ok: false, reason: 'expired', code: summary }
      }
      if (prior) return { ok: true, resumed: true, use: useFromRow(prior), code: summary }
      const pendingCount = Number(
        this.ctx.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM uses WHERE status = 'pending'").one().count
      )
      if (summary.useCount + pendingCount >= summary.maxUses) return { ok: false, reason: 'exhausted', code: summary }

      const use: RedemptionUse = {
        id: randomId(),
        codeId: summary.id,
        codeLabel: summary.label,
        uid,
        email,
        points: summary.points,
        redeemedAt: nowIso(),
        status: 'pending'
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO uses (id, code_id, code_label, uid, email, points, redeemed_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
        use.id,
        use.codeId,
        use.codeLabel,
        use.uid,
        use.email,
        use.points,
        use.redeemedAt
      )
      return { ok: true, use, code: { ...summary, useCount: summary.useCount + 1 } }
    })
  }

  complete(useId: string, pointLogId: string): RedemptionUse | null {
    return this.ctx.storage.transactionSync(() => {
      const row = this.ctx.storage.sql.exec<UseRow>('SELECT * FROM uses WHERE id = ?', useId).toArray()[0]
      if (!row) return null
      if (row.status !== 'completed') {
        this.ctx.storage.sql.exec(
          "UPDATE uses SET status = 'completed', point_log_id = ? WHERE id = ?",
          pointLogId,
          useId
        )
      }
      return useFromRow({ ...row, status: 'completed', point_log_id: pointLogId })
    })
  }

  listUses(page = 1, pageSize = 50): { items: RedemptionUse[]; total: number; page: number; pageSize: number } {
    const safePage = Math.max(1, Math.trunc(page))
    const safePageSize = Math.min(100, Math.max(1, Math.trunc(pageSize)))
    const total = this.usageCount()
    const rows = this.ctx.storage.sql
      .exec<UseRow>(
        'SELECT * FROM uses ORDER BY redeemed_at DESC, id DESC LIMIT ? OFFSET ?',
        safePageSize,
        (safePage - 1) * safePageSize
      )
      .toArray()
    return { items: rows.map(useFromRow), total, page: safePage, pageSize: safePageSize }
  }
}
