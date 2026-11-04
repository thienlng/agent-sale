import { redactSensitive } from '@agent-sales/ai-core';

import type { ProductDetails } from '../domain/product-view.js';
import { CONFIRM_TOOL, CANCEL_TOOL } from './action-tools.js';
import {
  CANCEL_HOLD_DRAFT_TOOL,
  CHECK_AVAILABILITY_TOOL,
  CONFIRM_HOLD_TOOL,
  PREPARE_HOLD_TOOL,
} from './hold-tools.js';
import { CANCEL_ORDER_DRAFT_TOOL, CONFIRM_ORDER_TOOL, PREPARE_ORDER_TOOL } from './order-tools.js';
import { HANDOFF_TOOL, SEND_MESSAGE_TOOL } from './output-tools.js';
import { LEGACY_SAAS_REQUEST_TOOL, REQUEST_TOOL } from './request-tools.js';

/**
 * Per-tool step details of a shop-bot turn trace (spec 2026-11-02-owner-assistant-5-design §4.2).
 * An allowlist: ids, counts, codes, booleans and redacted excerpts only, never raw arguments or
 * results, never a recipient's or guest's name, phone or address, never action arguments or data.
 * Pure. Lives in `application/` because it uses the ai-core redactor (domain/ may not import it).
 */

export const MAX_DETAIL_CHARS = 2_000;
export const MAX_ERROR_CODE_CHARS = 60;
const MAX_PRODUCT_IDS = 10;
const QUERY_MAX = 120;
const REASON_MAX = 200;
const ERROR_CODE = /^[A-Za-z0-9_.:-]{1,60}$/;
const DAY_MS = 86_400_000;

type Json = Record<string, unknown>;
export interface ToolDetail {
  detail: Json | null;
  errorCode: string | null;
}

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function parse(content: string): Json | null {
  try {
    const value: unknown = JSON.parse(content);
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

/** A short machine code, or `error` when the value is free text (never stored as is). */
export function safeErrorCode(value: unknown): string | null {
  const s = str(value);
  if (s === null || s === '') return null;
  return ERROR_CODE.test(s) ? s : 'error';
}

/** The tool's own error code: `errorCode` / `error` / `code` when the result failed or carries one. */
function errorCodeOf(result: Json | null): string | null {
  if (!result) return null;
  const explicit = safeErrorCode(result.errorCode) ?? safeErrorCode(result.error);
  if (explicit) return explicit;
  if (result.ok === false) {
    return (
      safeErrorCode(result.code) ?? (arr(result.problems).length ? 'invalid_request' : 'failed')
    );
  }
  return null;
}

const ids = (values: unknown[]): string[] =>
  values.flatMap((v) => (isObject(v) && typeof v.id === 'string' ? [v.id] : []));

function searchDetail(input: Json, result: Json | null): Json {
  const rows = arr(result?.rows).length ? arr(result?.rows) : arr(result?.index);
  const query = str(input.query);
  return {
    ...(query ? { query: redactSensitive(query, QUERY_MAX) } : {}),
    resultCount: result?.tooMany ? (num(result.total) ?? null) : rows.length,
    ...(result?.tooMany ? { tooMany: true } : {}),
    productIds: ids(rows).slice(0, MAX_PRODUCT_IDS),
  };
}

type MissingField = 'price' | 'stock' | 'description' | 'images' | 'variants';

/** The empty fields of one `product_details` product (accommodations have no price or stock). */
export function missingFields(p: Partial<ProductDetails>): MissingField[] {
  const out: MissingField[] = [];
  const variants = Array.isArray(p.variants) ? p.variants : null;
  const offering = p.catalogKind === 'course' || p.catalogKind === 'service';
  if (p.catalogKind !== 'accommodation') {
    // A course or a service may publish no price on purpose: its priceNote ("liên hệ") stands in.
    const priced =
      (p.fromVnd ?? 0) > 0 ||
      (variants ?? []).some((v) => (v.priceVnd ?? 0) > 0) ||
      (offering && !!str(p.priceNote)?.trim());
    if (!priced) out.push('price');
    // Courses and services have no stock.
    const soldOut =
      !offering &&
      (p.inStock === false ||
        (variants !== null &&
          variants.length > 0 &&
          variants.every((v) => (v.available ?? 0) === 0)));
    if (soldOut) out.push('stock');
  }
  if (!str(p.description)?.trim()) out.push('description');
  if (!Array.isArray(p.images) || p.images.length === 0) out.push('images');
  if (p.catalogKind !== 'accommodation' && variants !== null && variants.length === 0)
    out.push('variants');
  return out;
}

function detailsDetail(input: Json, result: Json | null): Json {
  const products = arr(result?.products).filter(isObject) as Partial<ProductDetails>[];
  const asked = arr(input.ids).filter((v): v is string => typeof v === 'string');
  const missing = products.flatMap((p) => {
    const fields = missingFields(p);
    return fields.length && typeof p.id === 'string' ? [{ productId: p.id, fields }] : [];
  });
  return {
    productIds: (products.length ? ids(products) : asked).slice(0, MAX_PRODUCT_IDS),
    missing,
    ...(arr(result?.notFound).length ? { notFound: arr(result?.notFound).length } : {}),
  };
}

function nights(input: Json): number | null {
  const from = Date.parse(str(input.checkIn) ?? '');
  const to = Date.parse(str(input.checkOut) ?? '');
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / DAY_MS);
}

const isActionTool = (name: string): boolean =>
  name.startsWith('action_') || name === CONFIRM_TOOL || name === CANCEL_TOOL;

/**
 * The allowlisted detail of one tool call and its error code. `actionIdOf` maps an action tool
 * name (or the confirm tool) to its action id. Unknown tools get no detail.
 */
export function toolDetail(
  name: string,
  input: unknown,
  resultContent: string,
  actionIdOf: (name: string) => string | null = () => null,
): ToolDetail {
  const result = parse(resultContent);
  const args = isObject(input) ? input : {};
  const errorCode = errorCodeOf(result);
  const withError = (d: Json): Json => (errorCode ? { ...d, errorCode } : d);
  let detail: Json | null;
  switch (name) {
    case 'search_products':
      detail = result ? searchDetail(args, result) : null;
      break;
    case 'product_details':
      detail = result ? detailsDetail(args, result) : null;
      break;
    case 'calculate':
      detail = result ? withError({ ok: errorCode === null }) : null;
      break;
    case SEND_MESSAGE_TOOL:
      detail = result
        ? {
            chars: str(args.text)?.length ?? 0,
            imageCount: arr(args.imageIds).length,
            droppedImages: arr(result.droppedImageIds).length,
            delivered: result.status === 'sent',
          }
        : null;
      break;
    case HANDOFF_TOOL: {
      const reason = str(args.reason);
      detail = reason ? { reason: redactSensitive(reason, REASON_MAX) } : {};
      break;
    }
    case PREPARE_ORDER_TOOL:
    case CONFIRM_ORDER_TOOL:
    case CANCEL_ORDER_DRAFT_TOOL:
      detail = withError(name === PREPARE_ORDER_TOOL ? { itemCount: arr(args.items).length } : {});
      break;
    case CHECK_AVAILABILITY_TOOL:
    case PREPARE_HOLD_TOOL:
    case CONFIRM_HOLD_TOOL:
    case CANCEL_HOLD_DRAFT_TOOL: {
      const stay =
        name === CHECK_AVAILABILITY_TOOL || name === PREPARE_HOLD_TOOL
          ? { nights: nights(args), adults: num(args.adults) }
          : {};
      const options = name === CHECK_AVAILABILITY_TOOL ? arr(result?.options).length : null;
      detail = withError({ ...stay, ...(options !== null ? { resultCount: options } : {}) });
      break;
    }
    case REQUEST_TOOL: {
      const kind = str(args.kind);
      detail = withError({
        ...(kind && /^[a-z_]{1,30}$/.test(kind) ? { kind } : {}),
        ...(typeof result?.updated === 'boolean' ? { updated: result.updated } : {}),
      });
      break;
    }
    // Traces written before the saas tool became record_request (30-day retention).
    case LEGACY_SAAS_REQUEST_TOOL:
      detail = withError({});
      break;
    default:
      detail = isActionTool(name)
        ? withError({
            actionId: actionIdOf(name),
            statusCode: num(result?.statusCode),
            ...(result?.status === 'awaiting_customer_confirmation'
              ? { confirmRequired: true }
              : {}),
          })
        : null;
  }
  return { detail: detail ? capDetail(detail) : null, errorCode };
}

/** Keeps the serialized detail ≤ 2 000 chars by dropping list tails, never by cutting JSON. */
export function capDetail(detail: Json): Json | null {
  const fits = (d: Json) => JSON.stringify(d).length <= MAX_DETAIL_CHARS;
  if (fits(detail)) return detail;
  const out: Json = { ...detail, truncated: true };
  for (const key of ['productIds', 'missing']) {
    let list = arr(out[key]);
    while (list.length && !fits(out)) {
      list = list.slice(0, -1);
      out[key] = list;
    }
  }
  return fits(out) ? out : { truncated: true };
}
