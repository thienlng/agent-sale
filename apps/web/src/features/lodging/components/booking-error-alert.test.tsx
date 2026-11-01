import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ApiClientError } from '@/lib/api-client';
import { renderWithProviders } from '@/testing/render';

import { BookingErrorAlert } from './booking-error-alert';

describe('BookingErrorAlert', () => {
  it('asks for the total price when the server refuses a missing manual price', () => {
    const error = new ApiClientError(400, 'VALIDATION_FAILED', 'price', undefined, {
      field: 'manualTotalSell',
    });
    renderWithProviders(<BookingErrorAlert error={error} />);
    expect(
      screen.getByText(
        'Ngày, phòng hoặc số khách đã đổi. Nhập giá thủ công mới hoặc chọn dùng giá tính tự động.',
      ),
    ).toBeInTheDocument();
  });

  it('keeps the generic message for other validation errors', () => {
    const error = new ApiClientError(400, 'VALIDATION_FAILED', 'bad', undefined, {
      field: 'checkOut',
    });
    renderWithProviders(<BookingErrorAlert error={error} />);
    expect(screen.getByText('Không lưu được. Kiểm tra thông tin rồi thử lại.')).toBeInTheDocument();
  });
});
