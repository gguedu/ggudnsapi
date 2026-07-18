import { SELF, reset } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CfAccount, DnsUser, ManagedDomain, Settings } from '../src/types'
import { getUser, listUserPointLogs, putCfAccount, putDomain, putSettings, putUser } from '../src/kv'

const now = () => new Date().toISOString()

const settings: Settings = {
  protectionEnabled: true,
  initialPoints: 1,
  deleteRefundEnabled: true,
  allowedTypes: ['A'],
  defaultTtl: 600,
  updatedAt: now()
}

const account: CfAccount = {
  id: 'account-1',
  name: 'test',
  authType: 'token',
  apiTokenEncrypted: 'token',
  createdAt: now(),
  updatedAt: now()
}

const domain: ManagedDomain = {
  root: 'example.com',
  zoneId: 'zone-1',
  cfAccountId: account.id,
  enabled: true,
  pointCost: 1,
  createdAt: now(),
  updatedAt: now()
}

const user = (overrides: Partial<DnsUser> = {}): DnsUser => ({
  uid: 'reader',
  email: 'reader@example.net',
  name: 'Reader',
  points: 7,
  initialGrantDone: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
  ...overrides
})

beforeEach(async () => {
  await reset()
  await putSettings(env, settings)
})

describe('read-only authentication paths', () => {
  it('keeps normal-user GET requests from mutating the user or awarding points', async () => {
    const original = user()
    await putUser(env, original)

    const responses = await Promise.all([
      SELF.fetch('https://worker.test/api/auth/me', { headers: { authorization: 'reader-token' } }),
      SELF.fetch('https://worker.test/api/records', { headers: { authorization: 'reader-token' } }),
      SELF.fetch('https://worker.test/api/points', { headers: { authorization: 'reader-token' } })
    ])

    expect(responses.map(response => response.status)).toEqual([200, 200, 200])
    expect(await getUser(env, original.uid)).toEqual(original)
    expect(await env.USER_POINTS.getByName(original.uid).getBalance()).toBeNull()
    expect(await listUserPointLogs(env, original.uid)).toEqual([])
  })

  it('keeps admin reads from provisioning or changing the administrator DNS user', async () => {
    const original = user({ uid: 'admin', email: 'admin@ggu.edu.kg' })
    await putUser(env, original)

    const responses = await Promise.all([
      SELF.fetch('https://worker.test/api/admin/settings', { headers: { authorization: 'admin-token' } }),
      SELF.fetch('https://worker.test/api/admin/domains', { headers: { authorization: 'admin-token' } }),
      SELF.fetch('https://worker.test/api/admin/blacklist', { headers: { authorization: 'admin-token' } })
    ])

    expect(responses.map(response => response.status)).toEqual([200, 200, 200])
    expect(await getUser(env, original.uid)).toEqual(original)
    expect(await env.USER_POINTS.getByName(original.uid).getBalance()).toBeNull()
  })

  it('keeps admin configuration writes off the acting administrator user state', async () => {
    const original = user({ uid: 'admin', email: 'admin@ggu.edu.kg' })
    await putUser(env, original)

    const [settingsResponse, blacklistResponse] = await Promise.all([
      SELF.fetch('https://worker.test/api/admin/settings', {
        method: 'PATCH',
        headers: { authorization: 'admin-token', 'content-type': 'application/json' },
        body: JSON.stringify({ defaultTtl: 900 })
      }),
      SELF.fetch('https://worker.test/api/admin/blacklist', {
        method: 'POST',
        headers: { authorization: 'admin-token', 'content-type': 'application/json' },
        body: JSON.stringify({ pattern: 'blocked.example', type: 'exact', target: 'domain' })
      })
    ])

    expect(settingsResponse.status).toBe(200)
    expect(blacklistResponse.status).toBe(200)
    expect(await getUser(env, original.uid)).toEqual(original)
    expect(await env.USER_POINTS.getByName(original.uid).getBalance()).toBeNull()
  })

  it('does not provision an administrator who has never used the DNS service', async () => {
    const response = await SELF.fetch('https://worker.test/api/admin/settings', {
      headers: { authorization: 'admin-token' }
    })

    expect(response.status).toBe(200)
    expect(await getUser(env, 'admin')).toBeNull()
    expect(await env.USER_POINTS.getByName('admin').getBalance()).toBeNull()
  })

  it('routes one record write directly to the target user coordinator', async () => {
    await Promise.all([putCfAccount(env, account), putDomain(env, domain)])

    const response = await SELF.fetch('https://worker.test/api/records', {
      method: 'POST',
      headers: { authorization: 'reader-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        fullDomain: 'created.example.com',
        type: 'A',
        content: '192.0.2.1',
        ttl: 600,
        operationId: 'single-write-operation'
      })
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { record: { id: 'single-write-operation', uid: 'reader' }, user: { points: 0 } }
    })
    expect(await getUser(env, 'reader')).toMatchObject({ uid: 'reader', email: 'reader@example.net', points: 0 })
    const logs = await listUserPointLogs(env, 'reader')
    expect(logs.filter(log => log.reason === 'initial_grant')).toHaveLength(1)
    expect(logs.filter(log => log.reason === 'create_record')).toHaveLength(1)
  })

  it('preserves the structured legacy ban error without writing user state', async () => {
    const original = user({ banned: true, bannedReason: 'legacy ban' })
    await putUser(env, original)

    const response = await SELF.fetch('https://worker.test/api/records', {
      headers: { authorization: 'reader-token' }
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      data: { code: 'DNS_USER_BANNED', reason: 'legacy ban' }
    })
    expect(await getUser(env, original.uid)).toEqual(original)
  })
})
