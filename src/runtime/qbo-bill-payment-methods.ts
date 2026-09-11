import { QuickbooksClient } from "./qbo-client.js";

/**
 * The one node-quickbooks call that releases funds, wrapped so it is promise-shaped
 * and so the idempotency key cannot be forgotten at a call site.
 *
 * `requestId` is not a field on the entity: node-quickbooks lifts it off and sends it
 * as QuickBooks' own `requestid` query parameter, which is Intuit's idempotency
 * mechanism. That is why it is a separate argument here rather than something a
 * caller could set by accident inside the entity — for a payment, a lost response
 * followed by a retry is a second withdrawal.
 */
export async function createBillPaymentEntity<T>(
  entity: object,
  providerRequestId: string,
): Promise<T> {
  const client = await QuickbooksClient.getInstance();
  return new Promise<T>((resolve, reject) => {
    client.createBillPayment({ ...entity, requestId: providerRequestId }, (error: unknown, billPayment: unknown) => {
      if (error) reject(error);
      else resolve(billPayment as T);
    });
  });
}
