/**
 * Admin review of the vehicle data captured from the licence disc barcode.
 *
 * This used to render a snapshot taken when an admin generated a populated PDF.
 * There is no PDF generation and no OCR/AI extraction any more, so it now reads
 * the application's documents directly and shows the live barcode-derived fields
 * that pricing is actually calculated from.
 */
type SnapshotField = {
  fieldName: string;
  value: string | null;
  normalizedValue: string | null;
  confidence: number | null;
  source: string;
  validationStatus: string;
  validationNotes?: string | null;
};
type SnapshotExtraction = {
  status?: string;
  extractionVersion?: string;
  confidence?: number | null;
  fieldExtractions?: SnapshotField[];
} | null;
type SnapshotBarcode = {
  rawValue: string;
  symbology: string;
  confidence: number;
  decodedAt: string | Date;
};
type SnapshotDocument = {
  id: string;
  documentType: { name: string; code: string };
  originalFileName: string;
  status: string;
  extractions: SnapshotExtraction[];
  barcodes: SnapshotBarcode[];
};

export default function ExtractionReview({ documents }: { documents: SnapshotDocument[] }) {
  if (documents.length === 0) {
    return (
      <section className="card">
        <h2 className="text-lg font-semibold text-slate-900">Captured vehicle data</h2>
        <p className="mt-2 text-sm text-slate-600">No documents have been uploaded yet.</p>
      </section>
    );
  }

  return (
    <section>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Captured vehicle data</h2>
          <p className="mt-1 text-sm text-slate-600">
            Read directly from the licence disc barcode. There is no OCR or AI extraction.
          </p>
        </div>
        <span className="badge bg-slate-100 text-slate-800">Live data</span>
      </div>

      <div className="mt-4 space-y-6">
        {documents.map((document) => {
          const extraction = document.extractions[0] ?? null;
          const fields = Array.isArray(extraction?.fieldExtractions) ? extraction.fieldExtractions : [];
          const barcodes = document.barcodes ?? [];
          const withFields = fields.filter((field) => field.value !== null);

          return (
            <article key={document.id} className="card overflow-hidden">
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
                <div>
                  <h3 className="font-semibold text-slate-900">{document.documentType.name}</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {document.documentType.code} · {document.originalFileName}
                  </p>
                </div>
                <span className="badge bg-slate-100 text-slate-700">{document.status}</span>
              </div>

              <div className="mt-4 grid gap-5 lg:grid-cols-2">
                <div>
                  <h4 className="text-sm font-semibold text-slate-800">Vehicle fields</h4>
                  {withFields.length ? (
                    <div className="mt-2 overflow-x-auto">
                      <table className="min-w-full text-left text-xs">
                        <thead className="bg-slate-50 text-slate-600">
                          <tr>
                            <th className="px-2 py-2">Field</th>
                            <th className="px-2 py-2">Value</th>
                            <th className="px-2 py-2">Source</th>
                            <th className="px-2 py-2">Validation</th>
                          </tr>
                        </thead>
                        <tbody>
                          {withFields.map((field) => (
                            <tr key={field.fieldName} className="border-t border-slate-100">
                              <td className="px-2 py-2 font-medium text-slate-700">{field.fieldName}</td>
                              <td className="px-2 py-2 text-slate-900">{field.normalizedValue ?? field.value}</td>
                              <td className="px-2 py-2 text-slate-600">{field.source}</td>
                              <td className="px-2 py-2 text-slate-600">{field.validationStatus}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-slate-600">
                      No vehicle data was captured from this document.
                    </p>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-slate-800">Barcode reads</h4>
                  {barcodes.length ? (
                    <ul className="mt-2 space-y-2">
                      {barcodes.map((barcode, index) => (
                        <li key={index} className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700">
                          <p className="font-medium">
                            {barcode.symbology} · confidence {Math.round(barcode.confidence * 100)}%
                          </p>
                          <p className="mt-1 break-all text-slate-600">{barcode.rawValue}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-slate-600">No barcode was decoded.</p>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
