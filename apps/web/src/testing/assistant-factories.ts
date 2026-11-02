import type {
  AssistantMessageDto,
  AssistantRunDto,
  AssistantThreadDto,
  SendAssistantMessageResponse,
} from '@agent-sales/contracts';

/** Test data for the owner assistant; ids are fixed uuids so assertions can name them. */
export const ASSISTANT_IDS = {
  thread: '0193b000-0000-7000-8000-000000000001',
  thread2: '0193b000-0000-7000-8000-000000000002',
  turn: '0193b000-0000-7000-8000-000000000101',
  userMessage: '0193b000-0000-7000-8000-000000000201',
  answer: '0193b000-0000-7000-8000-000000000202',
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
