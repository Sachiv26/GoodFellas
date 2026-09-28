import { describe, expect, it } from '@jest/globals';
import { calculatePrice } from '@/lib/pricing/engine';
import type { PricingConfig, PricingInputs, PricingLookupEntryConfig } from '@/lib/pricing/types';
import { createApplicationSchema, VEHICLE_CLASSES, tareFeeFieldFor } from '@/lib/validation';

/** Entry list mirroring the seeded TARE_LICENCE_FEES table (one row per class). */
const entries: PricingLookupEntryConfig[] = [
  { key: 'MOTOR_CAR::1000-1250', label: 'MOTOR_CAR 1000kg - 1250kg', minValue: 1000, maxValue: 1250, amount: 528 },
  { key: 'RIGID_VEHICLE::1000-1250', label: 'RIGID_VEHICLE 1000kg - 1250kg', minValue: 1000, maxValue: 1250, amount: 1332 },
  { key: 'BREAKDOWN_VEHICLE::1000-1250', label: 'BREAKDOWN_VEHICLE 1000kg - 1250kg', minValue: 1000, maxValue: 1250, amount: 240 },
  { key: 'TRACTOR::1000-1250', label: 'TRACTOR 1000kg - 1250kg', minValue: 1000, maxValue: 1250, amount: 600 },
  { key: 'TRAILER::1000-1250', label: 'TRAILER 1000kg - 1250kg', minValue: 1000, maxValue: 1250, amount: 600 },
];

const config: PricingConfig = {
  version: 1,
  currency: 'ZAR',
  lookups: [{ code: 'TARE_LICENCE_FEES', name: 'TARE licence fees', entries }],
  components: [
    {
      code: 'LICENCE_FEE',
      name: 'Licence disc fee',
      kind: 'BASE',
      label: 'Licence disc fee',
      rules: [
        {
          code: 'TARE',
          name: 'TARE licence fee by tare weight and vehicle class',
          when: { op: 'always' },
          amount: { type: 'lookupRange', table: 'TARE_LICENCE_FEES', rangePath: 'vehicle.tareWeight', scopePath: 'vehicle.vehicleClass' },
          priority: 1,
        },
      ],
    },
  ],
};

function inputsFor(vehicleClass: string): PricingInputs {
  return { applicationDate: '2024-06-20', currentExpiryDate: '2024-05-31', ownerType: 'INDIVIDUAL', province: 'GP', municipality: 'JOHANNESBURG', vehicleType: 'MOTOR_CAR', vehicleClass, tareWeight: 1200, gvm: 1800, deliveryRequested: false };
}

describe('vehicle class licence fee selection', () => {
  it('prices each class from its own TARE fee column', () => {
    const expected: Record<string, number> = { MOTOR_CAR: 528, RIGID_VEHICLE: 1332, BREAKDOWN_VEHICLE: 240, TRACTOR: 600, TRAILER: 600 };
    for (const [vehicleClass, total] of Object.entries(expected)) {
      const result = calculatePrice(config, inputsFor(vehicleClass));
      expect(result.total).toBe(total);
      expect(result.warnings).toEqual([]);
    }
  });

  it('does not fall back to another class when the selection is unknown', () => {
    const result = calculatePrice(config, inputsFor('HELICOPTER'));
    expect(result.total).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('warns instead of guessing when no class was selected', () => {
    const result = calculatePrice(config, inputsFor(''));
    expect(result.total).toBe(0);
  });
});

describe('tare weight drives every calculation', () => {
  const tareRule = {
    code: 'TARE',
    name: 'TARE licence fee by tare weight and vehicle class',
    when: { op: 'always' as const },
    amount: {
      type: 'lookupRange' as const,
      table: 'TARE_LICENCE_FEES',
      rangePath: 'vehicle.tareWeight',
      scopePath: 'vehicle.vehicleClass',
    },
    priority: 1,
  };

  // Brackets 750-1000 (456) and 1000-1250 (528) for the motor car, so a
  // 1055 vs 1890 reading lands in different brackets with different fees.
  const tareTable: PricingConfig['lookups'] = [
    {
      code: 'TARE_LICENCE_FEES',
      name: 'TARE licence fees',
      entries: [
        { key: 'MOTOR_CAR::750-1000', label: '750-1000', minValue: 750, maxValue: 1000, amount: 456 },
        { key: 'MOTOR_CAR::1000-1250', label: '1000-1250', minValue: 1000, maxValue: 1250, amount: 528 },
        { key: 'MOTOR_CAR::1750-2000', label: '1750-2000', minValue: 1750, maxValue: 2000, amount: 1104 },
      ],
    },
  ];
  const tareConfig: PricingConfig = {
    version: 1,
    currency: 'ZAR',
    lookups: tareTable,
    components: [{ code: 'LICENCE_FEE', name: 'Licence disc fee', kind: 'BASE', label: 'Licence disc fee', rules: [tareRule] }],
  };

  const base: PricingInputs = {
    applicationDate: '2024-06-20',
    currentExpiryDate: '2024-05-31',
    ownerType: 'INDIVIDUAL',
    province: 'GP',
    municipality: 'JOHANNESBURG',
    vehicleType: 'MOTOR_CAR',
    vehicleClass: 'MOTOR_CAR',
    tareWeight: 1055,
    gvm: null,
    deliveryRequested: false,
  };

  it('prices on the Tare/Tarra value, not GVM', () => {
    // GVM 1890 is present but must not influence the fee: 1055 -> 1000-1250.
    const result = calculatePrice(tareConfig, { ...base, gvm: 1890 });
    expect(result.total).toBe(528);
  });

  it('does not fall back to GVM when tare is missing', () => {
    const result = calculatePrice(tareConfig, { ...base, tareWeight: null, gvm: 1890 });
    expect(result.total).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('changes the fee when the tare reading changes', () => {
    // The bug this guards: a misread that swapped tare and GVM (1890 for 1055)
    // silently moved the customer into a different, more expensive bracket.
    expect(calculatePrice(tareConfig, base).total).toBe(528);
    expect(calculatePrice(tareConfig, { ...base, tareWeight: 1890 }).total).toBe(1104);
  });
});

describe('vehicle class option list', () => {
  it('maps each option to a real TARE fee column', () => {
    expect(VEHICLE_CLASSES.map((c) => c.value)).toEqual(['MOTOR_CAR', 'RIGID_VEHICLE', 'BREAKDOWN_VEHICLE', 'TRACTOR', 'TRAILER']);
    for (const option of VEHICLE_CLASSES) {
      expect(tareFeeFieldFor(option.value)).toBe(option.tareFeeField);
    }
  });

  it('returns null for an unknown class', () => {
    expect(tareFeeFieldFor('HELICOPTER')).toBeNull();
    expect(tareFeeFieldFor(null)).toBeNull();
  });
});

describe('createApplicationSchema vehicleClass', () => {
  it('defaults to MOTOR_CAR when the customer does not choose', () => {
    const parsed = createApplicationSchema.parse({ productSlug: 'licence-disc', ownerType: 'INDIVIDUAL' });
    expect(parsed.vehicleClass).toBe('MOTOR_CAR');
  });

  it('accepts every offered option', () => {
    for (const option of VEHICLE_CLASSES) {
      const parsed = createApplicationSchema.parse({ productSlug: 'licence-disc', ownerType: 'INDIVIDUAL', vehicleClass: option.value });
      expect(parsed.vehicleClass).toBe(option.value);
    }
  });

  it('rejects a value that is not an offered option', () => {
    const parsed = createApplicationSchema.safeParse({ productSlug: 'licence-disc', ownerType: 'INDIVIDUAL', vehicleClass: 'HELICOPTER' });
    expect(parsed.success).toBe(false);
  });
});
