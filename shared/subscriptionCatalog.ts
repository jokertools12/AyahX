/**
 * Checkout values shown in the UI and enforced by the API.
 * Wallet checkout is settled in EGP; USD values are the public plan prices.
 */
export const SUBSCRIPTION_CATALOG = {
  monthly: {
    id: 'monthly',
    name: 'شهري',
    usdPrice: 10,
    walletAmountEgp: 500,
    billingPeriod: 'month',
  },
  yearly: {
    id: 'yearly',
    name: 'سنوي',
    usdPrice: 96,
    walletAmountEgp: 4800,
    billingPeriod: 'year',
    savingsPercent: 20,
  },
} as const;

export type CheckoutPlan = keyof typeof SUBSCRIPTION_CATALOG;

export const WALLET_METHODS = [
  'vodafone_cash',
  'etisalat_cash',
  'orange_cash',
  'we_pay',
] as const;

export type WalletMethod = (typeof WALLET_METHODS)[number];

export function isCheckoutPlan(value: unknown): value is CheckoutPlan {
  return typeof value === 'string' && value in SUBSCRIPTION_CATALOG;
}

export function isWalletMethod(value: unknown): value is WalletMethod {
  return typeof value === 'string' && (WALLET_METHODS as readonly string[]).includes(value);
}
