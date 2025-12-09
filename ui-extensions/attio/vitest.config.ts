import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
  },
  resolve: {
    alias: {
      'attio/client': new URL('./src/__mocks__/attio-client.ts', import.meta.url).pathname,
      './get-phone-number.graphql': new URL('./src/__mocks__/get-phone-number-graphql.ts', import.meta.url).pathname,
    },
  },
})
