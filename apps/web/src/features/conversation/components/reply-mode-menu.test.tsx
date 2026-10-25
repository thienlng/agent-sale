import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReplyModeMenu } from './reply-mode-menu';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && Object.keys(options).length ? `${key} ${Object.values(options).join(' ')}` : key,
  }),
}));

const P = 'channelInbox.v2.header.replyMode.';
type Props = Partial<React.ComponentProps<typeof ReplyModeMenu>>;
function renderMenu(props: Props = {}) {
  const onChange = vi.fn();
  render(
    <ReplyModeMenu
      mode="bot"
      autoResumeAt={null}
      botAvailable
      takeoverMinutes={5}
      disabled={false}
      onChange={onChange}
      {...props}
    />,
  );
  return onChange;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('reply mode menu', () => {
  it('shows the current state on the button', () => {
    renderMenu();
    expect(screen.getByRole('button', { name: `${P}label: ${P}bot` })).toBeInTheDocument();
  });

  it('shows a permanent takeover as "bot off"', () => {
    renderMenu({ mode: 'human', autoResumeAt: null });
    expect(screen.getByRole('button', { name: `${P}label: ${P}human` })).toBeInTheDocument();
  });

  it('counts down to the bot resuming during a temporary takeover', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime('2026-10-25T10:00:00.000Z');
    renderMenu({ mode: 'human', autoResumeAt: '2026-10-25T10:04:12.000Z' });
    expect(
      screen.getByRole('button', { name: `${P}label: ${P}takeover 4:12` }),
    ).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(12000);
    });
    expect(
      screen.getByRole('button', { name: `${P}label: ${P}takeover 4:00` }),
    ).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(300000);
    });
    expect(screen.getByRole('button', { name: `${P}label: ${P}human` })).toBeInTheDocument();
  });

  it('lists all three options with a one-line explanation, using the bot takeover minutes', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole('button'));
    const options = await screen.findAllByRole('menuitemradio');
    expect(options.map((o) => o.textContent)).toEqual([
      `${P}optionBot${P}optionBotHint`,
      `${P}optionTemp${P}optionTempHint 5`,
      `${P}optionPermanent${P}optionPermanentHint`,
    ]);
    expect(options[0]).toHaveAttribute('aria-checked', 'true');
  });

  it('switches between bot and a person', async () => {
    const user = userEvent.setup();
    const onChange = renderMenu({ mode: 'human' });
    await user.click(screen.getByRole('button'));
    await user.click(
      await screen.findByRole('menuitemradio', {
        name: new RegExp(`${P}optionBot$|${P}optionBot${P}`),
      }),
    );
    expect(onChange).toHaveBeenCalledWith('bot');
  });

  it('takes over from the bot', async () => {
    const user = userEvent.setup();
    const onChange = renderMenu();
    await user.click(screen.getByRole('button'));
    await user.click(
      await screen.findByRole('menuitemradio', { name: new RegExp(`${P}optionPermanent`) }),
    );
    expect(onChange).toHaveBeenCalledWith('human');
  });

  it('disables the bot options with a reason when the channel has no active bot', async () => {
    const user = userEvent.setup();
    const onChange = renderMenu({ mode: 'human', botAvailable: false });
    await user.click(screen.getByRole('button'));
    const options = await screen.findAllByRole('menuitemradio');
    expect(options[0]).toHaveAttribute('aria-disabled', 'true');
    expect(options[1]).toHaveAttribute('aria-disabled', 'true');
    expect(options[2]).not.toHaveAttribute('aria-disabled');
    expect(options[0]).toHaveTextContent(`${P}noBot`);
    await user.click(options[0] as HTMLElement);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is locked while a change is saving', () => {
    renderMenu({ disabled: true });
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
