const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const filename = path.join(__dirname, "..", "lib", "reconciliation.ts");
const source = fs.readFileSync(filename, "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleShim = { exports: {} };
new Function("exports", "require", "module", "__filename", "__dirname", compiled)(moduleShim.exports, require, moduleShim, filename, path.dirname(filename));
const { normalizeMerchant, reconciliationKey } = moduleShim.exports;

assert.strictEqual(normalizeMerchant("  ACME Ltd.  "), "acme");
assert.strictEqual(normalizeMerchant("Caf\u00e9 \u2014 Central"), "cafe central");

const base = { transaction_date: "2026-07-21", amount_pence: 1299, currency: "gbp", type: "expense", merchant: "ACME LTD", bank_account_id: "account-1" };
assert.strictEqual(reconciliationKey(base), reconciliationKey({ ...base, merchant: "Acme Limited" }));
assert.notStrictEqual(reconciliationKey(base), reconciliationKey({ ...base, bank_account_id: "account-2" }));
assert.strictEqual(
  reconciliationKey({ ...base, provider_account_ref: "truelayer:stable-account" }),
  reconciliationKey({ ...base, bank_account_id: "reconnected-account", provider_account_ref: "truelayer:stable-account" })
);
assert.notStrictEqual(reconciliationKey(base), reconciliationKey({ ...base, amount_pence: 1300 }));
assert.strictEqual(reconciliationKey({ ...base, transaction_date: "bad" }), null);

console.log("Reconciliation tests passed");
