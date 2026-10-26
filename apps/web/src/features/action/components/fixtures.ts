import type { ActionDto } from '@agent-sales/contracts';

export const BOT_ID = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d01';

/** A stored action as the API returns it (test helper). */
export function actionDto(over: Partial<ActionDto> = {}): ActionDto {
  return {
    id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a01',
    botId: BOT_ID,
    name: 'Tra cứu đơn hàng',
    description: 'Khi khách hỏi tình trạng đơn',
    url: 'https://shop.vn/orders/{orderId}',
    method: 'GET',
    params: [
      { name: 'orderId', type: 'string', location: 'path', required: true, description: 'Mã đơn' },
    ],
    responses: [
      {
        statusCode: 200,
        fields: [{ name: 'status', type: 'string', description: 'Tình trạng' }],
      },
    ],
    auth: { kind: 'bearer' },
    hasSecret: true,
    requiresConfirm: false,
    enabled: true,
    createdAt: '2026-10-25T00:00:00.000Z',
    updatedAt: '2026-10-25T00:00:00.000Z',
    ...over,
  };
}
