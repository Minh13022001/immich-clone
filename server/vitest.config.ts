import { defineConfig } from 'vitest/config';

/**
 * Test runner configuration (spec §10).
 *
 * `include` is deliberately limited to `src/**` so the spec files live next to
 * the code they cover (the Nest convention) and stay inside the project the
 * TypeScript compiler already checks.
 *
 * Note on dependency injection: the tests instantiate services and controllers
 * by hand instead of through `@nestjs/testing`. Vitest transforms with esbuild,
 * which supports `experimentalDecorators` but cannot emit `design:paramtypes`,
 * so Nest's reflector has no constructor metadata to inject from. Building the
 * object graph explicitly is what keeps these tests runnable without a second
 * compiler.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    // DTO modules use `@Type(() => ...)`, which needs the `Reflect.getMetadata`
    // polyfill in place before they are evaluated.
    setupFiles: ['src/test-setup.ts'],
    restoreMocks: true,
  },
});
