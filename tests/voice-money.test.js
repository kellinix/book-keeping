const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const filename = path.join(__dirname, "..", "lib", "voiceMoney.ts");
const source = fs.readFileSync(filename, "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleShim = { exports: {} };
new Function("exports", "require", "module", "__filename", "__dirname", compiled)(moduleShim.exports, require, moduleShim, filename, path.dirname(filename));
const { amountAppearsExplicitly, extractExplicitMoneyMentions } = moduleShim.exports;

const transcript = "Instagram £5 4p TikTok £5 4p Vercel $22 Superbears $29 3cent subscription £20 Gessage £25";
const mentions = extractExplicitMoneyMentions(transcript);
assert.deepStrictEqual(mentions.map((item) => item.amount), [5, 5, 22, 29, 20, 25]);
assert.strictEqual(amountAppearsExplicitly(mentions, 4), false);
assert.strictEqual(amountAppearsExplicitly(mentions, 3), false);
assert.strictEqual(amountAppearsExplicitly(mentions, 22), true);
assert.deepStrictEqual(extractExplicitMoneyMentions("Paid 12 yesterday, reference 456"), []);
assert.deepStrictEqual(extractExplicitMoneyMentions("Paid 12 pounds and USD 9.50").map((item) => item.amount), [12, 9.5]);

console.log("Voice money extraction tests passed");
