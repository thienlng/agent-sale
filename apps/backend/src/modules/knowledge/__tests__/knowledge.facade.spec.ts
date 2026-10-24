import { newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import { KnowledgeFacadeImpl } from '../application/knowledge.facade.impl.js';
import { FaqNotFoundError, InvalidFaqError } from '../domain/knowledge.errors.js';
import { InMemoryKnowledgeUnitOfWork } from '../infrastructure/knowledge.unit-of-work.js';

const ws = workspaceId(newId());
const bot = newId();

function facade() {
  return new KnowledgeFacadeImpl(new InMemoryKnowledgeUnitOfWork());
}

describe('KnowledgeFacade (contract)', () => {
  it('creates, edits, lists and deletes FAQs of one bot', async () => {
    const f = facade();
    const created = await f.createFaq(ws, bot, {
      question: 'Shop mở cửa mấy giờ?',
      answer: '8h–21h hằng ngày',
    });
    await f.updateFaq(ws, bot, created.id, { answer: '8h–22h hằng ngày' });
    expect((await f.listFaqs(ws, bot)).map((x) => x.answer)).toEqual(['8h–22h hằng ngày']);
    expect(await f.listFaqs(ws, newId())).toEqual([]);
    await f.deleteFaq(ws, bot, created.id);
    await expect(f.deleteFaq(ws, bot, created.id)).rejects.toBeInstanceOf(FaqNotFoundError);
  });

  it('validates question and answer length', async () => {
    await expect(
      facade().createFaq(ws, bot, { question: 'Hi', answer: 'x' }),
    ).rejects.toBeInstanceOf(InvalidFaqError);
  });

  it('finds the right FAQ for an unaccented, abbreviated customer message', async () => {
    const f = facade();
    await f.seedFaqs(ws, bot, [
      { question: 'Cửa hàng ở đâu?', answer: 'Địa chỉ: 12 Lê Lợi, Quận 1' },
      { question: 'Phí vận chuyển bao nhiêu?', answer: 'Đồng giá 30.000đ toàn quốc' },
      { question: 'Có được đổi trả không?', answer: 'Đổi trong 7 ngày nếu còn tem' },
    ]);
    const hits = await f.searchFaqs(ws, bot, 'phi van chuyen bn shop');
    expect(hits[0]?.question).toBe('Phí vận chuyển bao nhiêu?');
    const where = await f.searchFaqs(ws, bot, 'cua hang o dau vay');
    expect(where[0]?.question).toBe('Cửa hàng ở đâu?');
  });

  it('returns nothing for unrelated messages instead of weak matches', async () => {
    const f = facade();
    await f.seedFaqs(ws, bot, [{ question: 'Cửa hàng ở đâu?', answer: 'Địa chỉ: 12 Lê Lợi' }]);
    expect(await f.searchFaqs(ws, bot, 'xyz qwk')).toEqual([]);
  });
});
