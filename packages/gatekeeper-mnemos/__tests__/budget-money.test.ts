import {test} from "node:test";
import assert from "node:assert/strict";
import {parseBudgetUSD,formatBudgetUSD} from "../app/budget-money.ts";

test("budget money round trips values beyond floating point precision", () => {
 for (const micros of ["0","1","1000000","9007199254740993","9223372036854775807"]) assert.equal(parseBudgetUSD(formatBudgetUSD(micros)),micros);
 assert.equal(parseBudgetUSD(" 12,000001 "),"12000001");
 assert.equal(formatBudgetUSD("1234500"),"1.2345");
});
test("budget money rejects rounding, non-finite amounts and integer overflow", () => {
 for (const value of ["", "-1", "NaN", "Infinity", "1e5", "0.0000001", "1,2.3", "9223372036854.775808"]) assert.throws(()=>parseBudgetUSD(value));
 assert.throws(()=>formatBudgetUSD("9223372036854775808"));
});
