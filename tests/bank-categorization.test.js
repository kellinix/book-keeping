const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const filename = path.join(__dirname, "..", "lib", "bankCategorization.ts");
const source = fs.readFileSync(filename, "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleShim = { exports: {} };
new Function("exports", "require", "module", "__filename", "__dirname", compiled)(moduleShim.exports, require, moduleShim, filename, path.dirname(filename));
const { categorizeBankTransaction } = moduleShim.exports;

const tx = (description, amount = -10, transaction_category = "") => ({ description, amount, transaction_category });

let result = categorizeBankTransaction(tx("VERCEL SUBSCRIPTION"), true);
assert.strictEqual(result.category, "Software");
assert.strictEqual(result.autoApproved, true);
assert.strictEqual(result.taxDeductible, true);

result = categorizeBankTransaction(tx("SAVE THE CHANGE"), true);
assert.strictEqual(result.category, "Transfer");
assert.strictEqual(result.autoApproved, true);
assert.strictEqual(result.taxDeductible, false);

result = categorizeBankTransaction(tx("CHILD TAX CREDIT", 100), true);
assert.strictEqual(result.category, "Other");
assert.strictEqual(result.autoApproved, true);

result = categorizeBankTransaction(tx("TESCO EXTRA"), true);
assert.strictEqual(result.category, "Other");
assert.strictEqual(result.autoApproved, false);
assert.strictEqual(result.taxDeductible, false);

result = categorizeBankTransaction(tx("MORRISONS PETROL"), true);
assert.strictEqual(result.category, "Travel");
assert.strictEqual(result.autoApproved, false);

result = categorizeBankTransaction(tx("UNKNOWN PERSONAL PAYMENT"), false);
assert.strictEqual(result.autoApproved, true);
assert.strictEqual(result.taxDeductible, false);

console.log("Bank categorisation tests passed");
