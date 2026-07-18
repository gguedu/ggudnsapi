import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['.claude/**', 'node_modules/**']
  },
  plugins: [
    cloudflareTest({
      main: './src/index.ts',
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        outboundService: async request => {
          const url = new URL(request.url)
          if (url.hostname === 'mail.ggu.edu.kg') {
            const token = request.headers.get('authorization')
            if (token === 'banned-token') {
              return Response.json({ data: { userId: 'banned', email: 'banned@example.net', name: 'Banned' } })
            }
            if (token === 'reader-token') {
              return Response.json({ data: { userId: 'reader', email: 'reader@example.net', name: 'Reader' } })
            }
            return Response.json({ data: { userId: 'admin', email: 'admin@ggu.edu.kg', name: 'Admin' } })
          }
          if (url.hostname === 'api.cloudflare.com') {
            if (request.method === 'GET' && url.pathname.endsWith('/zones')) {
              return Response.json({ success: true, result: [{ id: 'zone-1', name: 'example.com' }] })
            }
            if (request.method === 'GET') return Response.json({ success: true, result: [] })
            if (request.method === 'POST') {
              const body = await request.clone().json<Record<string, unknown>>()
              if (body.content === 'fail-create') {
                return Response.json({ success: false, result: null, errors: [{ message: 'create failed' }] }, { status: 500 })
              }
              return Response.json({ success: true, result: { id: crypto.randomUUID(), ...body } })
            }
            if (request.method === 'DELETE') {
              return Response.json({ success: true, result: { id: url.pathname.split('/').at(-1) } })
            }
          }
          return new Response('Not Found', { status: 404 })
        }
      }
    })
  ]
})
