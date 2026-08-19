import { describe, expect, test } from '@jest/globals';
import { EU_BANK_TRANSFER_COUNTRIES, getBankTransferOptions } from '../../src/mappers/bank-transfer-mapper';

/**
 * Every assertion in this file was measured against the Stripe API on 2026-08-05 before it was
 * written, not derived from the documentation.
 *
 * These tests describe a mapper that DECLINES to act in most cases, which is the opposite of the
 * contract it had earlier the same day. The reason is one of those measurements: a PaymentIntent with
 * automatic_payment_methods, a customer and NO customer_balance options resolves the bank transfer
 * variant from the currency by itself — usd to us_bank_transfer with aba and swift addresses, eur to
 * eu_bank_transfer with a real IE IBAN — and confirms into complete funding instructions.
 *
 * So "send nothing" is a working configuration, and the mapper's only remaining job is the one thing
 * Stripe cannot guess: which country's IBAN a EUR shopper should be shown.
 */
describe('bank-transfer-mapper', () => {
  describe('getBankTransferOptions', () => {
    test('returns undefined for EUR with no configured country, letting Stripe default to IE', () => {
      // Previously this threw. Stripe defaults EUR to an Irish IBAN and the payment completes, so
      // throwing was refusing a checkout that would have worked.
      expect(getBankTransferOptions({ currencyCode: 'eur' })).toBeUndefined();
    });

    test('returns undefined for USD, because Stripe derives us_bank_transfer from the currency', () => {
      expect(getBankTransferOptions({ currencyCode: 'usd' })).toBeUndefined();
    });

    test('returns undefined for USD even when a EUR country is configured for the market', () => {
      // A store-key rule can match carts in several currencies. Sending eu_bank_transfer on a USD
      // PaymentIntent would be rejected by Stripe, so the EUR-only setting is simply not applied.
      expect(getBankTransferOptions({ currencyCode: 'usd', euBankTransferCountry: 'DE' })).toBeUndefined();
    });

    test('leaves an unsupported currency untouched instead of blocking it', () => {
      // GBP/JPY/MXN bank transfers exist for GB/JP/MX-based Stripe accounts. An earlier allow-list
      // rejected them on the strength of a US-account measurement, blaming Stripe for our own limit.
      expect(getBankTransferOptions({ currencyCode: 'gbp', euBankTransferCountry: 'DE' })).toBeUndefined();
      expect(getBankTransferOptions({ currencyCode: 'jpy' })).toBeUndefined();
    });

    test('maps EUR with a configured country to eu_bank_transfer, carrying that country', () => {
      expect(getBankTransferOptions({ currencyCode: 'eur', euBankTransferCountry: 'DE' })).toEqual({
        funding_type: 'bank_transfer',
        bank_transfer: { type: 'eu_bank_transfer', eu_bank_transfer: { country: 'DE' } },
      });
    });

    test.each(EU_BANK_TRANSFER_COUNTRIES)('accepts %s as an IBAN country', (country) => {
      const options = getBankTransferOptions({ currencyCode: 'eur', euBankTransferCountry: country });
      expect(options?.bank_transfer?.eu_bank_transfer?.country).toBe(country);
    });

    test('is case-insensitive on the currency, because the cart carries an uppercase code', () => {
      expect(getBankTransferOptions({ currencyCode: 'EUR', euBankTransferCountry: 'NL' })).toEqual(
        getBankTransferOptions({ currencyCode: 'eur', euBankTransferCountry: 'NL' }),
      );
    });

    test('never emits funding_type without a bank_transfer.type — Stripe rejects the pair split', () => {
      const options = getBankTransferOptions({ currencyCode: 'eur', euBankTransferCountry: 'FR' });
      expect(options?.funding_type).toBe('bank_transfer');
      expect(options?.bank_transfer?.type).toBeDefined();
    });

    test('does not set requested_address_types — Stripe returns all valid types for the variant', () => {
      const options = getBankTransferOptions({ currencyCode: 'eur', euBankTransferCountry: 'IE' });
      expect(options?.bank_transfer).not.toHaveProperty('requested_address_types');
    });

    test('exposes the country list so config validation cannot drift from the mapper', () => {
      expect(EU_BANK_TRANSFER_COUNTRIES).toEqual(['DE', 'FR', 'IE', 'NL']);
    });
  });
});
