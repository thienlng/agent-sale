import { describe, expect, it } from 'vitest';

import { CALCULATE_TOOL, calculate, calculateTool } from '../application/calculator.js';

const value = (expression: string) => {
  const r = calculate(expression);
  return 'value' in r ? r.value : r.error;
};

describe('calculate', () => {
  it('computes exact totals and formats them with vi-VN grouping', () => {
    expect(calculate('2*880000 + 460000')).toEqual({ value: '2220000', formatted: '2.220.000' });
  });

  it('reads Vietnamese thousands dots', () => {
    expect(calculate('1.760.000 + 30.000')).toEqual({ value: '1790000', formatted: '1.790.000' });
  });

  it('is exact with decimals', () => {
    expect(calculate('0.1+0.2')).toEqual({ value: '0.3', formatted: '0,3' });
  });

  it('supports postfix percent', () => {
    expect(value('2220000 * 10%')).toBe('222000');
  });

  it('supports round with digits', () => {
    expect(calculate('round(1234.567, 2)')).toEqual({ value: '1234.57', formatted: '1.234,57' });
  });

  it('rounds non-integers to 2 decimals for display only', () => {
    const r = calculate('10/3');
    expect(r).toMatchObject({ formatted: '3,33' });
    expect('value' in r && r.value.startsWith('3.3333333333')).toBe(true);
  });

  it.each(['2 x 3', '2 × 3', '2x3'])('reads %s as a multiplication', (e) => {
    expect(value(e)).toBe('6');
  });

  it('reads a comma as the decimal separator', () => {
    expect(value('1,5 * 2')).toBe('3');
    expect(value('1,25 + 1,2345')).toBe('2.4845');
  });

  it('reads comma thousands', () => {
    expect(value('500,000')).toBe('500000');
    expect(value('1,500,000 + 2 * 250,000')).toBe('2000000');
    expect(value('1.760.000 + 30,000')).toBe('1790000');
  });

  it('keeps commas in function arguments as separators', () => {
    expect(value('max(1,500)')).toBe('500');
    // Inside a call every comma separates arguments: round(1, 15) and round(1500, 0).
    expect(value('round(1,5 * 3)')).toBe('1');
    expect(value('round(1500,000 / 7)')).toBe('1500');
    expect(value('round(1500000 / 7)')).toBe('214286');
  });

  it('applies percent to the left operand', () => {
    expect(value('100 + 10%')).toBe('110');
    expect(value('100 - 10%')).toBe('90');
    expect(value('2220000 - 10%')).toBe('1998000');
  });

  it('shows a tiny negative as 0 but keeps the exact value', () => {
    expect(calculate('-0.001')).toEqual({ value: '-0.001', formatted: '0' });
  });

  it('keeps commas between function arguments', () => {
    expect(value('max(1,5)')).toBe('5');
    expect(value('min(3, 2, 7) + sum(1, 2)')).toBe('5');
  });

  it('allows the whitelisted functions', () => {
    expect(value('floor(2.7) + ceil(2.1) + abs(-4)')).toBe('9');
  });

  it('formats negative results', () => {
    expect(calculate('1000 - 1234567')).toEqual({ value: '-1233567', formatted: '-1.233.567' });
  });

  it.each([
    'import({}, {})',
    'createUnit("x")',
    'f(x)=x',
    '[1,2]',
    '5 cm',
    'evaluate("1")',
    'parse("1")',
    'simplify("x")',
    'a = 1',
    'pi',
    '10 % 3',
    '"".constructor',
    'Infinity',
    'NaN',
    '"5" + 1',
    'true + 1',
    '1 == 1',
    '',
    '2 +',
  ])('rejects %s', (e) => {
    expect(calculate(e)).toEqual({ error: 'invalid_expression' });
  });

  it.each(['10^16', '1/0', '2^100', '1e16', '999999999999999 + 2'])(
    'rejects %s as out of range',
    (e) => {
      expect(calculate(e)).toEqual({ error: 'out_of_range' });
    },
  );

  it.each([
    '1e-999999999999',
    '1/1e10000000',
    '((((10^-15)^15)^15)^15)^15',
    '(10^-15)^15',
    '9^9^9',
    '1e-16',
    '1 / 10^15 / 10',
  ])('rejects %s as out of range quickly', (e) => {
    const started = performance.now();
    expect(calculate(e)).toEqual({ error: 'out_of_range' });
    expect(performance.now() - started).toBeLessThan(50);
  });

  it('keeps nested percents linear instead of doubling the tree', () => {
    const e = `${'('.repeat(60)}1${'+1%)'.repeat(60)}`;
    const started = performance.now();
    expect(calculate(e)).toEqual({ error: 'invalid_expression' });
    expect(performance.now() - started).toBeLessThan(50);
  });

  it('allows two nested powers', () => {
    expect(value('(2^3)^2')).toBe('64');
  });

  it('accepts exponents up to 15', () => {
    expect(value('10^15')).toBe('1000000000000000');
  });

  it('rejects expressions longer than 300 characters', () => {
    const long = `${'1+'.repeat(150)}1`;
    expect(long.length).toBe(301);
    expect(calculate(long)).toEqual({ error: 'invalid_expression' });
  });
});

describe('calculateTool', () => {
  it('is a read-only tool named calculate', () => {
    expect(calculateTool.name).toBe('calculate');
    expect(calculateTool.readOnly).toBe(true);
    expect(CALCULATE_TOOL.name).toBe('calculate');
    expect(CALCULATE_TOOL.description).toMatch(/total/);
  });

  it('caps the expression at 300 characters', () => {
    expect(calculateTool.schema.safeParse({ expression: '1'.repeat(300) }).success).toBe(true);
    expect(calculateTool.schema.safeParse({ expression: '1'.repeat(301) }).success).toBe(false);
  });

  it('returns the result as JSON', async () => {
    const out = await calculateTool.run({ expression: '2*880000 + 460000' });
    expect(JSON.parse(out.content)).toEqual({ value: '2220000', formatted: '2.220.000' });
    expect(out.ok).not.toBe(false);
  });

  it('returns a handled error for a bad expression', async () => {
    const out = await calculateTool.run({ expression: '1/0' });
    expect(JSON.parse(out.content)).toEqual({ error: 'out_of_range' });
    expect(out.ok).toBe(false);
  });
});
