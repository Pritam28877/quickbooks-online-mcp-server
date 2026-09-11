import { z } from "zod";

/**
 * The shape a caller describes a bill payment in, and how it becomes a QuickBooks
 * BillPayment entity.
 *
 * Upstream's create_bill_payment takes `billPayment: z.any()` and forwards it
 * untouched. For the one tool on this surface that moves money out of a client's
 * bank account, that is the wrong contract twice over. It gives the model no shape
 * to aim at, so a payment can be malformed in ways only QuickBooks will notice; and
 * it gives the human approving the call nothing legible to approve — an arbitrary
 * blob is not a decision, it is a rubber stamp.
 *
 * So a payment is described the way the instruction is actually given: these bills,
 * from this bank account, on this date. Each of those three is required. The total
 * is derived from the bills rather than accepted from the caller, because a total
 * that disagrees with its lines is exactly the discrepancy nobody notices until the
 * bank statement.
 */

/** A date QuickBooks accepts, checked here so it fails as an argument error. */
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date as YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(value)), "must be a real calendar date");

const idSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[0-9]+$/, "must be a QuickBooks numeric id");

/**
 * A payment run covers a batch, but a batch this large is a data migration rather
 * than something a person reviewed before approving.
 */
const MAX_BILLS_PER_PAYMENT = 50;

const paidBillSchema = z.object({
  bill_id: idSchema.describe("The bill being paid, from search_bills."),
  amount: z
    .number()
    .positive()
    .max(100_000_000)
    .describe("How much of this bill to pay. Use the bill's open balance to pay it in full."),
});

export const billPaymentDraftSchema = z.object({
  vendor_id: idSchema.describe("Who is being paid, from search_vendors. Every bill must belong to this vendor."),
  bills: z
    .array(paidBillSchema)
    .min(1)
    .max(MAX_BILLS_PER_PAYMENT)
    .describe("The bills this payment settles. Naming them is required; there is no pay-everything option."),
  payment_account_id: idSchema.describe(
    "The bank or credit card account the money comes from, from search_accounts. Required: a payment " +
      "with no named account is the one mistake that cannot be undone by editing a record.",
  ),
  payment_date: dateSchema.describe("The date the payment is dated. Required, because 'when' is part of the instruction."),
  pay_type: z
    .enum(["Check", "CreditCard"])
    .default("Check")
    .describe("Check draws on a bank account; CreditCard draws on a credit card account."),
  private_note: z.string().min(1).max(4_000).optional().describe("Internal note, not shown to the vendor."),
  idempotency_key: z
    .string()
    .min(8)
    .max(200)
    .optional()
    .describe("Supply your own key to make a retry of the same payment return the original instead of paying twice."),
});

export type BillPaymentDraft = z.infer<typeof billPaymentDraftSchema>;

/**
 * What this payment releases, in the currency of the company.
 *
 * Derived, never accepted: QuickBooks will happily record a TotalAmt that does not
 * equal the sum of its lines, and the difference lands as an unapplied balance that
 * only shows up in a reconciliation weeks later.
 */
export function draftPaymentTotal(draft: BillPaymentDraft): number {
  const totalInCents = draft.bills.reduce((sum, bill) => sum + Math.round(bill.amount * 100), 0);
  return totalInCents / 100;
}

/** Builds the QuickBooks BillPayment entity from the draft. */
export function buildBillPaymentEntity(draft: BillPaymentDraft): Record<string, unknown> {
  const accountRef = { value: draft.payment_account_id };

  return {
    VendorRef: { value: draft.vendor_id },
    PayType: draft.pay_type,
    TotalAmt: draftPaymentTotal(draft),
    TxnDate: draft.payment_date,
    // QuickBooks names the account differently depending on how it is being paid,
    // and rejects the entity outright if the pair does not match PayType.
    ...(draft.pay_type === "Check"
      ? { CheckPayment: { BankAccountRef: accountRef } }
      : { CreditCardPayment: { CCAccountRef: accountRef } }),
    Line: draft.bills.map((bill) => ({
      Amount: bill.amount,
      LinkedTxn: [{ TxnId: bill.bill_id, TxnType: "Bill" }],
    })),
    ...(draft.private_note ? { PrivateNote: draft.private_note } : {}),
  };
}
