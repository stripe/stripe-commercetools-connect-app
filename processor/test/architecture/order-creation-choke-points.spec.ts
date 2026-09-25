import { describe, expect, test } from '@jest/globals';
import fs from 'fs';
import path from 'path';

/**
 * Every place this connector can create a commercetools order must be declared here, together with
 * what stops it creating one worth more than was collected.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * Three times in a row, the same protection was added to one order-creating path and not to its
 * sibling, and each time the gap was found from outside:
 *
 *   2026-03  the amount comparison is written on the one-time path — and only logged
 *   2026-08  it becomes a hard guard (KI-050 / ADR-016) — still only the one-time path
 *   2026-09  external report: the subscription path had never had it (KI-054)
 *
 * Nothing was careless about any of those changes. What was missing is that no one was ever forced to
 * enumerate the other paths. This test is that enumeration, made mechanical: when a new call site
 * appears it fails until someone writes down which guard covers it, and when a declared one disappears
 * it fails so the registry cannot rot into fiction.
 *
 * It deliberately does NOT try to verify that the guard is correct — a regex cannot do that, and
 * pretending otherwise would be worse than not trying. It enforces the one thing a machine can:
 * that no order-creating path exists without someone having answered the question.
 *
 * WHEN THIS TEST FAILS
 * --------------------
 * Do not "fix" it by adding the new entry with an empty `guard`. The entry is a claim you are making,
 * and the reviewer reads it. If the answer is that the path has no guard, say so and say why, as
 * `handleSubscriptionPaymentCreateNewOrder` does below.
 */

/** Call shapes that end in `createOrderFromCart`, the single commercetools order-creation primitive. */
const ORDER_CREATION_CALLS = [
  /(?<![\w.])createOrderFromCart\s*\(/, // the primitive itself
  /\.createOrder\s*\(/, // StripePaymentService.createOrder, which wraps it
];

/** Files that define the primitive rather than reaching it. */
const DEFINITION_SITES = ['src/services/commerce-tools/order-client.ts'];

interface ChokePoint {
  /** Path relative to `processor/`. */
  file: string;
  /** Enclosing function — stable across edits in a way line numbers are not. */
  fn: string;
  /** What the path is for, in one line. */
  what: string;
  /** What stops it minting an order worth more than was collected. */
  guard: string;
}

const REGISTRY: ChokePoint[] = [
  {
    file: 'src/services/stripe-payment.service.ts',
    fn: 'createOrder',
    what: 'The single wrapper every path goes through; calls the commercetools primitive.',
    guard:
      'None of its own, by design — it is the funnel, not a decision point. Each caller below is ' +
      'responsible, and the version pin it accepts is what lets a caller bind its decision to an ' +
      'exact cart snapshot.',
  },
  {
    file: 'src/services/stripe-payment.service.ts',
    fn: 'createOrderPinned',
    what:
      'One-time payments: the `payment_intent.succeeded` webhook. The decisions are taken in ' +
      'handlePaymentIntentSucceededFlow, which delegates the write to this helper — so this is where ' +
      'the call site lives and therefore what the registry tracks.',
    guard:
      'Amount guard against the current cart total, then a second check that the total did not move ' +
      'across updateCartAddress, then the order is created pinned to the validated cart version, with ' +
      'one retry on ConcurrentModification that re-reads and re-decides. ' +
      'business-rules/payment-confirmation.md Rules 5 and 5b; ADR-016, ADR-019.',
  },
  {
    file: 'src/services/stripe-subscription.service.ts',
    fn: 'createSubscriptionOrderFromCart',
    what: 'Subscription first cycle: `invoice.paid` and the pending-charge path.',
    guard:
      'Cart-drift guard against the total sealed onto the Stripe Subscription at creation (no ' +
      'exemptions), then the first-cycle amount guard against invoice.amount_paid (scoped — see the ' +
      'rule for which billing shapes are exempt and why). payment-confirmation.md Rules 6 and 7; ' +
      'ADR-017 and its addendum.',
  },
  {
    file: 'src/services/stripe-subscription.service.ts',
    fn: 'handleSubscriptionPaymentCreateNewOrder',
    what: 'Recurring cycles: clones a cart from the original order and orders against the new invoice.',
    guard:
      'No amount guard, DELIBERATELY — see ADR-017 point 4, which exempts recurring cycles and gives ' +
      'the reason: the cart is cloned from the original order and its total diverges from the ' +
      'recurring invoice by design (a $225 cloned cart against a $75 invoice), so the comparison the ' +
      'other two paths make would break normal operation on any multi-quantity or mixed cart. The ' +
      'exemption is a decision that was taken, not an omission. Residual this registry does add: the ' +
      'cart is re-read into `latestCart` immediately before the order is created, and nothing binds ' +
      'that read to the order, so a concurrent write inside that window is undetected. Much narrower ' +
      'than the reported defect — the cart is connector-built rather than shopper-held — and open.',
  },
];

/** Reads every .ts under src/, skipping nothing — a path that creates orders from an odd place still counts. */
const sourceFiles = (dir: string, acc: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, acc);
    else if (entry.name.endsWith('.ts')) acc.push(full);
  }
  return acc;
};

/** The nearest preceding method or function declaration — the stable identity for a call site. */
const enclosingFunction = (lines: string[], index: number): string => {
  const declaration =
    /^\s{0,4}(?:export\s+)?(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:async\s+)?([a-zA-Z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/;
  const arrowConst = /^\s*(?:export\s+)?const\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:async\s*)?\(/;
  for (let i = index; i >= 0; i--) {
    const line = lines[i];
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    const m = declaration.exec(line) ?? arrowConst.exec(line);
    if (m && !['if', 'for', 'while', 'switch', 'catch', 'return', 'await'].includes(m[1])) return m[1];
  }
  return '<file scope>';
};

const isNoise = (line: string): boolean =>
  /^\s*(\/\/|\*|\/\*)/.test(line) || /^\s*import\s/.test(line) || /^\s*\}?\s*from\s+'/.test(line);

const discovered = (): { file: string; fn: string }[] => {
  const root = path.resolve(__dirname, '../..');
  const found: { file: string; fn: string }[] = [];

  for (const absolute of sourceFiles(path.join(root, 'src'))) {
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    const lines = fs.readFileSync(absolute, 'utf8').split('\n');

    lines.forEach((line, i) => {
      if (isNoise(line)) return;
      if (!ORDER_CREATION_CALLS.some((re) => re.test(line))) return;
      const fn = enclosingFunction(lines, i);
      // Skip the primitive's own definition — it is the thing being called, not a path reaching it.
      if (DEFINITION_SITES.includes(relative) && fn === 'createOrderFromCart') return;
      if (!found.some((f) => f.file === relative && f.fn === fn)) found.push({ file: relative, fn });
    });
  }
  return found;
};

const key = (c: { file: string; fn: string }) => `${c.file}::${c.fn}`;

describe('Order-creation choke points are all declared', () => {
  // Jest has no per-assertion message, so each problem is phrased as the line a reader needs and the
  // assertion compares the whole list to empty — the guidance then shows up in the failure diff.
  test('every path that can create a commercetools order is in the registry', () => {
    const problems = discovered()
      .filter((c) => !REGISTRY.some((r) => key(r) === key(c)))
      .map(
        (c) =>
          `UNDECLARED ${key(c)} — add it to REGISTRY in this file, stating what stops it creating an ` +
          `order worth more than was collected. If the answer is "nothing", say that and say why: an ` +
          `honest gap is reviewable, a blank guard is not.`,
      );

    expect(problems).toEqual([]);
  });

  test('every registered path still exists', () => {
    const live = discovered().map(key);
    const problems = REGISTRY.map(key)
      .filter((k) => !live.includes(k))
      .map(
        (k) =>
          `STALE ${k} — the registry claims a path that no longer exists. Remove it. A registry ` +
          `describing code that is gone reads as coverage and is worse than no registry.`,
      );

    expect(problems).toEqual([]);
  });

  test('no registered path is left with an empty guard', () => {
    const problems = REGISTRY.filter((r) => r.guard.trim().length < 40).map(
      (r) => `BLANK ${key(r)} — the \`guard\` field has no real answer in it.`,
    );

    expect(problems).toEqual([]);
  });

  // The test above cannot tell a real guard from a plausible sentence, so this one pins the two paths
  // whose guards were written in response to an external report. If either stops naming its control,
  // that is worth a failing build even though the prose could still read fine.
  test('the two reported paths still name their controls', () => {
    const subscription = REGISTRY.find((r) => r.fn === 'createSubscriptionOrderFromCart');
    const oneTime = REGISTRY.find((r) => r.fn === 'createOrderPinned');

    expect(subscription?.guard).toMatch(/drift/i);
    expect(subscription?.guard).toMatch(/amount_paid/);
    expect(oneTime?.guard).toMatch(/pinned/i);
    expect(oneTime?.guard).toMatch(/did not move/i);
  });
});
