// TaxSubmissionProvider — seam for future HMRC MTD ITSA API integration.
// The only current implementation is NoopProvider (no real HMRC calls).
// A real HmrcProvider will be added at the OAuth/enrolment stage.
//
// IMPORTANT: Quarterly updates are CUMULATIVE (year-to-date).
// submitQuarterlyUpdate must always recompute totals from the start of the
// tax year, not sum a single period in isolation.
//
// EOPS (End of Period Statement) was abolished — it is deliberately omitted here.
// Crystallisation of the final declaration is handled via submitFinalDeclaration.
//
// NINO and UTR are required for real HMRC calls. They will be added at the
// OAuth/enrolment stage and MUST be encrypted at rest before storing.

export type Obligation = {
  periodId: string;
  incomeSourceId: string;
  taxYear: string;
  quarter: 1 | 2 | 3 | 4;
  start: Date;
  end: Date;
  due: Date;
  status: "open" | "submitted" | "overdue";
};

export type QuarterlyUpdatePayload = {
  incomeSourceId: string;
  taxYear: string;
  quarter: 1 | 2 | 3 | 4;
  // All figures are YEAR-TO-DATE (cumulative from 6 Apr / 1 Apr of tax year start)
  ytdIncomePence: number;   // integer pence
  ytdExpensePence: number;  // integer pence
  adjustmentsPence?: Record<string, number>; // keyed by HMRC adjustment type
};

export type SubmissionResult = {
  status: "noop" | "submitted" | "error";
  message: string;
  correlationId?: string; // HMRC correlation ID for submitted calls
};

export interface TaxSubmissionProvider {
  getObligations(incomeSourceId: string, taxYear: string): Promise<Obligation[]>;

  // Submits cumulative year-to-date figures for the specified quarter.
  // Must be called with full YTD totals — HMRC overwrites, not accumulates.
  submitQuarterlyUpdate(payload: QuarterlyUpdatePayload): Promise<SubmissionResult>;

  submitFinalDeclaration(taxYear: string, incomeSourceId: string): Promise<SubmissionResult>;
  crystallise(taxYear: string): Promise<SubmissionResult>;
}

export class NoopProvider implements TaxSubmissionProvider {
  async getObligations(): Promise<Obligation[]> {
    return [];
  }

  async submitQuarterlyUpdate(): Promise<SubmissionResult> {
    return { status: "noop", message: "HMRC integration not yet enabled. Your records are being prepared locally." };
  }

  async submitFinalDeclaration(): Promise<SubmissionResult> {
    return { status: "noop", message: "HMRC integration not yet enabled." };
  }

  async crystallise(): Promise<SubmissionResult> {
    return { status: "noop", message: "HMRC integration not yet enabled." };
  }
}

export const taxProvider: TaxSubmissionProvider = new NoopProvider();
