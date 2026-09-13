import { test } from "node:test";
import assert from "node:assert/strict";
import { histogramPercentileBound } from "../app/latency.ts";
import type { ServiceOperation } from "../src/mnemos-api.ts";
test("histogram bounds preserve overflow and do not invent precision",()=>{
 const op:ServiceOperation={surface:"http",method:"read",requests:100,duration_seconds:20,outcomes:{ok:100},buckets:[{upper_seconds:0.00125,count:50},{upper_seconds:0.1,count:95},{upper_seconds:null,count:100}]};
 assert.equal(histogramPercentileBound(op,50),"не более 1.25 мс");
 assert.equal(histogramPercentileBound(op,95),"не более 100 мс");
 assert.equal(histogramPercentileBound(op,99),"выше 100 мс");
 assert.equal(histogramPercentileBound({...op,requests:0},99),"нет измерений");
});
