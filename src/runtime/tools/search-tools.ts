import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../pagination.js";
import {
  projectAccount,
  projectBill,
  projectClass,
  projectCustomer,
  projectInvoice,
  projectItem,
  projectTaxCode,
  projectTerm,
  projectVendor,
} from "../projections.js";
import {
  findAccountRows,
  findBillRows,
  findClassRows,
  findCustomerRows,
  findInvoiceRows,
  findItemRows,
  findTaxCodeRows,
  findTermRows,
  findVendorRows,
} from "../qbo-query-methods.js";
import { createSearchTool } from "./search-tool-factory.js";

/**
 * The searches this service exposes, as data.
 *
 * Field lists come from the filterable and sortable columns in Intuit's entity
 * reference — the same lists upstream derived, now actually enforced (see
 * search-tool-factory.ts for why upstream's were unreachable).
 *
 * Default sorts are chosen for stable paging. DisplayName and Name are unique
 * within a QuickBooks company, so they give a total order and a page boundary
 * that does not move between calls. Invoices default to newest first instead,
 * because that is what nearly every question wants; paging deep through that sort
 * while invoices are being created will shift rows, so the description tells a
 * caller to sort by Id ascending when it intends to walk the whole list.
 */

const PAGING_NOTE =
  `Returns at most ${MAX_PAGE_SIZE} rows (${DEFAULT_PAGE_SIZE} by default) with a next_offset when more ` +
  "exist; call again with that offset to continue. Rows are summaries — read the full record by id.";

export const SearchInvoicesTool = createSearchTool({
  name: "search_invoices",
  label: "invoices",
  description:
    "Find invoices in the connected QuickBooks company by document number, customer, date, due date or " +
    `balance. Newest first by default; sort by Id ascending to page through every invoice stably. ${PAGING_NOTE}`,
  filterFields: [
    "Id",
    "DocNumber",
    "TxnDate",
    "DueDate",
    "CustomerRef",
    "Balance",
    "TotalAmt",
    "ClassRef",
    "DepartmentRef",
    "MetaData.CreateTime",
    "MetaData.LastUpdatedTime",
  ],
  sortFields: [
    "Id",
    "DocNumber",
    "TxnDate",
    "Balance",
    "TotalAmt",
    "MetaData.CreateTime",
    "MetaData.LastUpdatedTime",
  ],
  defaultSort: { field: "Id", direction: "desc" },
  fetch: findInvoiceRows,
  project: projectInvoice,
  // Not cached: invoices are the entity being created, updated and voided, so a
  // stale row here would be a correctness bug rather than a saved request.
});

export const SearchCustomersTool = createSearchTool({
  name: "search_customers",
  label: "customers",
  description:
    "Find customers in the connected QuickBooks company by name, company, email or balance. Use this to " +
    `resolve a customer id before creating an invoice. ${PAGING_NOTE}`,
  filterFields: [
    "Id",
    "DisplayName",
    "GivenName",
    "FamilyName",
    "CompanyName",
    "PrimaryEmailAddr",
    "PrimaryPhone",
    "Balance",
    "Active",
    "MetaData.CreateTime",
    "MetaData.LastUpdatedTime",
  ],
  sortFields: ["Id", "DisplayName", "GivenName", "FamilyName", "CompanyName", "Balance", "MetaData.LastUpdatedTime"],
  defaultSort: { field: "DisplayName", direction: "asc" },
  fetch: findCustomerRows,
  project: projectCustomer,
  cacheKind: "customer",
});

export const SearchItemsTool = createSearchTool({
  name: "search_items",
  label: "items",
  description:
    "Find products and services in the connected QuickBooks company. Use this to resolve the item id and " +
    `unit price for an invoice line. ${PAGING_NOTE}`,
  filterFields: ["Id", "Name", "Sku", "Type", "Active", "MetaData.CreateTime", "MetaData.LastUpdatedTime"],
  sortFields: ["Id", "Name", "Type", "UnitPrice", "QtyOnHand", "MetaData.LastUpdatedTime"],
  defaultSort: { field: "Name", direction: "asc" },
  fetch: findItemRows,
  project: projectItem,
  cacheKind: "item",
});

export const SearchTermsTool = createSearchTool({
  name: "search_terms",
  label: "payment terms",
  description:
    "List the payment terms configured in the connected QuickBooks company, such as Net 30. Use this to " +
    `resolve a term id when setting an invoice due date policy. ${PAGING_NOTE}`,
  filterFields: ["Id", "Name", "Active"],
  sortFields: ["Id", "Name"],
  defaultSort: { field: "Name", direction: "asc" },
  fetch: findTermRows,
  project: projectTerm,
  cacheKind: "term",
});

export const SearchTaxCodesTool = createSearchTool({
  name: "search_tax_codes",
  label: "tax codes",
  description:
    "List the sales tax codes configured in the connected QuickBooks company. Use this to resolve a tax " +
    `code id for an invoice line when the company charges tax manually. ${PAGING_NOTE}`,
  filterFields: ["Id", "Name", "Active", "Taxable"],
  sortFields: ["Id", "Name"],
  defaultSort: { field: "Name", direction: "asc" },
  fetch: findTaxCodeRows,
  project: projectTaxCode,
  cacheKind: "taxCode",
});

/**
 * The payables searches: the four reads a bill run leans on hardest.
 *
 * These were left vendored while the sales-side searches were replaced, which left
 * the accounts-payable workflow reading through exactly the two defects the factory
 * exists to fix — an unenforceable field list, and `fetchAll: true` paging until the
 * company is exhausted. On a bill search that is a whole company's transaction
 * history in one call, against a read quota Intuit blocks rather than bills at.
 *
 * Vendors, accounts and classes are cached per realm: coding a month of invoices
 * consults all three constantly and they change rarely. Bills are not — they are the
 * transaction data being written, and a stale answer would be read as history.
 */

export const SearchVendorsTool = createSearchTool({
  name: "search_vendors",
  label: "vendors",
  description:
    "List or find vendors (suppliers) in the connected QuickBooks company by name, company or balance. " +
    `Use this to answer questions about vendors, or to resolve a vendor id before entering a bill. ${PAGING_NOTE}`,
  filterFields: [
    "Id",
    "DisplayName",
    "CompanyName",
    "GivenName",
    "FamilyName",
    "Active",
    "Balance",
    "MetaData.CreateTime",
    "MetaData.LastUpdatedTime",
  ],
  sortFields: ["Id", "DisplayName", "CompanyName", "Balance", "MetaData.LastUpdatedTime"],
  defaultSort: { field: "DisplayName", direction: "asc" },
  fetch: findVendorRows,
  project: projectVendor,
  cacheKind: "vendor",
});

export const SearchAccountsTool = createSearchTool({
  name: "search_accounts",
  label: "accounts",
  description:
    "List the chart of accounts in the connected QuickBooks company. Use this to resolve the expense " +
    `category for a bill line. ${PAGING_NOTE}`,
  filterFields: [
    "Id",
    "Name",
    "FullyQualifiedName",
    "AccountType",
    "AccountSubType",
    "Classification",
    "Active",
    "SubAccount",
    "MetaData.LastUpdatedTime",
  ],
  sortFields: ["Id", "Name", "AccountType", "MetaData.LastUpdatedTime"],
  defaultSort: { field: "Name", direction: "asc" },
  fetch: findAccountRows,
  project: projectAccount,
  cacheKind: "account",
});

export const SearchClassesTool = createSearchTool({
  name: "search_classes",
  label: "classes",
  description:
    "List the classes configured in the connected QuickBooks company. For non-profit customers these are " +
    `the restricted funds an expense is charged to. ${PAGING_NOTE}`,
  filterFields: ["Id", "Name", "FullyQualifiedName", "Active", "MetaData.LastUpdatedTime"],
  sortFields: ["Id", "Name"],
  defaultSort: { field: "Name", direction: "asc" },
  fetch: findClassRows,
  project: projectClass,
  cacheKind: "class",
});

export const SearchBillsTool = createSearchTool({
  name: "search_bills",
  label: "bills",
  description:
    "Find bills in the connected QuickBooks company by vendor, document number, date or balance. Use this " +
    "to see how a vendor's previous bills were coded before entering a new one. Newest first by default. " +
    PAGING_NOTE,
  filterFields: [
    "Id",
    "DocNumber",
    "TxnDate",
    "DueDate",
    "VendorRef",
    "APAccountRef",
    "Balance",
    "TotalAmt",
    "MetaData.CreateTime",
    "MetaData.LastUpdatedTime",
  ],
  sortFields: ["Id", "DocNumber", "TxnDate", "DueDate", "Balance", "TotalAmt", "MetaData.LastUpdatedTime"],
  defaultSort: { field: "TxnDate", direction: "desc" },
  fetch: findBillRows,
  project: projectBill,
  // Not cached: bills are the entity being written, and a stale one would be read
  // as history and coded from.
});
