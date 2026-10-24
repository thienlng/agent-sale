import type { TrainingItemDto } from '@agent-sales/contracts';

let seq = 0;

/** Minimal training item for unit tests. */
export function trainingItem(patch: Partial<TrainingItemDto>): TrainingItemDto {
  seq++;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    botId: '00000000-0000-4000-8000-ffffffffffff',
    kind: 'media',
    title: `item ${seq}`,
    content: `content ${seq}`,
    trigger: '',
    mediaUrl: null,
    folderId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
}
