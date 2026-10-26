import type { SecretBox } from '../../../common/security/secret-box.js';
import type { ActionOutcome } from '../api/action.facade.js';
import { buildRequest, type ActionArgs } from '../domain/build-request.js';
import type { SafeHttpRequest, SafeHttpResult } from '../domain/safe-http.js';
import { trimResponse } from '../domain/trim-response.js';
import type { ActionRecord } from './ports/action-unit-of-work.js';

export type SafeHttp = (req: SafeHttpRequest) => Promise<SafeHttpResult>;

export interface RunResult {
  outcome: ActionOutcome;
  latencyMs: number;
}

/**
 * Runs one stored action: validates and places the arguments, calls the hardened HTTP client,
 * and trims the response to the declared fields of the matching status code. Holds no state
 * and touches no database; errors are categories only (never URLs, secrets or bodies).
 */
export class ActionRunner {
  constructor(
    private readonly safeHttp: SafeHttp,
    private readonly secrets: SecretBox,
    private readonly clock: () => number = Date.now,
  ) {}

  async run(action: ActionRecord, args: ActionArgs, idempotencyKey: string): Promise<RunResult> {
    const started = this.clock();
    const done = (outcome: ActionOutcome): RunResult => ({
      outcome,
      latencyMs: Math.max(0, Math.round(this.clock() - started)),
    });

    let secret: string | null = null;
    if (action.authSecretEnc) {
      try {
        secret = this.secrets.open(action.authSecretEnc);
      } catch {
        return done({ ok: false, errorCode: 'network' });
      }
    }
    const built = buildRequest(action, args, secret, idempotencyKey);
    if (!built.ok) return done({ ok: false, errorCode: built.errorCode });

    let result: SafeHttpResult;
    try {
      result = await this.safeHttp(built.request);
    } catch {
      return done({ ok: false, errorCode: 'network' });
    }
    if (!result.ok) {
      return done({
        ok: false,
        errorCode: result.errorCode,
        ...(result.status !== undefined && { statusCode: result.status }),
      });
    }
    const declared = action.responses.find((r) => r.statusCode === result.status);
    if (!declared) return done({ ok: false, errorCode: 'bad_status', statusCode: result.status });
    return done({
      ok: true,
      statusCode: result.status,
      data: trimResponse(result.json, declared.fields),
    });
  }
}
