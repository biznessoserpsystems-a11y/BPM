import { describe, it, expect } from 'vitest';
import { pdfSafeText } from '../src/lib/pdf-export';

describe('pdfSafeText', () => {
  it('writes GHS instead of the cedi sign the PDF font cannot draw', () => {
    expect(pdfSafeText('GH₵12.00')).toBe('GHS 12.00');
    expect(pdfSafeText('(GH₵ 7.00)')).toBe('(GHS 7.00)');
    expect(pdfSafeText('₵5.00')).toBe('GHS 5.00');
  });
  it('leaves other text alone', () => {
    expect(pdfSafeText('GHS 12.00')).toBe('GHS 12.00');
    expect(pdfSafeText('Menstak')).toBe('Menstak');
  });
});
