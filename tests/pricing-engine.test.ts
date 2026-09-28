import { describe, expect, it } from '@jest/globals';
import { calculatePrice } from '@/lib/pricing/engine';
import type { PricingConfig, PricingInputs } from '@/lib/pricing/types';

const inputs: PricingInputs = { applicationDate: '2024-06-20', currentExpiryDate: '2024-05-31', ownerType: 'INDIVIDUAL', province: 'GP', municipality: 'JOHANNESBURG', vehicleType: 'MOTOR_CAR', vehicleClass: 'MOTOR_CAR', tareWeight: 1200, gvm: 1800, deliveryRequested: false, licenceExpiryDate: '2024-05-31' };
const config = (overrides: Partial<PricingConfig> = {}): PricingConfig => ({ version: 7, currency: 'ZAR', lookups: [], components: [{ code: 'LICENCE_FEE', name: 'Licence fee', kind: 'BASE', label: 'Licence fee', rules: [{ code: 'FIXED', name: 'Fixed fee', when: { op: 'always' }, amount: { type: 'fixed', amount: 500 }, priority: 1 }] }], ...overrides });

describe('pricing engine', () => {
  it('applies a configured fixed fee', () => { const result = calculatePrice(config(), inputs); expect(result.total).toBe(500); expect(result.version).toBe(7); });
  it('does not guess missing lookup amounts', () => { const result = calculatePrice(config({ components: [{ code: 'MISSING', name: 'Missing', kind: 'SERVICE', label: 'Missing', rules: [{ code: 'LOOKUP', name: 'Missing lookup', when: { op: 'always' }, amount: { type: 'lookup', table: 'NOT_SEEDED', keyPath: 'vehicleType' }, priority: 1, requiresReview: true }] }] }), inputs); expect(result.total).toBe(0); expect(result.warnings.length).toBeGreaterThan(0); });
});