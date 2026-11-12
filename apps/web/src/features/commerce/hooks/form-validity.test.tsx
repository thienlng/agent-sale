import { render, screen } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';

import { Field, FieldErrorsContext } from '../components/order-form-parts';
import { invalidFields, revealField, validityMessage } from './form-validity';

const t = ((key: string) => key) as unknown as TFunction;

function form() {
  document.body.innerHTML = `
    <form novalidate>
      <input id="name" required value="Lan" />
      <input id="phone" type="tel" pattern="\\+?[0-9 .\\-]{8,15}" value="abc" />
      <textarea id="address" required></textarea>
      <input id="note" />
    </form>`;
  return document.querySelector('form')!;
}

describe('order form validation (TM-8)', () => {
  it('lists the invalid fields in document order', () => {
    expect(invalidFields(form()).map((el) => el.id)).toEqual(['phone', 'address']);
  });

  it('says why a field is invalid', () => {
    const [phone, address] = invalidFields(form());
    expect(validityMessage(t, phone!)).toBe('errors.invalidPhone');
    expect(validityMessage(t, address!)).toBe('errors.required');
  });

  it('centres the first invalid field (clear of the sticky total bar) and focuses it', () => {
    const [phone] = invalidFields(form());
    const scroll = vi.fn();
    phone!.scrollIntoView = scroll;
    revealField(phone!);
    expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    expect(document.activeElement).toBe(phone);
  });

  it('shows the error the form found under the field', () => {
    render(
      <FieldErrorsContext.Provider value={new Map([['of-address', 'Không được để trống']])}>
        <Field id="of-address" label="Địa chỉ">
          <input id="of-address" />
        </Field>
      </FieldErrorsContext.Provider>,
    );
    expect(screen.getByText('Không được để trống')).toHaveAttribute('id', 'of-address-error');
  });
});
