import { describe, it, expect } from 'vitest'
import { getBaseStyles } from './mount'

/**
 * WCAG AA contrast gate for the design-token palette.
 *
 * The tokens are authored in oklch. This test parses the REAL `getBaseStyles()`
 * output (not a copy), converts each token to sRGB, and asserts every colour
 * used as value text clears AA 4.5:1 against BOTH surfaces it can sit on
 * (`--dt-bg` and the lighter `--dt-bg-card`, which costs ~13% contrast).
 *
 * It exists because several syntax colours passed on `--dt-bg` yet failed on
 * `--dt-bg-card` — a gap invisible to a single-surface eyeball check. If a
 * future edit dims a token back below AA, this fails rather than shipping.
 *
 * The oklch→sRGB + contrast maths is intentionally inlined and dependency-free
 * so the guarantee survives independent of any external audit tooling.
 */

function oklchToSrgb(L: number, C: number, hDeg: number) {
  const h = (hDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3
  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  const gamma = (x: number) => {
    const v = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055
    return Math.max(0, Math.min(1, v))
  }
  return [gamma(lr), gamma(lg), gamma(lb)] as const
}

function relativeLuminance([r, g, b]: readonly [number, number, number]) {
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(fg: readonly [number, number, number], bg: readonly [number, number, number]) {
  const l1 = relativeLuminance(fg)
  const l2 = relativeLuminance(bg)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

/** Parse `--dt-<token>: oklch(L C H)` values (skips alpha `/` and `var()` forms). */
function parseTokens(block: string): Record<string, readonly [number, number, number]> {
  const out: Record<string, readonly [number, number, number]> = {}
  const re = /--dt-([a-z-]+):\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+(-?[\d.]+)\s*\)/g
  for (const m of block.matchAll(re)) {
    out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])]
  }
  return out
}

/** Split the two scope blocks out of the generated stylesheet. */
function themeBlocks() {
  const css = getBaseStyles(':host')
  const light = css.indexOf(':host([data-theme="light"])')
  expect(light).toBeGreaterThan(0)
  // Dark tokens live before the light-scope selector; light after it.
  return { dark: parseTokens(css.slice(0, light)), light: parseTokens(css.slice(light)) }
}

// Colours rendered as value text somewhere in the UI — every one must clear AA
// on both surfaces. Neutral secondary text (muted/dim) is asserted separately.
const VALUE_TEXT = ['text', 'accent', 'green', 'red', 'blue', 'purple', 'amber', 'cyan', 'teal', 'emerald']
const SURFACES = ['bg', 'bg-card'] as const

describe('token palette WCAG AA contrast', () => {
  const themes = themeBlocks()

  for (const themeName of ['dark', 'light'] as const) {
    const t = themes[themeName]

    it(`${themeName}: parses a full palette`, () => {
      for (const name of [...VALUE_TEXT, 'bg', 'bg-card', 'text-muted', 'accent-surface']) {
        expect(t[name], `${themeName} --dt-${name}`).toBeTruthy()
      }
    })

    it(`${themeName}: white label text on --dt-accent-surface clears 4.5:1`, () => {
      // Filled controls (active buttons/chips) paint white text on
      // --dt-accent-surface. This is the OTHER side of the accent split: the
      // bright --dt-accent is only 3.13:1 under white, which is why filled
      // controls use the darker surface shade instead.
      const white = [1, 1, 1] as const
      const ratio = contrast(white, oklchToSrgb(...t['accent-surface']))
      expect(ratio, `white on --dt-accent-surface = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    })

    for (const fg of VALUE_TEXT) {
      it(`${themeName}: --dt-${fg} clears 4.5:1 on bg and bg-card`, () => {
        for (const surface of SURFACES) {
          const ratio = contrast(oklchToSrgb(...t[fg]), oklchToSrgb(...t[surface]))
          expect(ratio, `--dt-${fg} on --dt-${surface} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
        }
      })
    }

    it(`${themeName}: secondary text (muted/dim) clears AA on both surfaces`, () => {
      // muted/dim measured 4.39:1 on the lighter card in light theme; both were
      // darkened to L=0.542 so they now clear AA on bg AND bg-card, no exception.
      for (const fg of ['text-muted', 'text-dim']) {
        for (const surface of SURFACES) {
          const ratio = contrast(oklchToSrgb(...t[fg]), oklchToSrgb(...t[surface]))
          expect(ratio, `--dt-${fg} on --dt-${surface} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
        }
      }
    })
  }
})
