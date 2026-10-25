import Link from "next/link";

const toolGroups = [
  {tag:"01 / DISCOVERY",title:"Find real Flutter resources",body:"Search pub.dev and inspect live package metadata instead of relying on a static package catalogue."},
  {tag:"02 / ENGINEERING",title:"Diagnose and repair",body:"Triage Flutter and Gradle build logs, review project metadata, and generate CI workflows."},
  {tag:"03 / SECURITY",title:"Audit dependencies and Android",body:"Query OSV for dependency advisories and inspect supplied Android configuration for common risks."},
  {tag:"04 / QUALITY",title:"Localization and accessibility",body:"Compare ARB keys and placeholders, summarize LCOV coverage, and flag source patterns for manual review."},
  {tag:"05 / SVG-EDIT",title:"Use a real browser editor",body:"Playwright opens the official SVG-Edit app, imports SVG into its canvas, and returns the serialized result and screenshot."},
  {tag:"06 / INTEGRATION",title:"One stateless MCP endpoint",body:"Expose tools at /mcp plus a small web workspace for SVG editing."}
];
export default function HomePage(){return <>
  <section className="hero"><div className="eyebrow">Open source · MCP · Flutter engineering</div><h1>Ship better Flutter apps.<br/><span style={{color:"var(--accent)"}}>With evidence.</span></h1>
  <p className="lead">Flutter Foundry is a practical toolkit for finding current packages, diagnosing builds, checking project quality, and editing SVG assets through the actual SVG-Edit browser application.</p>
  <div className="actions"><Link className="button primary" href="/icon-maker">Open SVG icon workspace ↗</Link><a className="button" href="https://github.com/TomasThrawat/flutter-foundry" target="_blank" rel="noreferrer">View source on GitHub ↗</a></div>
  <p className="note" style={{marginTop:25}}>Icon editing uses upstream SVG-Edit and Playwright browser automation. It does not rely on a template catalogue or an image-generation API.</p></section>
  <section className="section" id="tools"><div className="section-head"><div><div className="eyebrow">Toolbox</div><h2>Small tools, real checks</h2></div><p>Tools report what they inspected and what they could not verify. Static checks are advisory, not a substitute for building and testing on the target device.</p></div>
  <div className="grid">{toolGroups.map(item=><article className="card" key={item.tag}><span className="tag">{item.tag}</span><h3>{item.title}</h3><p>{item.body}</p></article>)}</div></section>
</>}