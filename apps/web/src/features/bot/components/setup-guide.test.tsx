import { screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import { renderWithRouter } from '@/testing/render';

import { SetupGuide } from './setup-guide';

beforeAll(async () => {
  await loadNamespace('training');
});

const profile = (done: boolean) => ({
  key: 'profile' as const,
  to: '/app/bots/$botId/knowledge' as const,
  done,
  emptyCount: 2,
});

describe('SetupGuide', () => {
  it('suggests the remaining details of a finished profile step instead of calling it unfilled (MS-30)', async () => {
    renderWithRouter(() => <SetupGuide botId="b1" steps={[profile(true)]} loading={false} />);
    expect(await screen.findByText(/Có thể điền thêm 2 thông tin/)).toBeVisible();
    expect(screen.queryByText('Còn 2 thông tin chưa điền')).toBeNull();
  });

  it('says what is still empty while the step is not done', async () => {
    renderWithRouter(() => <SetupGuide botId="b1" steps={[profile(false)]} loading={false} />);
    expect(await screen.findByText('Còn 2 thông tin chưa điền')).toBeVisible();
  });
});
