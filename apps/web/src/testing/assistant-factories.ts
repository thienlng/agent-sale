import type {
  AssistantMemoryDto,
  AssistantMessageDto,
  AssistantProposalDto,
  AssistantRunDto,
  AssistantThreadDto,
  ImportBatchDto,
  ImportDraftDto,
  SendAssistantMessageResponse,
} from '@agent-sales/contracts';

/** Test data for the owner assistant; ids are fixed uuids so assertions can name them. */
export const ASSISTANT_IDS = {
  thread: '0193b000-0000-7000-8000-000000000001',
  thread2: '0193b000-0000-7000-8000-000000000002',
  turn: '0193b000-0000-7000-8000-000000000101',
  userMessage: '0193b000-0000-7000-8000-000000000201',
  answer: '0193b000-0000-7000-8000-000000000202',
  event: '0193b000-0000-7000-8000-000000000203',
  proposal: '0193b000-0000-7000-8000-000000000301',
  batch: '0193b000-0000-7000-8000-000000000401',
  product: '0193b000-0000-7000-8000-000000000501',
} as const;

const STAMP = '2026-11-02T08:00:00.000Z';

export function threadFixture(over: Partial<AssistantThreadDto> = {}): AssistantThreadDto {
  return {
    id: ASSISTANT_IDS.thread,
    title: 'Mở trang sản phẩm',
    pinned: false,
    archived: false,
    businessId: null,
    lastMessageAt: STAMP,
    createdAt: STAMP,
    ...over,
  };
}

export function messageFixture(over: Partial<AssistantMessageDto> = {}): AssistantMessageDto {
  return {
    id: ASSISTANT_IDS.answer,
    seq: 2,
    role: 'assistant',
    content: 'Đây là trang sản phẩm.',
    uiActions: [],
    runId: ASSISTANT_IDS.turn,
    createdAt: STAMP,
    ...over,
  };
}

export function runFixture(over: Partial<AssistantRunDto> = {}): AssistantRunDto {
  return {
    id: ASSISTANT_IDS.turn,
    status: 'done',
    outcome: 'answered',
    rounds: 2,
    latencyMs: 1830,
    steps: [
      { idx: 0, kind: 'model_call', toolName: null, ok: true, ms: 900, errorCode: null },
      { idx: 1, kind: 'tool', toolName: 'ui_navigate', ok: true, ms: 12, errorCode: null },
    ],
    ...over,
  };
}

/** A whole turn's answer: the stored owner message, the assistant's reply and the run. */
export function turnFixture(
  text: string,
  answer: Partial<AssistantMessageDto> = {},
): SendAssistantMessageResponse {
  return {
    messages: [
      messageFixture({
        id: ASSISTANT_IDS.userMessage,
        seq: 1,
        role: 'user',
        content: text,
        runId: ASSISTANT_IDS.turn,
      }),
      messageFixture(answer),
    ],
    run: runFixture(),
  };
}

/** A pending proposal prepared by the turn above (created just before its answer). */
export function proposalFixture(over: Partial<AssistantProposalDto> = {}): AssistantProposalDto {
  return {
    id: ASSISTANT_IDS.proposal,
    threadId: ASSISTANT_IDS.thread,
    businessId: '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f',
    routeKey: 'PATCH /products/{productId}',
    summary: 'Đổi giá Áo thun thành 150.000đ',
    preview: { price: { from: 120000, to: 150000 } },
    status: 'pending',
    errorCode: null,
    createdAt: '2026-11-02T07:59:59.000Z',
    expiresAt: '2026-11-03T07:59:59.000Z',
    decidedAt: null,
    kind: 'route',
    importBatchId: null,
    ...over,
  };
}

/** The owner's memory: a profile entry, empty notes and one business store. */
export function memoryFixture(over: Partial<AssistantMemoryDto> = {}): AssistantMemoryDto {
  return {
    stores: [
      {
        store: 'owner_profile',
        label: 'owner_profile',
        limit: 1400,
        used: 26,
        entries: [{ id: 'e1', text: 'Thích trả lời ngắn gọn.', createdAt: STAMP }],
      },
      { store: 'notes', label: 'notes', limit: 2200, used: 0, entries: [] },
      {
        store: 'business:3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f',
        label: 'Shop An',
        limit: 1000,
        used: 30,
        entries: [{ id: 'e2', text: 'Giao hàng trong ngày ở Hà Nội.', createdAt: STAMP }],
      },
    ],
    ...over,
  };
}

/** One sheet draft (`r<row>`): a product with one variant, no problems. */
export function draftFixture(
  row: number,
  name: string,
  over: Partial<ImportDraftDto> = {},
): ImportDraftDto {
  const code = `SP-${row}`;
  return {
    key: `r${row}`,
    rows: [row],
    product: {
      code,
      name,
      description: '',
      category: null,
      visibleToBot: true,
      imageUrls: [],
      variants: [
        { sku: code, name: '', price: 150_000, cost: null, weightGram: null, stock: null },
      ],
    },
    problems: [],
    excluded: false,
    ...over,
  };
}

/** A sheet batch with two ready drafts and one draft missing its price. */
export function importBatchFixture(over: Partial<ImportBatchDto> = {}): ImportBatchDto {
  return {
    id: ASSISTANT_IDS.batch,
    threadId: ASSISTANT_IDS.thread,
    businessId: '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f',
    kind: 'sheet',
    fileName: 'hang.xlsx',
    status: 'ready',
    rowCount: 4,
    drafts: [
      draftFixture(1, 'Áo thun', {
        problems: [{ field: 'code', code: 'code_generated', severity: 'warning', row: 1 }],
      }),
      draftFixture(2, 'Quần jean', {
        problems: [{ field: 'price', code: 'missing_price', severity: 'error', row: 2 }],
      }),
      draftFixture(3, 'Mũ lưỡi trai'),
    ],
    results: {},
    draftsHash: 'abc',
    createdAt: STAMP,
    ...over,
  };
}

/** The pending import proposal of `importBatchFixture` (drafts r1 and r3). */
export function importProposalFixture(
  over: Partial<AssistantProposalDto> = {},
): AssistantProposalDto {
  return proposalFixture({
    kind: 'product_import',
    importBatchId: ASSISTANT_IDS.batch,
    routeKey: 'POST /products',
    summary: 'Nhập áo, mũ từ tệp của anh/chị',
    preview: {
      fileName: 'hang.xlsx',
      batchKind: 'sheet',
      draftKeys: ['r1', 'r3'],
      draftsHash: 'abc',
      counts: { products: 2, variants: 2, skippedWithErrors: 1, alreadyCreated: 0 },
      visibleToBotDefault: true,
    },
    ...over,
  });
}
