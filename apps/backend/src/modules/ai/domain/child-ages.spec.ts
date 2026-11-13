import { describe, expect, it } from 'vitest';

import { adultsVouched, partyNotGiven, unvouchedChildAges } from './child-ages.js';

const said = (text: string, ages: number[]) => unvouchedChildAges(ages, [text]);

describe('unvouchedChildAges (VL-B3, VL2-2)', () => {
  it('accepts ages written after an age word', () => {
    expect(said('9 người lớn và 3 bé 4, 4, 9 tuổi', [4, 4, 9])).toEqual([]);
    expect(said('2 bé 5 và 7 tuổi', [5, 7])).toEqual([]);
    expect(said('kids 1, 4 and 7 years old', [1, 4, 7])).toEqual([]);
    expect(said('a 4-year-old and a 9-year-old', [4, 9])).toEqual([]);
    expect(said('bé 4t', [4])).toEqual([]);
    expect(said('co tre con 3 tuoi voi 1 dua 8 tuoi', [3, 8])).toEqual([]);
  });

  it('accepts ages written after the age word (VL2-2)', () => {
    expect(said('10 adults and 3 kids aged 1, 4 and 7', [1, 4, 7])).toEqual([]);
    expect(said('two children, ages 3 and 5', [3, 5])).toEqual([]);
    expect(said('3 bé, tuổi lần lượt 1, 4, 7', [1, 4, 7])).toEqual([]);
    expect(said('bé lên 3, bé kia 6 tuổi', [3, 6])).toEqual([]);
    expect(said('3 cháu tuổi là 2, 5 và 9', [2, 5, 9])).toEqual([]);
  });

  it('never takes a date, a count or a stay length for an age', () => {
    expect(said('20 người lớn với 4 bé, A17 từ 8/1/2027 đến 10/1/2027', [8, 8, 8, 8])).toEqual([
      8, 8, 8, 8,
    ]);
    expect(said('kids aged 6, 10 adults', [6, 10])).toEqual([10]);
    expect(said('bé lên 3, ở 2 đêm', [3, 2])).toEqual([2]);
    expect(said('bé 4 tuổi', [5])).toEqual([5]);
    expect(said('4 bé đi cùng', [0, 0, 0, 0])).toEqual([0, 0, 0, 0]);
  });

  it('reads months and newborns', () => {
    expect(said('bé 18 tháng với bé sơ sinh', [1, 0])).toEqual([]);
  });

  it('vouches the English party of the tester (english-child-ages-prefix)', () => {
    expect(
      partyNotGiven({ adults: 10, childAges: [1, 4, 7] }, [
        'Hi, we are 10 adults and 3 kids aged 1, 4 and 7, E64 from 18 to 20 December',
      ]),
    ).toBeNull();
  });
});

describe('adultsVouched (VL3-5)', () => {
  it('accepts the per-villa counts of a split, a group size and added guests', () => {
    const split = ["Split us: 24 people in E64 and 16 in D33, both nights. What's the total?"];
    expect(adultsVouched(16, split)).toBe(true);
    expect(adultsVouched(24, split)).toBe(true);
    expect(adultsVouched(16, ['đoàn 30 người, 16 ở D33, còn lại ở E64'])).toBe(true);
    expect(adultsVouched(12, ['nhóm 12 đi Tam Đảo'])).toBe(true);
    expect(adultsVouched(26, ['EVANI 22 người lớn', 'sếp bảo thêm 4 người nữa'])).toBe(true);
  });

  it('still refuses a count the customer never wrote', () => {
    expect(adultsVouched(2, ['A17 còn trống cuối tuần này không? ở 2 đêm'])).toBe(false);
    expect(adultsVouched(18, ['E64 từ 18/12 đến 20/12'])).toBe(false);
    expect(adultsVouched(11, ['đến lúc 11 giờ'])).toBe(false);
  });
});
