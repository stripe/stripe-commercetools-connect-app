import Stripe from 'stripe';

/**
 * Countries Stripe accepts inside `eu_bank_transfer.country`.
 *
 * Measured against the API on 2026-08-05, not read from the documentation: an invalid value is
 * rejected with "The country provided (US) is not supported for `eu_bank_transfer` details.
 * `eu_bank_transfer` details can be provided with the following countries: DE, FR, IE, or NL."
 *
 * Stripe's own TypeScript declares this field as a plain `string`
 * (Stripe.PaymentIntentCreateParams.PaymentMethodOptions.CustomerBalance.BankTransfer.EuBankTransfer),
 * so this union is the only thing standing between a typo in merchant config and a 400 at the till.
 * config.ts validates `euBankTransferCountry` against this same array — one array for both, for the
 * same reason RULE_FLOW_TYPES is shared between the rule field and the env var: duplicating the list
 * is how the two drift apart.
 *
 * These four are an IBAN-LOCALIZATION list, not a list of markets that can pay. Stripe accepts EUR
 * bank transfers for accounts in 34 countries; a merchant in ES or IT can take them perfectly well,
 * they simply have to show the shopper a DE, FR, IE or NL IBAN. SEPA is a single payment area, so any
 * eurozone shopper can wire to any of the four.
 */
export const EU_BANK_TRANSFER_COUNTRIES = ['DE', 'FR', 'IE', 'NL'] as const;

export type EuBankTransferCountry = (typeof EU_BANK_TRANSFER_COUNTRIES)[number];

/**
 * Builds `payment_method_options.customer_balance` for a EUR cart whose market has a configured IBAN
 * country. Returns `undefined` for every other cart, which means "send nothing and let Stripe decide".
 *
 * WHY SENDING NOTHING IS THE DEFAULT, having previously been treated as a broken state.
 * Measured on 2026-08-05 against a PaymentIntent with automatic_payment_methods, a customer and no
 * customer_balance options at all: Stripe resolves the variant from the CURRENCY on its own, and the
 * confirm returns complete, usable funding instructions.
 *   - usd -> us_bank_transfer, with aba and swift addresses
 *   - eur -> eu_bank_transfer, country IE, a real IBAN and BIC
 * So the whole rail works with no configuration. An earlier design sent explicit options for every
 * eligible cart, which forced a `euBankTransferCountry` to become mandatory for EUR (stating
 * `bank_transfer.type` makes the nested country required) and made an unconfigured EUR cart throw.
 * That obligation was self-inflicted: it existed only because we were sending the options in the first
 * place.
 *
 * WHAT THIS IS FOR, then. Exactly one thing: overriding Stripe's IE default when the merchant wants the
 * shopper to see an IBAN in a specific country — normally their own, to avoid cross-border transfer
 * fees for the buyer and to look like a local business. It is a treasury preference, never a technical
 * requirement.
 *
 * NO CURRENCY ALLOW-LIST, deliberately, and this reverses a previous restriction. A prior version
 * refused any currency outside eur/usd, on a measurement taken on a US test account. That measurement
 * was real but its scope was misread: Stripe also offers gbp, jpy and mxn bank transfers to accounts
 * based in GB, JP and MX, and the US account simply had no such capability. Since this function now
 * declines to interfere with anything but EUR, a GB merchant's GBP cart reaches Stripe untouched and
 * gets gb_bank_transfer — which the old allow-list would have blocked with a 400 that blamed Stripe for
 * our own restriction.
 *
 * @param currencyCode - The cart's currency. Case-insensitive: commercetools carries 'USD'.
 * @param euBankTransferCountry - Merchant-configured IBAN country, if this market has one.
 * @returns The customer_balance options, or undefined to leave the PaymentIntent alone.
 */
export const getBankTransferOptions = ({
  currencyCode,
  euBankTransferCountry,
}: {
  currencyCode: string;
  euBankTransferCountry?: EuBankTransferCountry;
}): Stripe.PaymentIntentCreateParams.PaymentMethodOptions.CustomerBalance | undefined => {
  if (!euBankTransferCountry || currencyCode.toLowerCase() !== 'eur') {
    return undefined;
  }

  // funding_type and bank_transfer.type are an atomic pair: sending funding_type alone is a 400,
  // "the payment_method_options[customer_balance][bank_transfer][type] parameter is required".
  //
  // `requested_address_types` is deliberately not set: Stripe returns all valid types for the variant,
  // which is what the storefront's funding-instructions UI needs, and narrowing it is a merchant
  // display preference with no consumer here yet.
  return {
    funding_type: 'bank_transfer',
    bank_transfer: { type: 'eu_bank_transfer', eu_bank_transfer: { country: euBankTransferCountry } },
  };
};
