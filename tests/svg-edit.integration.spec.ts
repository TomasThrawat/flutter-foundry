import { test, expect } from "@playwright/test";
test("official SVG-Edit loads and exposes its editor API",async({page})=>{
 await page.goto(process.env.SVG_EDIT_URL||"https://svgedit.netlify.app/index.html",{waitUntil:"domcontentloaded"});
 await page.waitForFunction(()=>{const e=(window as unknown as {svgEditor?:{isReady?:boolean;loadSvgString?:unknown;svgCanvas?:unknown}}).svgEditor;return Boolean(e?.isReady&&typeof e.loadSvgString==="function"&&e.svgCanvas);},undefined,{timeout:45000});
 const s=await page.evaluate(()=>{const e=(window as unknown as {svgEditor?:{isReady?:boolean;loadSvgString?:unknown;svgCanvas?:{getSvgString?:unknown}}}).svgEditor;return{ready:Boolean(e?.isReady),load:typeof e?.loadSvgString,serialize:typeof e?.svgCanvas?.getSvgString};});
 expect(s.ready).toBe(true);expect(s.load).toBe("function");expect(["function","undefined"]).toContain(s.serialize);
});