export const METADATA_CART_ID_FIELD: string = 'cart_id';
export const METADATA_SUBSCRIPTION_ID_FIELD: string = 'subscription_id';
export const METADATA_PROJECT_KEY_FIELD: string = 'ct_project_key';
export const METADATA_PAYMENT_ID_FIELD: string = 'ct_payment_id';
export const METADATA_CUSTOMER_ID_FIELD: string = 'ct_customer_id';
export const METADATA_PRODUCT_ID_FIELD: string = 'ct_product_id';
export const METADATA_VARIANT_SKU_FIELD: string = 'ct_variant_sku';
export const METADATA_PRICE_ID_FIELD: string = 'ct_price_id';
export const METADATA_ORDER_ID_FIELD: string = 'ct_order_id';
export const METADATA_SHIPPING_PRICE_AMOUNT: string = 'ct_shipping_price_amount';
/** Cart total (minor units) and currency sealed onto the Stripe Subscription when it is created.
 *  Stripe-owned from that moment on, so the shopper cannot alter them while mutating their cart.
 *  Read back by the subscription amount guard to detect a cart that moved after pricing. */
export const METADATA_CART_TOTAL_AMOUNT: string = 'ct_cart_total_amount';
export const METADATA_CART_TOTAL_CURRENCY: string = 'ct_cart_total_currency';
/** Written onto a Stripe Subscription whose paid first cycle was blocked from becoming an order (ADR-027):
 *  why it was blocked, and which invoice. Cleared by hand when the case is resolved (the runbook). */
export const METADATA_ORDER_BLOCKED_REASON: string = 'ct_order_blocked';
export const METADATA_ORDER_BLOCKED_INVOICE: string = 'ct_order_blocked_invoice';
/** The commercetools Payment `paymentStatus.interfaceCode` for the same case — queryable with
 *  `paymentStatus(interfaceCode = "subscription_order_blocked")`. */
export const PAYMENT_STATUS_SUBSCRIPTION_ORDER_BLOCKED: string = 'subscription_order_blocked';

// Tax calculation metadata fields
export const CT_CUSTOM_FIELD_TAX_CALCULATIONS: string = 'connectorStripeTax_calculationReferences';
