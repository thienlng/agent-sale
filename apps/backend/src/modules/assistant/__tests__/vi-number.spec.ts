import { describe, expect, it } from 'vitest';

import { parseMoneyVnd, parseNumberVi, parseWeightGrams } from '../domain/vi-number.js';

describe('parseNumberVi (the 1b ui_fill_form rule)', () => {
  it.each([
    ['150.000', 150_000],
    ['1.234.567', 1_234_567],
    ['150.000đ', 150_000],
    ['12.5', 12.5],
    ['0.75', 0.75],
    ['12,5', 12.5],
    ['1.234,56', 1234.56],
    ['150,000', 150_000],
    ['1 500 000 ₫', 1_500_000],
    ['-2.5', -2.5],
    ['42', 42],
  ])('reads %s as %s', (raw, n) => {
    expect(parseNumberVi(raw)).toBe(n);
  });

  it.each(['', 'abc', '1.2.3'])('refuses %j', (raw) => {
    expect(parseNumberVi(raw)).toBeNaN();
  });
});

describe('parseMoneyVnd', () => {
  it.each([
    ['150000', 150_000],
    ['150.000', 150_000],
    ['150,000', 150_000],
    ['150.000đ', 150_000],
    ['150.000 ₫', 150_000],
    ['150000 VND', 150_000],
    ['150000vnđ', 150_000],
    ['1 500 000', 1_500_000],
    ['150k', 150_000],
    ['150K', 150_000],
    ['150 nghìn', 150_000],
    ['1k5', 1_500],
    ['1,5tr', 1_500_000],
    ['1.5tr', 1_500_000],
    ['1,5 triệu', 1_500_000],
    ['2tr5', 2_500_000],
    ['2tr05', 2_050_000],
    ['3 tr', 3_000_000],
    ['99,5', 100],
    ['0', 0],
    [' 120.000 đ ', 120_000],
  ])('reads %j as %s', (raw, n) => {
    expect(parseMoneyVnd(raw)).toBe(n);
  });

  it('rounds numbers', () => {
    expect(parseMoneyVnd(150_000.4)).toBe(150_000);
  });

  it.each(['', 'liên hệ', 'abc', '-150000', '-5k', '150 usd', '1.2.3', '1.5tr5', '2000000000000'])(
    'refuses %j',
    (raw) => {
      expect(parseMoneyVnd(raw)).toBeNull();
    },
  );

  it('refuses negative numbers', () => {
    expect(parseMoneyVnd(-1)).toBeNull();
  });
});

describe('parseWeightGrams', () => {
  it.each([
    ['500g', 500],
    ['500 gr', 500],
    ['1,2kg', 1_200],
    ['1.2 kg', 1_200],
    ['1.5KG', 1_500],
    ['250', 250],
    ['2 ký', 2_000],
  ])('reads %j as %s', (raw, n) => {
    expect(parseWeightGrams(raw)).toBe(n);
  });

  it.each(['', 'nặng', '-5g', '5 lb', '1.2.3kg'])('refuses %j', (raw) => {
    expect(parseWeightGrams(raw)).toBeNull();
  });
});
