import { Link } from '@tanstack/react-router';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { collectPageContext, fillAssistantForm } from '@/lib/assistant-context';
import { renderWithRouter, stubFetch } from '@/testing/render';

import { PersonalityCard } from './personality-card';

const can = vi.hoisted(() => ({ value: true }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
vi.mock('@/lib/permissions', () => ({ useCan: () => can.value }));
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});
beforeEach(() => {
  can.value = true;
});
afterEach(() => vi.unstubAllGlobals());

const BOT = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a00';

function bot(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: BOT,
    name: 'Bot',
    industry: 'retail',
    isActive: true,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    settings: {
      mission: 'Tư vấn bán hàng',
      greeting: 'Xin chào',
      selfPronoun: 'em',
      customerPronoun: 'anh/chị',
      replyLength: 'short',
      tone: 'friendly',
      allowEmoji: false,
      useCustomerName: true,
      fallbackMessage: 'x',
      handoffMessage: 'x',
      creativity: 'balanced',
      modelTier: 'smart',
      language: 'vi',
      placeholders: {},
      profile: { fields: {}, notes: '' },
      ...over,
    },
  };
}

async function setup(initial = bot()) {
  const stub = stubFetch({
    [`GET /bots/${BOT}`]: { status: 200, body: initial },
    [`PATCH /bots/${BOT}`]: { status: 200, body: initial },
  });
  vi.stubGlobal('fetch', stub.fetchStub);
  renderWithRouter(() => (
    <>
      <PersonalityCard botId={BOT} />
      <Link to="/app/bots">go-away</Link>
    </>
  ));
  await screen.findByLabelText('Nhiệm vụ của bot', undefined, { timeout: 10_000 });
  return stub;
}

describe('PersonalityCard', () => {
  it('shows the saved values and disables saving until something changes', async () => {
    await setup();
    expect(screen.getByLabelText('Nhiệm vụ của bot')).toHaveValue('Tư vấn bán hàng');
    expect(screen.getByLabelText('Bot xưng là')).toHaveValue('em');
    expect(screen.getByLabelText('Gọi khách là')).toHaveValue('anh/chị');
    expect(screen.getByRole('radio', { name: 'Ngắn gọn' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Thân thiện' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Cho phép emoji' })).not.toBeChecked();
    expect(screen.getByLabelText('Lời chào')).toHaveValue('Xin chào');
    expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toBeDisabled();
  });

  it('saves only the changed keys in one PATCH', async () => {
    const stub = await setup();
    await userEvent.clear(screen.getByLabelText('Bot xưng là'));
    await userEvent.type(screen.getByLabelText('Bot xưng là'), 'mình');
    await userEvent.click(screen.getByRole('radio', { name: 'Chi tiết' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Lịch sự trang trọng' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Cho phép emoji' }));
    await userEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(stub.calls.some((c) => c.key.startsWith('PATCH'))).toBe(true));
    expect(stub.calls.find((c) => c.key === `PATCH /bots/${BOT}`)?.body).toEqual({
      settings: { selfPronoun: 'mình', replyLength: 'detailed', tone: 'formal', allowEmoji: true },
    });
  }, 30_000);

  it('limits the mission to 4000, the greeting to 1000 and the pronouns to 20 characters', async () => {
    await setup();
    expect(screen.getByLabelText('Nhiệm vụ của bot')).toHaveAttribute('maxlength', '4000');
    expect(screen.getByLabelText('Lời chào')).toHaveAttribute('maxlength', '1000');
    expect(screen.getByLabelText('Bot xưng là')).toHaveAttribute('maxlength', '20');
    expect(screen.getByLabelText('Gọi khách là')).toHaveAttribute('maxlength', '20');
  });

  it('offers common pronouns as suggestions', async () => {
    await setup();
    const list = (label: string) =>
      [
        ...document.querySelectorAll(
          `#${screen.getByLabelText(label).getAttribute('list')} option`,
        ),
      ].map((o) => o.getAttribute('value'));
    expect(list('Bot xưng là')).toEqual(['em', 'mình', 'shop']);
    expect(list('Gọi khách là')).toEqual(['anh/chị', 'bạn', 'quý khách']);
  });

  it('is read-only without the bots.manage capability', async () => {
    can.value = false;
    await setup();
    expect(screen.getByLabelText('Nhiệm vụ của bot')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Lưu thay đổi' })).not.toBeInTheDocument();
  });

  it('asks before leaving with unsaved edits', async () => {
    await setup();
    await userEvent.type(screen.getByLabelText('Lời chào'), '!');
    await userEvent.click(screen.getByText('go-away'));
    expect(await screen.findByText('Rời trang sẽ mất các thay đổi chưa lưu.')).toBeInTheDocument();
  });

  describe('owner assistant', () => {
    const form = () =>
      collectPageContext('/app/bots/b/instructions').forms?.find((f) => f.id === 'bot-personality');

    it('offers the reply guidance with its choices and the current text of filled fields', async () => {
      await setup(bot({ greeting: '' }));
      expect(form()?.fields).toEqual([
        {
          name: 'mission',
          label: 'Nhiệm vụ của bot',
          type: 'textarea',
          empty: false,
          value: 'Tư vấn bán hàng',
        },
        { name: 'greeting', label: 'Lời chào', type: 'textarea', empty: true },
        { name: 'selfPronoun', label: 'Bot xưng là', type: 'text', empty: false, value: 'em' },
        {
          name: 'customerPronoun',
          label: 'Gọi khách là',
          type: 'text',
          empty: false,
          value: 'anh/chị',
        },
        {
          name: 'replyLength',
          label: 'Độ dài câu trả lời',
          type: 'select',
          options: ['veryShort', 'short', 'detailed'],
          empty: false,
        },
        {
          name: 'tone',
          label: 'Giọng điệu',
          type: 'select',
          options: ['friendly', 'formal'],
          empty: false,
        },
        {
          name: 'allowEmoji',
          label: 'Cho phép emoji',
          type: 'select',
          options: ['yes', 'no'],
          empty: false,
        },
      ]);
    });

    it('fills the draft, turning "yes" into the emoji switch, and does not save', async () => {
      const stub = await setup();
      act(() => {
        fillAssistantForm('bot-personality', {
          greeting: 'Chào anh/chị, em có thể giúp gì ạ?',
          selfPronoun: 'em bé quá dài để làm đại từ xưng hô',
          tone: 'formal',
          replyLength: 'novel',
          allowEmoji: 'yes',
        });
      });
      expect(screen.getByLabelText('Lời chào')).toHaveValue('Chào anh/chị, em có thể giúp gì ạ?');
      expect(screen.getByLabelText('Bot xưng là')).toHaveValue('em bé quá dài để làm');
      expect(screen.getByRole('radio', { name: 'Lịch sự trang trọng' })).toBeChecked();
      expect(screen.getByRole('radio', { name: 'Ngắn gọn' })).toBeChecked();
      expect(screen.getByRole('switch', { name: 'Cho phép emoji' })).toBeChecked();
      expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toHaveAttribute(
        'data-assistant-target',
        'bot-personality.save',
      );
      expect(stub.calls.some((c) => c.key.startsWith('PATCH'))).toBe(false);
    });

    it('registers nothing for a read-only member', async () => {
      can.value = false;
      await setup();
      expect(form()).toBeUndefined();
    });
  });
});
