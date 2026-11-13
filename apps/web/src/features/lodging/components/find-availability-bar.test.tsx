import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/testing/render';

import { FindAvailabilityBar } from './find-availability-bar';

function setup() {
  const onSearch = vi.fn();
  renderWithProviders(
    <FindAvailabilityBar active={false} status={null} onSearch={onSearch} onClear={vi.fn()} />,
  );
  fireEvent.change(screen.getByLabelText('Nhận phòng'), { target: { value: '2026-12-19' } });
  fireEvent.change(screen.getByLabelText('Trả phòng'), { target: { value: '2026-12-20' } });
  return onSearch;
}

describe('FindAvailabilityBar (VL-A2)', () => {
  it('blames the missing child ages, not the valid dates', async () => {
    const onSearch = setup();
    fireEvent.change(screen.getByLabelText('Trẻ em'), { target: { value: '2' } });
    await userEvent.click(screen.getByRole('button', { name: 'Tìm' }));

    expect(onSearch).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Nhập tuổi từng trẻ');
    expect(screen.queryByText(/Ngày trả phòng phải sau/)).toBeNull();
    expect(screen.getByLabelText('Nhận phòng')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Trả phòng')).not.toHaveAttribute('aria-invalid');
  });

  it('flags the dates when the stay range is wrong', async () => {
    const onSearch = setup();
    fireEvent.change(screen.getByLabelText('Trả phòng'), { target: { value: '2026-12-18' } });
    // The native `min` would block a click; submit directly to exercise our own check.
    fireEvent.submit(screen.getByRole('search'));

    expect(onSearch).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Ngày trả phòng phải sau');
    expect(screen.getByLabelText('Nhận phòng')).toHaveAttribute('aria-invalid', 'true');
  });

  it('searches once dates and ages are complete', async () => {
    const onSearch = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Tìm' }));
    expect(onSearch).toHaveBeenCalledWith({
      checkIn: '2026-12-19',
      checkOut: '2026-12-20',
      party: { adults: 2, childAges: [] },
    });
  });
});
