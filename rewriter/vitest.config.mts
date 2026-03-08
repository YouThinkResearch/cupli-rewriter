import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  // typeid-js transitively imports 'uuid' (a Node-style package) which the
  // Workers sandbox cannot resolve on its own.  Marking it as non-external
  // tells Vite to bundle typeid-js + uuid into the worker bundle so the
  // sandbox never has to resolve the raw package itself.
  ssr: {
    noExternal: ['typeid-js'],
  },
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
      },
    },
  },
})
