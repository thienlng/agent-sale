import type { ToolDefinition } from '@agent-sales/ai-core';
import {
  all,
  type BigNumber,
  type ConstantNode,
  create,
  type FunctionNode,
  type MathNode,
  type OperatorNode,
  type ParenthesisNode,
} from 'mathjs';
import { z } from 'zod';

import type { RunnableTool } from './tool-runner.js';

export const MAX_EXPRESSION_CHARS = 300;
const MAX_EXPONENT = 15;
const MAX_RESULT = 1e15;

export type CalculateResult =
  { value: string; formatted: string } | { error: 'invalid_expression' | 'out_of_range' };

/**
 * A dedicated mathjs instance in exact BigNumber mode, locked down with the documented mathjs
 * security pattern: `parse` is kept privately, then every function that could reach code,
 * the scope or the instance itself is replaced by one that throws.
 */
if (!all) throw new Error('mathjs factories are missing');
const math = create(all, { number: 'BigNumber', precision: 64 });
const parse = math.parse;
const disabled = (name: string) => () => {
  throw new Error(`Function ${name} is disabled`);
};
math.import(
  Object.fromEntries(
    [
      'import',
      'createUnit',
      'evaluate',
      'parse',
      'compile',
      'simplify',
      'derivative',
      'resolve',
      'reviver',
      'matrix',
      'sparse',
      'index',
      'unit',
      'splitUnit',
      'range',
    ].map((name) => [name, disabled(name)]),
  ),
  { override: true },
);

const FUNCTIONS = new Set(['round', 'floor', 'ceil', 'abs', 'min', 'max', 'sum']);
// `divide` also covers the postfix percent (`10%` parses as `10 / 100`); binary `%` (mod) is not allowed.
const OPERATORS = new Set([
  'add',
  'subtract',
  'multiply',
  'divide',
  'pow',
  'unaryMinus',
  'unaryPlus',
]);

class OutOfRange extends Error {}

/** Only numbers, the allowed operators, parentheses and the whitelisted functions may appear. */
function checkNode(node: MathNode): void {
  switch (node.type) {
    case 'ConstantNode': {
      // The postfix percent's implicit `100` is a plain number; strings and booleans are refused.
      const { value } = node as ConstantNode;
      if (!math.isBigNumber(value) && !math.isNumber(value)) throw new Error('not a number');
      return;
    }
    case 'ParenthesisNode':
      checkNode((node as ParenthesisNode).content);
      return;
    case 'OperatorNode': {
      const op = node as OperatorNode;
      if (!OPERATORS.has(op.fn)) throw new Error('operator not allowed');
      op.args.forEach(checkNode);
      const [, exponentNode] = op.args;
      if (op.fn === 'pow' && exponentNode) {
        const exponent = math.bignumber(exponentNode.evaluate() as BigNumber);
        if (exponent.abs().gt(MAX_EXPONENT)) throw new OutOfRange();
      }
      return;
    }
    case 'FunctionNode': {
      const fn = node as FunctionNode;
      if (!math.isSymbolNode(fn.fn) || !FUNCTIONS.has(fn.fn.name)) {
        throw new Error('function not allowed');
      }
      fn.args.forEach(checkNode);
      return;
    }
    default:
      throw new Error('node not allowed');
  }
}

/** Whether the character at `at` sits directly inside a function call's parentheses. */
function isInsideCall(text: string, at: number): boolean {
  let depth = 0;
  for (let i = at - 1; i >= 0; i--) {
    const c = text[i];
    if (c === ')') depth++;
    else if (c === '(') {
      if (depth === 0) return /[A-Za-z_]\s*$/.test(text.slice(0, i));
      depth--;
    }
  }
  return false;
}

/**
 * Vietnamese-formatted input to mathjs syntax: thousands dots and spaces inside numbers are
 * dropped (`1.760.000` → `1760000`), a decimal comma becomes a dot (outside function arguments)
 * and `x` / `×` become `*`.
 */
export function normalizeExpression(input: string): string {
  let text = input
    .replace(/(?<![\d.])[1-9]\d{0,2}(?:\.\d{3})+(?![\d.])/g, (n) => n.replaceAll('.', ''))
    .replace(/(?<=\d) (?=\d{3}(?!\d))/g, '')
    .replace(/×|(?<![A-Za-z_])x(?![A-Za-z_])/g, '*');
  text = text.replace(/(?<=\d),(?=\d)/g, (comma, offset: number) =>
    isInsideCall(text, offset) ? comma : '.',
  );
  return text;
}

/** vi-VN grouping (`1.234.567,89`); a non-integer is rounded to at most 2 decimals for display. */
function formatVi(value: BigNumber): string {
  const fixed = value.toDecimalPlaces(2).toFixed();
  const negative = fixed.startsWith('-');
  const [int = '', frac] = (negative ? fixed.slice(1) : fixed).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${grouped}${frac ? `,${frac}` : ''}`;
}

/** Evaluates an arithmetic expression exactly; never throws. */
export function calculate(expression: string): CalculateResult {
  if (expression.length > MAX_EXPRESSION_CHARS) return { error: 'invalid_expression' };
  let result: unknown;
  try {
    const node = parse(normalizeExpression(expression));
    checkNode(node);
    result = node.evaluate();
  } catch (e) {
    return { error: e instanceof OutOfRange ? 'out_of_range' : 'invalid_expression' };
  }
  if (!math.isBigNumber(result)) return { error: 'invalid_expression' };
  if (!result.isFinite() || result.abs().gt(MAX_RESULT)) return { error: 'out_of_range' };
  const value = result.isZero() ? math.bignumber(0) : result;
  return { value: value.toFixed(), formatted: formatVi(value) };
}

const CalculateInput = z.object({
  expression: z.string().max(MAX_EXPRESSION_CHARS),
});

export const CALCULATE_TOOL: ToolDefinition = {
  name: 'calculate',
  description:
    'Exact calculator. Use it for every total, discount, deposit, change and quantity you state; never compute in your head. Supports numbers, + - * / ^, postfix % (e.g. 2220000 * 10%), parentheses, round(x, digits), floor, ceil, abs, min, max, sum. Returns { value, formatted }; quote `formatted` to the customer.',
  input: CalculateInput,
};

export const calculateTool: RunnableTool = {
  name: CALCULATE_TOOL.name,
  readOnly: true,
  schema: CalculateInput,
  run: (input) => {
    const parsed = CalculateInput.safeParse(input);
    const result: CalculateResult = parsed.success
      ? calculate(parsed.data.expression)
      : { error: 'invalid_expression' };
    return Promise.resolve({ content: JSON.stringify(result), ok: !('error' in result) });
  },
};
