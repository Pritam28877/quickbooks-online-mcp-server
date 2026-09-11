/**
 * The real service, run locally against a stand-in for Intuit.
 *
 * Lets the whole accounts-payable path be exercised for real — real MCP Streamable HTTP,
 * real tenant binding, real tool handlers, real caches, the real vendored QuickBooks
 * client — without a consent flow or a sandbox company. Only Intuit itself is stood in
 * for, by a local server that records what it was asked to create.
 *
 * Started by hand, or by an end-to-end test in the calling API:
 *
 *   QBO_MCP_BINDING_KEY=... QBO_MCP_SERVICE_TOKEN=... node checks/local-stack.mjs
 *
 * Prints one line of JSON when both listeners are up, so a parent process can wait on it
 * rather than sleeping:
 *
 *   {"ready":true,"servicePort":8790,"providerPort":8791}
 *
 * The provider exposes GET /__state (what has been created) and POST /__reset, so a test
 * asserts against what QuickBooks actually received rather than against what the service
 * says it sent.
 */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const serviceRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const requireFromService = createRequire(join(serviceRoot, "package.json"));
const QuickBooks = requireFromService("node-quickbooks");

const PROVIDER_PORT = Number(process.env.STANDIN_PORT ?? 8791);
const SERVICE_PORT = Number(process.env.PORT ?? 8790);

/**
 * One company's books.
 *
 * Deliberately small and specific: a maintenance contractor with one prior bill, so a
 * repeat invoice codes itself from history and a different description does not. Adding
 * more rows would make the fixture harder to reason about, not more realistic.
 */
const BOOKS = {
  Vendor: [
    { Id: "7", DisplayName: "Drainage Solutions, Inc.", CompanyName: "Drainage Solutions", Active: true },
    { Id: "8", DisplayName: "Tampa Office Supplies LLC", Active: true },
  ],
  Account: [
    { Id: "63", Name: "Cleaning and Maintenance", AccountType: "Expense", AccountSubType: "SuppliesMaterials", Active: true },
    { Id: "71", Name: "Office Supplies", AccountType: "Expense", AccountSubType: "OfficeGeneralAdministrative", Active: true },
  ],
  Class: [
    { Id: "10", Name: "Building Fund", Active: true },
    { Id: "12", Name: "Youth Program Grant", Active: true },
  ],
  Term: [
    { Id: "3", Name: "Due on receipt", Active: true },
    { Id: "4", Name: "Net 30", DueDays: 30, Active: true },
  ],
  Bill: [
    {
      Id: "101",
      DocNumber: "i35902",
      TxnDate: "2026-07-31",
      TotalAmt: 125,
      VendorRef: { value: "7", name: "Drainage Solutions, Inc." },
      Line: [
        {
          Amount: 125,
          DetailType: "AccountBasedExpenseLineDetail",
          Description: "Performed July maintenance on lift station",
          AccountBasedExpenseLineDetail: {
            AccountRef: { value: "63", name: "Cleaning and Maintenance" },
            ClassRef: { value: "10", name: "Building Fund" },
          },
        },
      ],
    },
  ],
};

/** Everything the service asked Intuit to create, in order. */
const created = [];
/** Every URL the service fetched, so a test can count metered reads. */
const seen = [];
let nextId = 500;

/**
 * The entity a node-quickbooks query URL is asking for.
 *
 * Capitalised on the way out because the library lower-cases the entity in the query it
 * builds ("select * from vendor") while QuickBooks answers under the capitalised key
 * ("QueryResponse.Vendor") — and the capitalised key is what the service reads.
 */
function entityOf(url) {
  const match = decodeURIComponent(url).match(/from\s+([A-Za-z]+)/i);
  if (!match) return null;
  const name = match[1].toLowerCase();
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const provider = createServer((request, response) => {
  const url = decodeURIComponent(request.url ?? "");
  const send = (status, body) =>
    response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));

  if (url.startsWith("/__state")) {
    send(200, { created, seen });
    return;
  }
  if (url.startsWith("/__reset")) {
    created.length = 0;
    seen.length = 0;
    send(200, { reset: true });
    return;
  }

  seen.push({ method: request.method, url });

  if (url.includes("/companyinfo")) {
    send(200, { CompanyInfo: { Id: "1", CompanyName: "Calvary City Christian Center" } });
    return;
  }
  if (url.includes("/preferences")) {
    send(200, { Preferences: {} });
    return;
  }

  // A create: node-quickbooks POSTs to /v3/company/{realm}/{entity}.
  if (request.method === "POST") {
    const entity = url.match(/\/v3\/company\/[0-9]+\/([a-z]+)/i)?.[1];
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const parsed = JSON.parse(body || "{}");
      nextId += 1;
      const name = entity ? entity[0].toUpperCase() + entity.slice(1) : "Entity";
      created.push({ entity: name, url, body: parsed });
      send(200, { [name]: { ...parsed, Id: String(nextId), SyncToken: "0" } });
    });
    return;
  }

  const entity = entityOf(url);
  if (entity && BOOKS[entity]) {
    send(200, { QueryResponse: { [entity]: BOOKS[entity], maxResults: BOOKS[entity].length } });
    return;
  }
  // An unknown entity answers empty rather than erroring: QuickBooks omits the key when
  // nothing matched, and the service is expected to cope with that.
  send(200, { QueryResponse: {} });
});

await new Promise((resolve) => provider.listen(PROVIDER_PORT, "127.0.0.1", resolve));

// Repointed before the service is imported, so every tool it registers talks to the
// stand-in. This is the same technique checks/regression.mjs uses.
QuickBooks.V3_ENDPOINT_BASE_URL = `http://127.0.0.1:${PROVIDER_PORT}/v3/company/`;

const dist = join(serviceRoot, "dist/runtime");
const { loadConfig } = await import(`${dist}/config.js`);
const { createHttpServer } = await import(`${dist}/http-server.js`);
const { configureDownloadLinks } = await import(`${dist}/download-links.js`);
const { configurePdfHandleStore } = await import(`${dist}/pdf-handles.js`);
const { configureTransportPolicy, installQboTransportPolicy } = await import(`${dist}/qbo-transport.js`);

process.env.PORT = String(SERVICE_PORT);
const config = loadConfig();
configurePdfHandleStore(config.pdf);
configureDownloadLinks(config.publicBaseUrl);
configureTransportPolicy(config.transport);
installQboTransportPolicy(config.requestTimeoutMs);

const service = createHttpServer(config);
await new Promise((resolve) => service.listen(SERVICE_PORT, "127.0.0.1", resolve));

// One line, on stdout, so a parent can wait for readiness instead of sleeping.
process.stdout.write(
  `${JSON.stringify({ ready: true, servicePort: SERVICE_PORT, providerPort: PROVIDER_PORT })}\n`,
);

const shutdown = () => {
  service.close();
  provider.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
