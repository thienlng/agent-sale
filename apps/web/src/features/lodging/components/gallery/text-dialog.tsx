import { type FormEvent, useEffect, useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** One text field in a dialog (folder name, caption); `validate` returns an error text or null. */
export function TextDialog({
  open,
  onOpenChange,
  title,
  label,
  initial,
  maxLength,
  placeholder,
  submitLabel,
  validate,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  label: string;
  initial: string;
  maxLength: number;
  placeholder?: string | undefined;
  submitLabel: string;
  validate?: ((value: string) => string | null) | undefined;
  onSubmit: (value: string) => void;
}) {
  const id = useId();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setValue(initial);
      setError(null);
    }
  }, [open, initial]);
  const submit = (e: FormEvent) => {
    // Portalled out of the tab's <form>, but React still bubbles the submit event to it.
    e.preventDefault();
    e.stopPropagation();
    const problem = validate?.(value) ?? null;
    if (problem) setError(problem);
    else onSubmit(value);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <form noValidate onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={id}>{label}</Label>
            <Input
              id={id}
              value={value}
              maxLength={maxLength}
              placeholder={placeholder}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
            />
            {error && (
              <p id={`${id}-error`} className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="submit">{submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
