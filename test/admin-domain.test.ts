import { SELF, reset } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CfAccount, ManagedDomain, Settings } from '../src/types'
import { getDomain, putCfAccount, putDomain, putSettings, putUser } from '../src/kv'

const root = 'example.com'
const now = () => new Date().toISOString()

const account: CfAccount = {
  id: 'account-1',
  name: 'test',
  authType: 'token',
  apiTokenEncrypted: 'token',
  createdAt: now(),
  updatedAt: now()
}

const domain: ManagedDomain = {
  root,
  zoneId: 'zone-1',
  cfAccountId: account.id,
  enabled: true,
  pointCost: 1,
  createdAt: now(),
  updatedAt: now()
}

const settings: Settings = {
  protectionEnabled: true,
  initialPoints: 1,
  deleteRefundEnabled: true,
  allowedTypes: ['A'],
  defaultTtl: 600,
  updatedAt: now()
}

const adminRequest = (path: string, body: Record<string, unknown>) =>
  SELF.fetch(`https://worker.test${path}`, {
    method: 'PATCH',
    headers: { authorization: 'admin-token', 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })

beforeEach(async () => {
  await reset()
  await Promise.all([
    putSettings(env, settings),
    putCfAccount(env, account),
    putDomain(env, domain),
    putUser(env, {
      uid: 'admin',
      email: 'admin@ggu.edu.kg',
      points: 1,
      initialGrantDone: true,
      createdAt: now(),
      lastSeenAt: now()
    })
  ])
})

describe('admin domain PATCH', () => {
  it('preserves the existing banned-user gate', async () => {
    await putUser(env, {
      uid: 'banned',
      email: 'banned@example.net',
      points: 1,
      initialGrantDone: true,
      banned: true,
      bannedReason: 'test ban',
      createdAt: now(),
      lastSeenAt: now()
    })
    const response = await SELF.fetch('https://worker.test/api/records', {
      method: 'POST',
      headers: { authorization: 'banned-token', 'content-type': 'application/json' },
      body: JSON.stringify({ fullDomain: `blocked.${root}`, type: 'A', content: '192.0.2.1', ttl: 600 })
    })
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      message: '该账号已被限制使用 DNS 服务',
      data: { code: 'DNS_USER_BANNED', reason: 'test ban' }
    })
  })

  it('rejects root changes without creating the destination key', async () => {
    const response = await adminRequest(`/api/admin/domains/${root}`, { root: 'renamed.example.com' })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ success: false, message: '域名不可修改' })
    expect(await getDomain(env, root)).toEqual(domain)
    expect(await getDomain(env, 'renamed.example.com')).toBeNull()
  })

  it('canonicalizes equivalent route and body roots', async () => {
    const response = await adminRequest('/api/admin/domains/EXAMPLE.COM.', { root: 'Example.COM.', enabled: false })
    expect(response.status).toBe(200)
    const next = await getDomain(env, root)
    expect(next?.root).toBe(root)
    expect(next?.enabled).toBe(false)
  })
})
