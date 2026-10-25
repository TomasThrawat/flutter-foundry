import test from "node:test";
import assert from "node:assert/strict";
import { generateIconFromPrompt } from "../lib/icon-generator";
import { sanitizeSvgInput } from "../lib/svg-edit";

test("generates a safe SVG from a prompt",()=>{
  const icon=generateIconFromPrompt({prompt:"white camera icon on pure black background with purple accent"});
  assert.equal(icon.concept,"camera");
  assert.equal(icon.colors.background,"#000000");
  assert.equal(icon.colors.foreground,"#ffffff");
  assert.equal(icon.colors.accent,"#7c3aed");
  assert.match(sanitizeSvgInput(icon.svgMarkup),/^<svg/);
  // The SVG xmlns namespace is an HTTP URL by specification; only executable or external references are forbidden.
  assert.doesNotMatch(icon.svgMarkup,/<script|javascript:|(?:href|xlink:href)=["']https?:/i);
});
test("is deterministic for the same prompt and changes for another prompt",()=>{
  const a=generateIconFromPrompt({prompt:"abstract star logo"});
  const b=generateIconFromPrompt({prompt:"abstract star logo"});
  const c=generateIconFromPrompt({prompt:"abstract leaf logo"});
  assert.equal(a.svgMarkup,b.svgMarkup);assert.notEqual(a.svgMarkup,c.svgMarkup);
});
test("accepts size, hex/named colors and transparency",()=>{
  const icon=generateIconFromPrompt({prompt:"minimal music app",size:256,backgroundColor:"transparent",foregroundColor:"#123456",accentColor:"orange"});
  assert.equal(icon.size,256);assert.equal(icon.colors.background,"transparent");assert.equal(icon.colors.foreground,"#123456");assert.equal(icon.colors.accent,"#f97316");
  assert.match(icon.svgMarkup,/width="256" height="256"/);
});
test("rejects invalid prompt, dimensions, and colors",()=>{
  assert.throws(()=>generateIconFromPrompt({prompt:"x"}),/at least 3 characters/);
  assert.throws(()=>generateIconFromPrompt({prompt:"camera",size:4096}),/128 to 1024/);
  assert.throws(()=>generateIconFromPrompt({prompt:"camera",foregroundColor:"url(https://example.com)"}),/Unsupported color/);
});
