/**
 * The legacy modules are still classic scripts in module clothing: each one republishes
 * its top-level declarations onto `window` so the not-yet-extracted code can keep
 * reading them by bare name (see src/legacy-bridge.ts).
 *
 * Under Vitest's `node` environment there is no `window`, so importing one of them would
 * throw before a single assertion ran. Pointing `window` at `globalThis` is enough for
 * the pure-logic files — they touch no DOM — and avoids paying for a jsdom environment
 * on tests that are just arithmetic.
 */
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = globalThis;
}

export {};
