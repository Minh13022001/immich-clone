/**
 * Vitest setup (spec §10).
 *
 * `main.ts` loads `reflect-metadata` once for the whole application, which is
 * what lets `class-transformer` (`@Type(() => ...)`) and Nest's decorators work.
 * Tests import the DTO modules directly, so the polyfill has to be loaded before
 * any test module is evaluated — hence a setup file rather than an import in
 * each spec.
 */
import 'reflect-metadata';
