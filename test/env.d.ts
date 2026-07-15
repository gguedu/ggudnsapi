import type { Env as WorkerEnv } from '../src/types'

declare module 'cloudflare:test' {
  interface ProvidedEnv extends WorkerEnv {}
}

declare module 'cloudflare:workers' {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}
