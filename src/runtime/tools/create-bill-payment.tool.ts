import { buildBillPaymentEntity, billPaymentDraftSchema, draftPaymentTotal, type BillPaymentDraft } from "../bill-payment-draft.js";
import { createOnce, idempotencyScope } from "../idempotency.js";
import { formatMoney } from "../money.js";
import { formatError } from "../qbo-error.js";
import { createBillPaymentEntity } from "../qbo-bill-payment-methods.js";
import type { AnyToolDefinition } from "../tool-allowlist.js";

/**
 * Pays named bills from a named account on a named date, exactly once.
 *
 * Replaces upstream's create_bill_payment, which accepts `billPayment: z.any()` and
 * forwards it with no validation and no idempotency. Two problems, both of which end
 * with money leaving an account twice or leaving the wrong one:
 *
 *  - Nothing required a bank account or a date, so a payment could be assembled from
 *    a partial instruction and QuickBooks would fill in the rest.
 *  - Nothing collapsed a repeat. A model re-planning, a transport retrying, or a
 *    person confirming twice each produced a second withdrawal, and none of them can
 *    be told apart from a genuine second payment by looking at the request.
 *
 * This tool is deliberately not something a planner reaches on its own: it is
 * classified as high risk, which withholds it from autonomous planning, so it runs
 * only from an explicit human instruction that has been approved.
 */

const toolHandler = async ({ params }: { params: BillPaymentDraft }) => {
  try {
    const entity = buildBillPaymentEntity(params);
    const total = draftPaymentTotal(params);
    const scope = idempotencyScope({ toolArguments: params, callerKey: params.idempotency_key });

    const { invoice: payment, replayed } = await createOnce(scope, () =>
      createBillPaymentEntity<Record<string, unknown>>(entity, scope.providerRequestId),
    );

    const paymentId = typeof payment.Id === "string" ? payment.Id : undefined;
    const currency =
      typeof payment.CurrencyRef === "object" && payment.CurrencyRef !== null
        ? (payment.CurrencyRef as Record<string, unknown>).value
        : undefined;
    const billCount = params.bills.length;
    const billWord = billCount === 1 ? "bill" : "bills";

    return {
      content: [
        {
          type: "text" as const,
          text: replayed
            ? `This payment was already made — returning it rather than paying twice. ` +
              `${formatMoney(total, currency)} across ${billCount} ${billWord}, dated ${params.payment_date}.`
            : `Paid ${formatMoney(total, currency)} across ${billCount} ${billWord} from account ` +
              `${params.payment_account_id}, dated ${params.payment_date}.`,
        },
        {
          type: "text" as const,
          text: JSON.stringify({
            id: paymentId,
            total,
            payment_date: params.payment_date,
            payment_account_id: params.payment_account_id,
            pay_type: params.pay_type,
            bill_ids: params.bills.map((bill) => bill.bill_id),
            replayed,
          }),
        },
      ],
    };
  } catch (error) {
    return { content: [{ type: "text" as const, text: `Error creating bill payment: ${formatError(error)}` }] };
  }
};

export const CreateBillPaymentTool: AnyToolDefinition = {
  name: "create_bill_payment",
  description:
    "Pay one or more open bills in the connected QuickBooks company. Requires the bills to pay (from " +
    "search_bills), the bank or credit card account to pay from (from search_accounts), and the payment " +
    "date — this tool never chooses an account or a date for you. Moves money, so it always requires " +
    "explicit human approval. Safe to retry: the same arguments return the payment already made rather " +
    "than paying twice.",
  schema: billPaymentDraftSchema,
  handler: toolHandler,
} as unknown as AnyToolDefinition;
