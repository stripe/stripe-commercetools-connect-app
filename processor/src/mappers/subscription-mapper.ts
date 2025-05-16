import Stripe from 'stripe';
import { SubscriptionAttributes } from '../services/types/stripe-subscription.type';
import { convertDateToUnixTimestamp, parseTimeString, transformVariantAttributes } from '../utils';
import { Attribute } from '@commercetools/platform-sdk';

export const getSubscriptionAttributes = (productAttributes?: Attribute[]): Stripe.SubscriptionCreateParams => {
  const {
    collection_method,
    days_until_due,
    billing_cycle_anchor_date,
    billing_cycle_anchor_day,
    billing_cycle_anchor_time,
    trial_end_date,
    trial_period_days,
    cancel_at,
    cancel_at_period_end,
    description,
    off_session,
    proration_behavior,
    missing_payment_method_at_trial_end,
  } = transformVariantAttributes<SubscriptionAttributes>(productAttributes);
  const daysUntilDue = collection_method === 'send_invoice' ? (days_until_due ?? 1) : undefined;
  const trialSettings = getTrialSettings({ trial_period_days, trial_end_date, missing_payment_method_at_trial_end });
  const billingAnchor = getBillingAnchor({
    billing_cycle_anchor_date,
    billing_cycle_anchor_day,
    billing_cycle_anchor_time,
  });
  const cancelAt = getCancelAt({ cancel_at_period_end, cancel_at });

  return {
    description,
    off_session,
    collection_method,
    proration_behavior: proration_behavior ?? 'create_prorations',
    days_until_due: daysUntilDue,
    ...billingAnchor,
    ...trialSettings,
    ...cancelAt,
  } as Stripe.SubscriptionCreateParams;
};

export const getBillingAnchor = ({
  billing_cycle_anchor_date,
  billing_cycle_anchor_day,
  billing_cycle_anchor_time,
}: {
  billing_cycle_anchor_date?: string;
  billing_cycle_anchor_day?: number;
  billing_cycle_anchor_time?: string;
}): Partial<Stripe.SubscriptionCreateParams | undefined> => {
  if (billing_cycle_anchor_day && billing_cycle_anchor_time) {
    const { hour, minute, second } = parseTimeString(billing_cycle_anchor_time);
    return {
      billing_cycle_anchor_config: {
        day_of_month: billing_cycle_anchor_day,
        hour,
        minute,
        second,
      },
    };
  }
  if (billing_cycle_anchor_day) {
    return {
      billing_cycle_anchor_config: {
        day_of_month: billing_cycle_anchor_day,
      },
    };
  }
  if (billing_cycle_anchor_date) {
    return {
      billing_cycle_anchor: convertDateToUnixTimestamp(billing_cycle_anchor_date),
    };
  }
  return undefined;
};

export const getTrialSettings = ({
  trial_end_date,
  trial_period_days,
  missing_payment_method_at_trial_end,
}: {
  trial_period_days?: number;
  trial_end_date?: string;
  missing_payment_method_at_trial_end?: Stripe.SubscriptionCreateParams.TrialSettings.EndBehavior.MissingPaymentMethod;
}): Partial<Stripe.SubscriptionCreateParams | undefined> => {
  const settings = missing_payment_method_at_trial_end
    ? {
        trial_settings: {
          end_behavior: { missing_payment_method: missing_payment_method_at_trial_end },
        },
      }
    : null;

  if (trial_period_days) {
    return { trial_period_days, ...settings };
  }
  if (trial_end_date) {
    return { trial_end: convertDateToUnixTimestamp(trial_end_date), ...settings };
  }
  return undefined;
};

export const getCancelAt = ({
  cancel_at_period_end,
  cancel_at,
}: {
  cancel_at_period_end?: boolean;
  cancel_at?: string;
}) => {
  if (cancel_at_period_end) {
    return { cancel_at_period_end };
  }
  if (cancel_at) {
    return { cancel_at: convertDateToUnixTimestamp(cancel_at) };
  }
  return undefined;
};
