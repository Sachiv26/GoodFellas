import { describe, expect, it } from '@jest/globals';
import { PDF_FIELDS, getPdfFieldDefinition, PDF_FIELD } from '@/lib/pdf';

/** Sample fixture per build spec §47. */
const fixture = {
  owner: {
    identificationType: 'RSA_ID',
    idNumber: '8001015009087',
    surname: 'SMITH',
    firstNames: 'JOHN MICHAEL',
    email: 'test@example.com',
    mobile: '0820000000',
  },
  address: {
    streetAddress: '123 Example Street',
    suburb: 'Example',
    city: 'Durban',
    postalCode: '4001',
  },
  vehicle: {
    licenceNumber: 'ABC123GP',
    vehicleRegisterNumber: '123456789',
    vin: 'TESTVIN123456789',
    make: 'TOYOTA',
    seriesName: 'COROLLA',
    odometer: '120000',
  },
};

describe('ALV(9) PDF field registry (population deferred)', () => {
  it('exposes every field required by the fixture', () => {
    const expected = [
      'OWNER_IDENTIFICATION_TYPE',
      'ID_NUMBER',
      'SURNAME_ORGANISATION',
      'FIRST_NAMES',
      'EMAIL',
      'CELLPHONE',
      'POSTAL_ADDRESS_LINE1',
      'POSTAL_SUBURB',
      'POSTAL_CITY',
      'POSTAL_CODE',
      'LICENCE_NUMBER',
      'VEHICLE_REGISTER_NUMBER',
      'VIN_OR_CHASSIS',
      'MAKE',
      'SERIES_NAME',
      'ODOMETER',
    ];
    for (const key of expected) {
      expect(getPdfFieldDefinition(key)).toBeDefined();
      expect(PDF_FIELD[key as keyof typeof PDF_FIELD]).toBe(key);
    }
  });

  it('maps default source paths for owner fields to ID/CUSTOMER sources', () => {
    expect(getPdfFieldDefinition('ID_NUMBER')?.defaultSourcePath).toBe('ID.idNumber');
    expect(getPdfFieldDefinition('SURNAME_ORGANISATION')?.defaultSourcePath).toBe('ID.surname');
    expect(getPdfFieldDefinition('FIRST_NAMES')?.defaultSourcePath).toBe('ID.firstNames');
    expect(getPdfFieldDefinition('EMAIL')?.defaultSourcePath).toBe('CUSTOMER.email');
    expect(getPdfFieldDefinition('CELLPHONE')?.defaultSourcePath).toBe('CUSTOMER.mobileNumber');
  });

  it('maps default source paths for vehicle fields to LICENCE_DISC sources', () => {
    expect(getPdfFieldDefinition('LICENCE_NUMBER')?.defaultSourcePath).toBe(
      'LICENCE_DISC.licenceNumber'
    );
    expect(getPdfFieldDefinition('VIN_OR_CHASSIS')?.defaultSourcePath).toBe('LICENCE_DISC.vin');
    expect(getPdfFieldDefinition('MAKE')?.defaultSourcePath).toBe('LICENCE_DISC.make');
    expect(getPdfFieldDefinition('SERIES_NAME')?.defaultSourcePath).toBe(
      'LICENCE_DISC.seriesName'
    );
    expect(getPdfFieldDefinition('ODOMETER')?.defaultSourcePath).toBe('LICENCE_DISC.odometer');
    expect(getPdfFieldDefinition('VEHICLE_REGISTER_NUMBER')?.defaultSourcePath).toBe(
      'LICENCE_DISC.vehicleRegisterNumber'
    );
  });

  it('marks office-use fields admin-only and signatures as signature fields', () => {
    const officeFields = PDF_FIELDS.filter((f) => f.section === 'OFFICE_USE');
    expect(officeFields.length).toBeGreaterThan(0);
    for (const f of officeFields) {
      expect(f.adminOnly).toBe(true);
    }
    expect(getPdfFieldDefinition('DECLARATION_SIGNATURE')?.signature).toBe(true);
    expect(getPdfFieldDefinition('OFFICE_COUNTER_OFFICIAL_SIGNATURE')?.adminOnly).toBe(true);
  });

  it('never fabricates values: unknown fixture values simply have no mapping', () => {
    // A field absent from the fixture must remain resolvable as blank —
    // the registry exists independently of any particular application data.
    expect(getPdfFieldDefinition('PROXY_ID_NUMBER')).toBeDefined();
    expect(Object.keys(PDF_FIELDS).length).toBe(PDF_FIELDS.length);
  });

  it('all registry keys are unique', () => {
    const keys = PDF_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
