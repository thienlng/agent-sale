import { type ComponentProps, useEffect, useState } from 'react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const group = (n: number) => new Intl.NumberFormat('vi-VN').format(n);

/**
 * Integer VND input shown with thousand separators ("1.250.000") and a numeric
 * keyboard on phones. Emits whole numbers; empty means 0.
 */
export function MoneyInput({
  value,
  onValueChange,
  className,
  max = 1_000_000_000_000,
  ...props
}: Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> & {
  value: number;
  onValueChange: (value: number) => void;
  max?: number;
}) {
  const [text, setText] = useState(value ? group(value) : '');
  useEffect(() => {
    setText((current) =>
      Number(current.replace(/\D/g, '') || 0) === value ? current : value ? group(value) : '',
    );
  }, [value]);
  return (
    <Input
      {...props}
      inputMode="numeric"
      autoComplete="off"
      value={text}
      className={cn('text-right tabular-nums', className)}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, '').slice(0, 13);
        const n = Math.min(Number(digits || 0), max);
        setText(digits ? group(n) : '');
        onValueChange(n);
      }}
    />
  );
}
