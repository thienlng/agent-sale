import { FakeLlmProvider, type GenerateRequest } from '@agent-sales/ai-core';
import { describe, expect, it } from 'vitest';

import { LlmRuntime } from '../application/llm-runtime.js';
import { InMemoryLlmConfigRepository } from '../infrastructure/persistence/llm-config.in-memory-repository.js';
import { loadCases, parseCase } from '../evals/load.js';
import { buildReport, renderMarkdown, renderText } from '../evals/report.js';
import { fakeReplyText, fakeRuntime, runCase, runCaseFake } from '../evals/runner.js';

const cases = loadCases();

const MINIMAL = `
id: sample
group: g
bot: { profile: { fields: { warranty: "Bảo hành 6 tháng" }, notes: "" } }
conversation:
  - customer: "bảo hành bao lâu"
expect:
  outcome: answered
  contains_any: ["6 tháng"]
  fake_reply: { outcome: answer, reply: "Dạ bảo hành 6 tháng ạ.", sources: [] }
`;

describe('eval case format', () => {
  it('fills the bot defaults', () => {
    const c = parseCase(MINIMAL);
    expect(c.bot).toMatchObject({
      industry: 'retail',
      selfPronoun: 'em',
      customerPronoun: 'anh/chị',
      language: 'vi',
      replyLength: 'short',
      tone: 'friendly',
      modelTier: 'smart',
    });
    expect(c.tags).toEqual([]);
  });

  it('maps the outcome "unknown" to the pipeline name "fallback"', () => {
    const c = parseCase(MINIMAL.replace('outcome: answered', 'outcome: unknown'));
    expect(c.expect.outcome).toBe('fallback');
  });

  it('rejects unknown keys, a bot-last conversation and bad YAML, naming the file', () => {
    expect(() => parseCase(`${MINIMAL}\nextra: 1`, 'x.yaml')).toThrow(/x\.yaml/);
    expect(() =>
      parseCase(MINIMAL.replace('customer: "bảo hành bao lâu"', 'bot: "xin chào"'), 'y.yaml'),
    ).toThrow(/last turn/);
    expect(() => parseCase('id: [', 'z.yaml')).toThrow(/z\.yaml: invalid YAML/);
  });
});

describe('eval suite (fake mode)', () => {
  it('has unique ids, a critical tag on the unknown and injection cases, and at least 20 cases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    const critical = new Set(cases.filter((c) => c.tags.includes('critical')).map((c) => c.id));
    for (const id of [
      'retail-promotion-unknown',
      'hotel-deposit-unknown',
      'hotel-cancellation-unknown',
      'hotel-pets-unknown',
      'retail-injection-discount',
      'hotel-injection-from-notes',
    ])
      expect(critical.has(id), id).toBe(true);
  });

  it.each(cases.map((c) => [c.id, c] as const))('%s passes', async (_id, c) => {
    const result = await runCaseFake(c);
    expect(result.error).toBeNull();
    expect(
      result.checks.filter((x) => !x.pass),
      `reply: ${result.reply}`,
    ).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it('builds a report with groups and a passing critical gate', async () => {
    const results = await Promise.all(cases.map(runCaseFake));
    const report = buildReport('fake', results);
    expect(report.gate).toBe('pass');
    expect(report.promptVersion).toBe('sales-agent@9');
    expect(report.passed).toBe(report.total);
    expect(report.groups.map((g) => g.group)).toContain('safety');
    expect(renderText(report)).toContain('Critical:');
    expect(renderMarkdown(report)).toContain('| Group | Passed | Total |');
  });
});

describe('eval report gate', () => {
  it('fails the gate when a critical case fails; without critical cases it is not evaluated', async () => {
    const pass = await runCaseFake(parseCase(MINIMAL));
    const failing = { ...pass, id: 'bad', pass: false };
    expect(buildReport('fake', [pass, { ...failing, critical: true }]).gate).toBe('fail');
    const report = buildReport('fake', [pass, { ...failing, critical: false }]);
    expect(report.gate).toBe('none');
    expect(renderText(report)).toContain('No critical cases ran');
    expect(report.critical).toEqual({ passed: 0, total: 0 });
    expect(renderText(buildReport('fake', [{ ...failing, reply: 'x', critical: true }]))).toContain(
      'GATE FAILED',
    );
  });
});

describe('eval guardrail visibility', () => {
  it('guardrail: none fails a case the guardrail rescued, and the report shows the guardrail', async () => {
    const rescued = parseCase(
      MINIMAL.replace('Dạ bảo hành 6 tháng ạ.', 'Dạ bảo hành 6 tháng, giá 299k ạ.').replace(
        '  outcome: answered\n',
        '  guardrail: none\n',
      ),
    );
    const result = await runCaseFake(rescued);
    expect(result.pass).toBe(false);
    expect(result.checks.find((c) => c.name === 'guardrail')?.detail).toContain(
      'ungrounded_figure',
    );
  });

  it('shows a fired guardrail even when the case does not assert it', async () => {
    const result = await runCaseFake(
      parseCase(
        MINIMAL.replace('Dạ bảo hành 6 tháng ạ.', 'Dạ giá 299k ạ.').replace(
          '  outcome: answered\n  contains_any: ["6 tháng"]\n',
          '  outcome: fallback\n',
        ),
      ),
    );
    expect(result.pass).toBe(true);
    const report = buildReport('fake', [result]);
    expect(renderText(report)).toContain('guardrail fired: ungrounded_figure');
    expect(renderMarkdown(report)).toContain('PASS via guardrail: ungrounded_figure');
  });
});

describe('eval runner', () => {
  const sample = parseCase(MINIMAL);

  it('sends the case through the real prompt: profile block, customer text, prompt @9', async () => {
    const provider = new FakeLlmProvider('dev-fake', () => ({ text: fakeReplyText(sample) }));
    const llm = new LlmRuntime(new InMemoryLlmConfigRepository(), {
      create: () => provider,
      hermesLogin: () => {
        throw new Error('unused');
      },
      listModels: () => Promise.resolve({ models: [], state: 'unavailable' }),
      developmentFallback: () => ({ provider, model: 'eval-fake' }),
    });
    const result = await runCase(sample, llm);
    expect(result.pass).toBe(true);
    const sent = provider.calls[0] as GenerateRequest;
    expect(sent.messages.at(-1)?.content).toContain('<business_profile>');
    expect(sent.messages.at(-1)?.content).toContain('Bảo hành 6 tháng');
    expect(sent.messages.at(-1)?.content).toContain('<customer>\nbảo hành bao lâu\n</customer>');
  });

  it('fails a case whose reply breaks an expectation and reports the failed check', async () => {
    const wrong = parseCase(MINIMAL.replace('Dạ bảo hành 6 tháng ạ.', 'Dạ bảo hành một năm ạ.'));
    const result = await runCaseFake(wrong);
    expect(result.pass).toBe(false);
    expect(result.checks.filter((c) => !c.pass).map((c) => c.name)).toEqual(['contains_any']);
    expect(result.reply).toContain('một năm');
  });

  it('shows the guardrail when the pipeline replaces an ungrounded figure', async () => {
    const bad = parseCase(
      MINIMAL.replace('Dạ bảo hành 6 tháng ạ.', 'Dạ bảo hành 6 tháng, giá 299k ạ.'),
    );
    const result = await runCaseFake(bad);
    expect(result).toMatchObject({ outcome: 'fallback', pass: false });
    expect(result.guardrail).toContain('ungrounded_figure');
  });

  it('fails (not throws) when fake mode has no fake_reply or the model call errors', async () => {
    const noFake = parseCase(MINIMAL.replace(/ {2}fake_reply:.*\n/, ''));
    const missing = await runCaseFake(noFake);
    expect(missing).toMatchObject({ pass: false, error: expect.stringContaining('fake_reply') });

    const llm = fakeRuntime(() => {
      throw new Error('provider down');
    }, sample);
    const failed = await runCase(sample, llm);
    expect(failed).toMatchObject({ pass: false, error: expect.any(String) });
  });
});
