import { describe, expect, it } from 'vitest';
import { generateSchemeCss } from '../../src/themes/material-you/color-engine';

function hexToRelativeLuminance(hex: string): number {
  const clean = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  const channels = [0, 2, 4].map((offset) => {
    const srgb = parseInt(clean.slice(offset, offset + 2), 16) / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function extractVarHex(block: string, varName: string): string {
  const match = block.match(new RegExp(`${varName}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) {
    throw new Error(`Token ${varName} not found in CSS block`);
  }
  return match[1];
}

describe('Material You light outline-variant lightness calibration', () => {
  const seeds = ['#0b57d0', '#9c4146', '#386a20'];

  it.each(seeds)(
    'uses high-lightness neutral Tone 91 for light outline-variant while preserving outline & dark tokens (%s)',
    (seed) => {
      const css = generateSchemeCss(seed);
      const darkMarker = ":root[data-theme='dark']";
      const splitIndex = css.indexOf(darkMarker);
      expect(splitIndex).toBeGreaterThan(0);

      const lightBlock = css.slice(0, splitIndex);
      const darkBlock = css.slice(splitIndex);

      const lightOutlineVariant = extractVarHex(lightBlock, '--md-sys-color-outline-variant');
      const lightOutline = extractVarHex(lightBlock, '--md-sys-color-outline');
      const darkOutlineVariant = extractVarHex(darkBlock, '--md-sys-color-outline-variant');

      expect(hexToRelativeLuminance(lightOutlineVariant)).toBeGreaterThan(0.72);
      expect(hexToRelativeLuminance(lightOutline)).toBeLessThan(0.35);
      expect(hexToRelativeLuminance(darkOutlineVariant)).toBeLessThan(0.2);
    }
  );
});
