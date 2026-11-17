/// <reference types="vitest/config" />

import { defineConfig } from "vite"
import { playwright } from "@vitest/browser-playwright"

export default defineConfig(({ mode }) => ({
  test: {
    browser: {
      provider: playwright(),
      enabled: true,
      headless: true,
      // at least one instance is required
      instances: [{ browser: "chromium" as const }],
    },
    coverage: {
      enabled: true,
      reporter: ["text"],
      include: ["src/**"],
    },
  },
}))
