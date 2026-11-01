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

  it('asks for a manual price when a night has no price', () => {
    const error = new ApiClientError(400, 'VALIDATION_FAILED', 'price', undefined, {
      field: 'manualTotalSell',
      warnings: [{ code: 'missing_rate', nights: ['2099-11-02'] }],
    });
    renderWithProviders(<BookingErrorAlert error={error} />);
    expect(
      screen.getByText('Một số đêm chưa có giá. Nhập giá thủ công cho cả kỳ ở.'),
    ).toBeInTheDocument();
  });

  it('says a hold expired', () => {
    const error = new ApiClientError(409, 'CONFLICT', 'expired', undefined, {
      reason: 'HOLD_EXPIRED',
    });
    renderWithProviders(<BookingErrorAlert error={error} />);
    expect(screen.getByText(/^Giữ chỗ đã hết hạn/)).toBeInTheDocument();
  });

  it('keeps the generic message for other validation errors', () => {
    const error = new ApiClientError(400, 'VALIDATION_FAILED', 'bad', undefined, {
      field: 'checkOut',
    });
    renderWithProviders(<BookingErrorAlert error={error} />);
    expect(screen.getByText('Không lưu được. Kiểm tra thông tin rồi thử lại.')).toBeInTheDocument();
  });
});
