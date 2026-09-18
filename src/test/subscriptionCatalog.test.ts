import { describe, expect, it } from 'vitest';
import {
  SUBSCRIPTION_CATALOG,
  WALLET_METHODS,
  isCheckoutPlan,
  isWalletMethod,
} from '../../shared/subscriptionCatalog';

describe('Subscription checkout catalogue', () => {
  it('uses the advertised USD prices and exact annual saving', () => {
    expect(SUBSCRIPTION_CATALOG.monthly.usdPrice).toBe(10);
    expect(SUBSCRIPTION_CATALOG.yearly.usdPrice).toBe(96);
    expect(SUBSCRIPTION_CATALOG.yearly.savingsPercent).toBe(20);
    expect(SUBSCRIPTION_CATALOG.yearly.usdPrice).toBe(
      SUBSCRIPTION_CATALOG.monthly.usdPrice * 12 * 0.8,
    );
  });

  it('accepts only canonical paid plans and supported wallet methods', () => {
    expect(isCheckoutPlan('monthly')).toBe(true);
    expect(isCheckoutPlan('yearly')).toBe(true);
    expect(isCheckoutPlan('free')).toBe(false);
    expect(isCheckoutPlan('enterprise')).toBe(false);
    expect(WALLET_METHODS).toHaveLength(4);
    for (const method of WALLET_METHODS) {
      expect(isWalletMethod(method)).toBe(true);
    }
    expect(isWalletMethod('wire_transfer')).toBe(false);
  });
});
