import { describe, expect, test } from '@jest/globals';
import { Cart } from '@commercetools/connect-payments-sdk';
import {
  extractCountry,
  extractDiscriminator,
  extractTrustedDiscriminator,
  resolvePaymentBehavior,
  resolveTrustedPaymentBehavior,
  PaymentBehaviorConfig,
} from '../../src/services/payment-behavior-resolver';
import {
  mockGetCartWithCountry,
  mockGetCartWithBillingCountryOnly,
  mockGetCartWithShippingCountryOnly,
  mockGetCartWithStoreKey,
  mockGetCartResult,
} from '../utils/mock-cart-data';

describe('payment-behavior-resolver', () => {
  describe('extractCountry', () => {
    test('cart.country wins over billingAddress.country', () => {
      expect(extractCountry(mockGetCartWithCountry('MX'))).toBe('MX');
    });

    test('falls back to billingAddress.country when cart.country is absent', () => {
      expect(extractCountry(mockGetCartWithBillingCountryOnly('CA'))).toBe('CA');
    });

    test('returns undefined when only shippingAddress.country is present', () => {
      // DIVERGENCE FROM CHECKOUT — the whole point of extractCountry existing separately.
      // A shipping fallback would let the shopper pick their own behavior rule (the express
      // shippingaddresschange handler writes the shopper's address to the CT cart), and later
      // pick the country of the bank account they are told to wire to.
      expect(extractCountry(mockGetCartWithShippingCountryOnly('BR'))).toBeUndefined();
    });

    test('never returns a store key', () => {
      expect(extractCountry(mockGetCartWithStoreKey('store-mx'))).toBeUndefined();
    });
  });

  describe('extractDiscriminator', () => {
    test('cart.country wins when all other fields are also present', () => {
      expect(extractDiscriminator(mockGetCartWithCountry('MX'))).toBe('MX');
    });

    test('falls back to billingAddress.country when cart.country is absent', () => {
      expect(extractDiscriminator(mockGetCartWithBillingCountryOnly('CA'))).toBe('CA');
    });

    test('does NOT fall back to shippingAddress.country', () => {
      // checkout resolves 'BR' here. This connector deliberately does not.
      expect(extractDiscriminator(mockGetCartWithShippingCountryOnly('BR'))).toBeUndefined();
    });

    test('falls back to store.key when no usable country field is present', () => {
      expect(extractDiscriminator(mockGetCartWithStoreKey('store-mx'))).toBe('store-mx');
    });

    test('store.key is reached even when a shippingAddress country exists', () => {
      const cart: Cart = {
        ...mockGetCartWithShippingCountryOnly('BR'),
        store: { typeId: 'store', key: 'store-br' },
      } as Cart;
      expect(extractDiscriminator(cart)).toBe('store-br');
    });

    test('returns undefined when no discriminator can be derived', () => {
      const cart: Cart = {
        ...mockGetCartResult(),
        country: undefined,
        billingAddress: undefined,
        shippingAddress: undefined,
      };
      expect(extractDiscriminator(cart)).toBeUndefined();
    });

    test('the default mock cart resolves no discriminator (it has only a shippingAddress)', () => {
      // Guards the release gate: every pre-existing test uses this cart, so no rule can ever
      // match it by accident and shift the pinned PaymentIntent params.
      expect(extractDiscriminator(mockGetCartResult())).toBeUndefined();
    });
  });

  describe('resolvePaymentBehavior', () => {
    test('returns matching rule on exact cart.country key match', () => {
      const config: PaymentBehaviorConfig = { MX: { captureMethod: 'manual' } };
      expect(resolvePaymentBehavior(config, mockGetCartWithCountry('MX'))).toEqual({
        captureMethod: 'manual',
      });
    });

    test('returns undefined when config has a key but cart country does not match', () => {
      const config: PaymentBehaviorConfig = { MX: { captureMethod: 'manual' } };
      expect(resolvePaymentBehavior(config, mockGetCartWithCountry('DE'))).toBeUndefined();
    });

    test('returns undefined for an empty config map', () => {
      expect(resolvePaymentBehavior({}, mockGetCartWithCountry('MX'))).toBeUndefined();
    });

    test('returns undefined when config is undefined', () => {
      expect(resolvePaymentBehavior(undefined, mockGetCartWithCountry('MX'))).toBeUndefined();
    });

    test('there is no wildcard key', () => {
      const config: PaymentBehaviorConfig = { '*': { captureMethod: 'manual' } };
      expect(resolvePaymentBehavior(config, mockGetCartWithCountry('MX'))).toBeUndefined();
    });

    test('returns a partial rule containing only the supplied fields', () => {
      const config: PaymentBehaviorConfig = { MX: { captureMethod: 'manual' } };
      const result = resolvePaymentBehavior(config, mockGetCartWithCountry('MX'));
      expect(result).toBeDefined();
      expect(result!.captureMethod).toBe('manual');
      expect(result!.setupFutureUsage).toBeUndefined();
      expect(result!.euBankTransferCountry).toBeUndefined();
    });

    test('resolves rule via store.key when no usable country field is present', () => {
      const config: PaymentBehaviorConfig = { 'store-ca': { setupFutureUsage: '' } };
      expect(resolvePaymentBehavior(config, mockGetCartWithStoreKey('store-ca'))).toEqual({
        setupFutureUsage: '',
      });
    });

    test('resolves rule via billingAddress.country when cart.country is absent', () => {
      const config: PaymentBehaviorConfig = { CA: { captureMethod: 'automatic' } };
      expect(resolvePaymentBehavior(config, mockGetCartWithBillingCountryOnly('CA'))).toEqual({
        captureMethod: 'automatic',
      });
    });

    test('does NOT resolve a rule from shippingAddress.country', () => {
      const config: PaymentBehaviorConfig = { BR: { captureMethod: 'automatic' } };
      expect(resolvePaymentBehavior(config, mockGetCartWithShippingCountryOnly('BR'))).toBeUndefined();
    });

    test('carries a bank-transfer market rule through unchanged', () => {
      // The shape a merchant writes to offer bank transfer in one market: an explicit capture method
      // plus, optionally, the IBAN country. There is no enable flag — see PaymentBehaviorRule.
      const config: PaymentBehaviorConfig = {
        DE: { captureMethod: 'automatic', euBankTransferCountry: 'DE', setupFutureUsage: '' },
      };
      expect(resolvePaymentBehavior(config, mockGetCartWithCountry('DE'))).toEqual({
        captureMethod: 'automatic',
        euBankTransferCountry: 'DE',
        setupFutureUsage: '',
      });
    });
  });

  // KI-046: flowType drives applyPiFirstOverride, which discards setup_future_usage from the
  // PaymentIntent. So it must not be selectable through a shopper-typed billing country.
  describe('extractTrustedDiscriminator', () => {
    test('uses cart.country when present', () => {
      expect(extractTrustedDiscriminator(mockGetCartWithCountry('MX'))).toBe('MX');
    });

    test('does NOT fall back to billingAddress.country — the shopper-reachable source', () => {
      const cart = mockGetCartWithBillingCountryOnly('DE');
      expect(extractDiscriminator(cart)).toBe('DE');
      expect(extractTrustedDiscriminator(cart)).toBeUndefined();
    });

    test('does NOT fall back to shippingAddress.country either', () => {
      expect(extractTrustedDiscriminator(mockGetCartWithShippingCountryOnly('DE'))).toBeUndefined();
    });

    test('falls back to store.key — chosen by the storefront, not typed by the shopper', () => {
      expect(extractTrustedDiscriminator(mockGetCartWithStoreKey('store-mx'))).toBe('store-mx');
    });

    test('undefined when the cart carries no trusted discriminator', () => {
      expect(extractTrustedDiscriminator(mockGetCartResult() as Cart)).toBeUndefined();
    });
  });

  describe('resolveTrustedPaymentBehavior', () => {
    const config: PaymentBehaviorConfig = { DE: { flowType: 'pi_first' }, MX: { captureMethod: 'manual' } };

    test('matches on cart.country, same as the untrusted resolver', () => {
      expect(resolveTrustedPaymentBehavior(config, mockGetCartWithCountry('DE'))).toEqual({ flowType: 'pi_first' });
    });

    test('a billing-country-only cart matches the untrusted resolver but NOT this one', () => {
      const cart = mockGetCartWithBillingCountryOnly('DE');
      expect(resolvePaymentBehavior(config, cart)).toEqual({ flowType: 'pi_first' });
      expect(resolveTrustedPaymentBehavior(config, cart)).toBeUndefined();
    });

    test('matches on store key', () => {
      const storeConfig: PaymentBehaviorConfig = { 'store-mx': { flowType: 'pi_first' } };
      expect(resolveTrustedPaymentBehavior(storeConfig, mockGetCartWithStoreKey('store-mx'))).toEqual({
        flowType: 'pi_first',
      });
    });

    test('undefined when the rules map is absent or empty', () => {
      expect(resolveTrustedPaymentBehavior(undefined, mockGetCartWithCountry('DE'))).toBeUndefined();
      expect(resolveTrustedPaymentBehavior({}, mockGetCartWithCountry('DE'))).toBeUndefined();
    });
  });
});
