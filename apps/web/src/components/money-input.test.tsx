import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { MoneyInput } from './money-input';

function Harness({ max }: { max?: number }) {
  const [v, setV] = useState(0);
  return (
    <>
      <MoneyInput aria-label="amount" value={v} onValueChange={setV} {...(max ? { max } : {})} />
      <output>{v}</output>
    </>
  );
}

describe('MoneyInput', () => {
  it('groups thousands as you type and emits whole VND', () => {
    render(<Harness />);
    const input = screen.getByLabelText('amount');
    fireEvent.change(input, { target: { value: '1250000' } });
    expect(input).toHaveValue('1.250.000');
    expect(screen.getByRole('status')).toHaveTextContent('1250000');
  });

  it('ignores non-digits and caps at max', () => {
    render(<Harness max={100} />);
    const input = screen.getByLabelText('amount');
    fireEvent.change(input, { target: { value: '15a0%' } });
    expect(screen.getByRole('status')).toHaveTextContent('100');
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByRole('status')).toHaveTextContent('0');
  });
});
