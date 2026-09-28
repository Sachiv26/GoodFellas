import { z } from 'zod';

/** South African mobile number: +27XXXXXXXXX or 0XXXXXXXXX (9 digits after prefix). */
export const saMobileRegex = /^(?:\+27|0)(?:6\d|7[0-4]|7[8-9]|8[0-4]|8[6-9])\d{7}$/;

export const registrationSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  surname: z.string().trim().min(1, 'Surname is required').max(100),
  email: z.string().trim().toLowerCase().email('Valid email is required').max(255),
  mobileNumber: z
    .string()
    .trim()
    .regex(saMobileRegex, 'Enter a valid South African mobile number (e.g. 0821234567)'),
  password: z
    .string()
    .min(10, 'Password must be at least 10 characters')
    .max(128)
    .regex(/[a-zA-Z]/, 'Password must contain a letter')
    .regex(/\d/, 'Password must contain a number'),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});

export const passwordResetRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export const passwordResetSchema = z.object({
  token: z.string().min(16).max(255),
  password: z
    .string()
    .min(10, 'Password must be at least 10 characters')
    .max(128)
    .regex(/[a-zA-Z]/, 'Password must contain a letter')
    .regex(/\d/, 'Password must contain a number'),
});

// Canonical names used by the API routes.
export const registerSchema = registrationSchema;
export const forgotPasswordSchema = passwordResetRequestSchema;
export const resetPasswordSchema = passwordResetSchema;
export const verifyEmailSchema = z.object({
  token: z.string().min(16).max(255),
});


/**
 * Vehicle class options offered on the first page of the application.
 *
 * Each option names the TARE column whose value is used as the licence fee for
 * that class. The class becomes the scope of the `TARE_LICENCE_FEES` lookup
 * (see `lookup.ts`), so the priced fee always matches the vehicle selected.
 *
 * This is the single source of truth shared by the customer form, the pricing
 * engine input builder and the seed that loads the fee tables.
 */
export const VEHICLE_CLASSES = [
  { value: 'MOTOR_CAR', label: 'Motor car (standard licence disc fee)', tareFeeField: 'licenceFee' },
  { value: 'RIGID_VEHICLE', label: 'Rigid vehicles', tareFeeField: 'rigidVehicleFee' },
  { value: 'BREAKDOWN_VEHICLE', label: 'Breakdown vehicles', tareFeeField: 'breakdownVehicleFee' },
  { value: 'TRACTOR', label: 'Tractors used on a public road', tareFeeField: 'tractorFee' },
  { value: 'TRAILER', label: 'Trailers and semi-trailers', tareFeeField: 'trailerFee' },
] as const;

export type VehicleClassValue = (typeof VEHICLE_CLASSES)[number]['value'];

export const VEHICLE_CLASS_VALUES = VEHICLE_CLASSES.map((c) => c.value) as [
  VehicleClassValue,
  ...VehicleClassValue[],
];

export const DEFAULT_VEHICLE_CLASS: VehicleClassValue = 'MOTOR_CAR';

/** TARE fee column for a class, or null when the class is unknown. */
export function tareFeeFieldFor(vehicleClass: string | null | undefined): string | null {
  if (!vehicleClass) return null;
  return VEHICLE_CLASSES.find((c) => c.value === vehicleClass)?.tareFeeField ?? null;
}

/** Customer-facing label for a class, falling back to the raw value. */
export function vehicleClassLabel(value: string | null | undefined): string {
  if (!value) return 'Motor car (standard licence disc fee)';
  return VEHICLE_CLASSES.find((c) => c.value === value)?.label ?? value;
}

export const createApplicationSchema = z.object({
  productSlug: z.string().trim().min(1).max(100),
  ownerType: z.enum(['INDIVIDUAL', 'ORGANISATION']).default('INDIVIDUAL'),
  vehicleClass: z
    .enum(['MOTOR_CAR', 'RIGID_VEHICLE', 'BREAKDOWN_VEHICLE', 'TRACTOR', 'TRAILER'])
    .default('MOTOR_CAR'),
  currentExpiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiry date must be YYYY-MM-DD')
    .optional()
    .nullable(),
});

export type RegistrationInput = z.infer<typeof registrationSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;
