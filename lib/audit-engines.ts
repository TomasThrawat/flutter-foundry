import { spawn } from "node:child_process";
import { readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

type Mode = "local-cli" | "github-action" | "mcp-server" | "ai-review" | "code-intelligence" | "local-library";
type Engine = { id:string; name:string; category:string; license:string; repository:string; mode:Mode; purpose:string; freeNotes:string; command?:string };
type Runner = { command:string; args:string[]; description:string; shellFiles?:boolean };

const ENGINES: Engine[] = [
{id:"trivy",name:"Trivy",category:"security / SCA / IaC",license:"Apache-2.0",repository:"https://github.com/aquasecurity/trivy",mode:"local-cli",command:"trivy",purpose:"Filesystem vulnerability, misconfiguration and secret scans.",freeNotes:"Open-source CLI; database updates can require network access."},
{id:"gitleaks",name:"Gitleaks",category:"secrets",license:"MIT",repository:"https://github.com/gitleaks/gitleaks",mode:"local-cli",command:"gitleaks",purpose:"Find exposed credentials in source and Git history.",freeNotes:"Local CLI; secret-like output fields are redacted."},
{id:"semgrep",name:"Semgrep",category:"SAST",license:"LGPL-2.1",repository:"https://github.com/semgrep/semgrep",mode:"local-cli",command:"semgrep",purpose:"Rule-based source analysis across languages.",freeNotes:"Rule-pack terms differ from engine licensing; remote rule access may need network."},
{id:"osv-scanner",name:"OSV-Scanner",category:"dependency vulnerabilities",license:"Apache-2.0",repository:"https://github.com/google/osv-scanner",mode:"local-cli",command:"osv-scanner",purpose:"Find known vulnerabilities in dependency files.",freeNotes:"Free CLI; current data or registry lookups can require network."},
{id:"zizmor",name:"zizmor",category:"GitHub Actions security",license:"MIT",repository:"https://github.com/zizmorcore/zizmor",mode:"local-cli",command:"zizmor",purpose:"Audit GitHub Actions workflows for unsafe patterns.",freeNotes:"Local scan requires workflow files."},
{id:"super-linter",name:"Super-Linter",category:"multi-language quality",license:"MIT",repository:"https://github.com/super-linter/super-linter",mode:"github-action",purpose:"Multi-language linting in CI.",freeNotes:"Primarily a GitHub Actions/container integration; not a generic local CLI here."},
{id:"megalinter",name:"MegaLinter",category:"multi-language quality",license:"AGPL-3.0",repository:"https://github.com/oxsecurity/megalinter",mode:"github-action",purpose:"Collection of language/format linters.",freeNotes:"Open source; review AGPL obligations and CI/container needs."},
{id:"detekt",name:"detekt",category:"Kotlin quality",license:"Apache-2.0",repository:"https://github.com/detekt/detekt",mode:"local-cli",command:"detekt",purpose:"Kotlin static analysis.",freeNotes:"CLI with default text output."},
{id:"ktlint",name:"ktlint",category:"Kotlin format/lint",license:"MIT",repository:"https://github.com/ktlint/ktlint",mode:"local-cli",command:"ktlint",purpose:"Kotlin formatting and lint checks.",freeNotes:"Verify installed version and repository config."},
{id:"ruff",name:"Ruff",category:"Python quality",license:"MIT",repository:"https://github.com/astral-sh/ruff",mode:"local-cli",command:"ruff",purpose:"Python lint checks.",freeNotes:"Open-source CLI."},
{id:"shellcheck",name:"ShellCheck",category:"shell quality/security",license:"GPL-3.0",repository:"https://github.com/koalaman/shellcheck",mode:"local-cli",command:"shellcheck",purpose:"Static analysis for shell scripts.",freeNotes:"Scans at most 150 shell files per call."},
{id:"biome",name:"Biome",category:"JS/TS quality",license:"Apache-2.0",repository:"https://github.com/biomejs/biome",mode:"local-cli",command:"biome",purpose:"JavaScript/TypeScript lint and check.",freeNotes:"Check mode only; no automatic fixes."},
{id:"golangci-lint",name:"golangci-lint",category:"Go quality",license:"GPL-3.0",repository:"https://github.com/golangci/golangci-lint",mode:"local-cli",command:"golangci-lint",purpose:"Aggregate Go linters.",freeNotes:"JSON output flag requires a compatible v2 CLI."},
{id:"codeql",name:"CodeQL",category:"SAST",license:"MIT queries / product terms vary",repository:"https://github.com/github/codeql",mode:"github-action",purpose:"Semantic analysis using CodeQL databases and queries.",freeNotes:"Private-repository Code Scanning may require an eligible paid plan."},
{id:"pr-agent",name:"PR-Agent",category:"AI pull-request review",license:"MIT",repository:"https://github.com/The-PR-Agent/pr-agent",mode:"ai-review",purpose:"Review pull requests using an LLM.",freeNotes:"Model hosting/API calls may cost money; local models need local infrastructure."},
{id:"supply-chain-guard",name:"Supply Chain Guard",category:"supply-chain / malware / SBOM",license:"Apache-2.0",repository:"https://github.com/homeofe/supply-chain-guard",mode:"local-cli",command:"supply-chain-guard",purpose:"Detect malicious package indicators and transitive dependency risk.",freeNotes:"Local scan is open source; refreshing the signed threat feed needs network."},
{id:"codegraph",name:"Codegraph",category:"code intelligence / architecture",license:"Apache-2.0",repository:"https://github.com/optave/ops-codegraph-tool",mode:"code-intelligence",command:"codegraph",purpose:"Function dependency graphs, change impact and architecture analysis.",freeNotes:"Core features are local; graph building writes a local database and is not auto-run."},
{id:"argus",name:"Argus Code Scanning MCP",category:"multi-tool security",license:"MIT",repository:"https://github.com/argus-code-scanning/argus-codescan-mcp",mode:"mcp-server",command:"argus",purpose:"Orchestrate scanners and unify findings/SARIF.",freeNotes:"Child scanners need separate installation; not nested automatically."},
{id:"prism-scanner",name:"Prism Scanner",category:"MCP / agent-skill security",license:"Apache-2.0",repository:"https://github.com/aidongise-cell/prism-scanner",mode:"local-cli",command:"prism",purpose:"Inspect MCP servers, agent skills and plugins.",freeNotes:"Only read-only scan mode is called; cleanup/apply is never invoked."},
{id:"trivy-mcp",name:"Trivy MCP Server",category:"MCP integration",license:"MIT",repository:"https://github.com/aquasecurity/trivy-mcp",mode:"mcp-server",purpose:"Upstream Trivy MCP wrapper.",freeNotes:"Cataloged for discovery; direct CLI avoids nested MCP duplication."},
{id:"aws-sample-mcp-security-scanner",name:"AWS sample MCP security scanner",category:"MCP / IaC security",license:"MIT-0",repository:"https://github.com/aws-samples/sample-mcp-security-scanner",mode:"mcp-server",purpose:"Example server for Checkov, Semgrep, Bandit and optional ASH.",freeNotes:"Sample project; ASH and scanners need separate setup."},
{id:"lintro",name:"Lintro",category:"multi-language quality",license:"MIT",repository:"https://github.com/lgtm-hq/py-lintro",mode:"local-cli",command:"lintro",purpose:"Unified lint/format interface and reports.",freeNotes:"Not automatically run because configs may enable formatters/fixes."},
{id:"leakferret",name:"LeakFerret",category:"secrets",license:"MIT",repository:"https://github.com/leakferrethq/leakferret",mode:"local-cli",command:"leakferret",purpose:"Local secret scan with optional provider-side key verification.",freeNotes:"Network verification is never triggered automatically."},
{id:"nox",name:"Nox",category:"AI / MCP / app security",license:"Apache-2.0",repository:"https://github.com/Nox-HQ/nox",mode:"local-cli",command:"nox",purpose:"Analyze AI apps, MCP configuration and security risks.",freeNotes:"Cataloged only until CLI behavior is pinned and tested."},
{id:"ai-patchlab",name:"AI PatchLab",category:"security findings/remediation",license:"MIT",repository:"https://github.com/elfrost/ai-patchlab",mode:"local-library",purpose:"Local orchestration for Gitleaks, Semgrep, Trivy and pip-audit.",freeNotes:"Deterministic enrichment needs no paid API; scanner CLIs are separate."},
{id:"comply-oss",name:"Comply OSS",category:"dependency license compliance",license:"Apache-2.0",repository:"https://github.com/SiteWarming/Comply",mode:"local-cli",command:"comply",purpose:"Inspect dependency licenses and policy obligations.",freeNotes:"AI usage analysis needs a provider key and may cost money."}
];

const RUNNERS: Record<string,Runner> = {
trivy:{command:"trivy",args:["fs","--format","json","--scanners","vuln,misconfig,secret","--quiet","."],description:"Trivy filesystem vulnerability, configuration and secret checks."},
gitleaks:{command:"gitleaks",args:["dir",".","--report-format","json","--redact","--no-banner"],description:"Gitleaks directory scan with redaction."},
semgrep:{command:"semgrep",args:["scan","--config","auto","--json","--metrics=off","."],description:"Semgrep scan; remote rules may require network."},
"osv-scanner":{command:"osv-scanner",args:["scan","source","--format","json","--recursive","."],description:"OSV-Scanner dependency scan."},
zizmor:{command:"zizmor",args:["--format","json",".github/workflows"],description:"Audit GitHub Actions workflow files."},
ruff:{command:"ruff",args:["check","--output-format","json","."],description:"Ruff Python lint scan."},
shellcheck:{command:"shellcheck",args:[],description:"ShellCheck on bounded shell file list.",shellFiles:true},
biome:{command:"biome",args:["check","--reporter=json","."],description:"Biome check mode without auto-fix."},
detekt:{command:"detekt",args:["--input","."],description:"detekt Kotlin analysis."},
ktlint:{command:"ktlint",args:[],description:"ktlint default project scan."},
"golangci-lint":{command:"golangci-lint",args:["run","--output.json.path","stdout","."],description:"golangci-lint v2 JSON scan."},
"supply-chain-guard":{command:"supply-chain-guard",args:["scan","."],description:"Supply Chain Guard local scan."},
"prism-scanner":{command:"prism",args:["scan","."],description:"Prism read-only scan mode."}
};
const IGNORED = new Set([".git","node_modules",".next",".dart_tool",".gradle",".venv","venv","vendor","build","dist","coverage"]);
const OUTPUT_LIMIT = 16000;
export function getAuditEngineCatalog() {
 return ENGINES.map((engine)=>({...engine,runnableByThisServer:Boolean(RUNNERS[engine.id]),integrationNote:engine.mode==="github-action"?"CI/container integration; not run as a generic child process.":engine.mode==="mcp-server"?"Separate upstream MCP server; not nested automatically.":engine.mode==="ai-review"?"Requires GitHub/LLM configuration; not invoked automatically.":engine.mode==="code-intelligence"?"May write a local index; inspect and run separately.":engine.mode==="local-library"?"Reference/orchestration project requiring local setup.":RUNNERS[engine.id]?"Allowlisted local CLI adapter.":"Catalog only until compatibility has been pinned and tested."}));
}
export function getRunnableEngineIds(){return Object.keys(RUNNERS);}
export function isPathWithinRoot(candidate:string,root:string):boolean {const rel=path.relative(root,candidate);return rel===""||(rel!==".."&&!rel.startsWith(".."+path.sep)&&!path.isAbsolute(rel));}
export function sanitizeScannerOutput(input:unknown):unknown {
 const secretKey=/^(secret|match|matchedtext|rawsecret|tokenvalue|privatekey|sourcecode|linecontent|authorization)$/i;
 const visit=(v:unknown,d:number):unknown=>{
  if(d>8)return "[depth limited]";
  if(typeof v==="string")return v.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,"[REDACTED PRIVATE KEY]").replace(/\bgithub_pat_[A-Za-z0-9_]{10,}\b/g,"[REDACTED TOKEN]").replace(/\bgh[pousr]_[A-Za-z0-9_]{10,}\b/g,"[REDACTED TOKEN]").replace(/\bAKIA[0-9A-Z]{16}\b/g,"[REDACTED AWS KEY]").replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g,"[REDACTED API KEY]").replace(/\b(?:api[_-]?key|secret|password|access[_-]?token)\s*[:=]\s*["']?[^ \t\r\n,"']{8,}/gi,"[REDACTED CREDENTIAL ASSIGNMENT]").slice(0,1200);
  if(Array.isArray(v))return v.slice(0,100).map((x)=>visit(x,d+1));
  if(v&&typeof v==="object"){const out:Record<string,unknown>={};for(const [k,x] of Object.entries(v as Record<string,unknown>).slice(0,200))out[k]=secretKey.test(k)?"[REDACTED]":visit(x,d+1);return out;}
  return v;
 };return visit(input,0);
}
export function scanSuppliedFiles(files:Array<{path:string;content:string}>){
 const findings:Array<{file:string;line:number;rule:string;severity:"critical"|"high"|"medium"|"low";recommendation:string}>=[];
 const rules:Array<{id:string;regex:RegExp;severity:"critical"|"high"|"medium"|"low";recommendation:string}>=[
 {id:"secret.assignment",regex:/\b(?:api[_-]?key|secret|password|access[_-]?token|private[_-]?key)\s*[:=]\s*["'][^"'\r\n]{8,}["']/i,severity:"high",recommendation:"Move credentials to a secret store; rotate real exposed credentials."},
 {id:"secret.github-token",regex:/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,severity:"critical",recommendation:"Revoke the token and remove it from repository history."},
 {id:"secret.aws-access-key",regex:/\bAKIA[0-9A-Z]{16}\b/,severity:"critical",recommendation:"Rotate the AWS key and inspect repository history."},
 {id:"secret.private-key",regex:/-----BEGIN [A-Z ]*PRIVATE KEY-----/,severity:"critical",recommendation:"Remove the private key and rotate/reissue it."},
 {id:"python.dynamic-eval",regex:/\b(?:eval|exec)\s*\(/,severity:"medium",recommendation:"Review dynamic execution and validate untrusted inputs."},
 {id:"python.shell-true",regex:/\bshell\s*=\s*True\b/,severity:"high",recommendation:"Prefer argument arrays with shell disabled."},
 {id:"web.dangerously-set-html",regex:/\bdangerouslySetInnerHTML\b/,severity:"high",recommendation:"Sanitize untrusted HTML before rendering."},
 {id:"workflow.write-all",regex:/^\s*permissions:\s*write-all\s*$/i,severity:"high",recommendation:"Use least-privilege workflow permissions."},
 {id:"workflow.unpinned-action",regex:/^\s*(?:-\s*)?uses:\s*[^#\s]+@(?:v\d+|main|master|latest)\s*$/i,severity:"medium",recommendation:"Pin third-party Actions to a reviewed full commit SHA."},
 {id:"network.cleartext-http",regex:/https?:\/\/(?!localhost\b|127\.0\.0\.1\b)[^\s"'<>]+/i,severity:"low",recommendation:"Review cleartext HTTP; use HTTPS for sensitive traffic."}
 ];
 for(const file of files){const p=file.path.replace(/\\/g,"/").slice(0,300);const lines=file.content.split(/\r?\n/);
 for(let i=0;i<lines.length;i++)for(const rule of rules){
 if((rule.id==="workflow.write-all"||rule.id==="workflow.unpinned-action")&&!p.startsWith(".github/workflows/"))continue;
 if(rule.id==="python.dynamic-eval"&&!/\.(py|js|ts|mjs|cjs)$/i.test(p))continue;
 if(rule.id==="python.shell-true"&&!/\.py$/i.test(p))continue;
 if(rule.id==="web.dangerously-set-html"&&!/\.(jsx|tsx|js|ts)$/i.test(p))continue;
 if(rule.id==="network.cleartext-http"&&!/\.(dart|py|js|ts|json|ya?ml|xml|gradle|properties)$/i.test(p))continue;
 if(rule.regex.test(lines[i]))findings.push({file:p,line:i+1,rule:rule.id,severity:rule.severity,recommendation:rule.recommendation});
 if(findings.length>=500)return {filesScanned:files.length,findings,truncated:true,note:"Heuristic text scan only; validate with a dedicated scanner."};
 } }
 return {filesScanned:files.length,findings,truncated:false,note:"Heuristic source-text scan only; code is not executed and this does not replace SAST/SCA tools."};
}
function roots():string[]{const raw=process.env.AUDIT_ALLOWED_ROOTS;const list=raw?raw.split(",").map((s)=>s.trim()).filter(Boolean):[process.cwd()];const out:string[]=[];for(const s of list)try{const real=realpathSync(path.resolve(/*turbopackIgnore: true*/ s));if(statSync(real).isDirectory())out.push(real);}catch{/* configured root missing */}return out;}
function resolveRepo(requested?:string):string{let real:string;try{real=realpathSync(path.resolve(/*turbopackIgnore: true*/ requested||"."));}catch{throw new Error("Repository path does not exist. Configure AUDIT_ALLOWED_ROOTS for trusted roots.");}if(!statSync(real).isDirectory())throw new Error("Repository path must be a directory.");if(!roots().some((root)=>isPathWithinRoot(real,root)))throw new Error("Repository path is outside AUDIT_ALLOWED_ROOTS.");return real;}
function childEnv():NodeJS.ProcessEnv{const keys=["PATH","Path","HOME","USERPROFILE","TMPDIR","TEMP","TMP","XDG_CACHE_HOME","HTTP_PROXY","HTTPS_PROXY","NO_PROXY","SSL_CERT_FILE","SSL_CERT_DIR","TRIVY_CACHE_DIR"];const out:NodeJS.ProcessEnv={NODE_ENV:process.env.NODE_ENV||"production",CI:"1",NO_COLOR:"1"};for(const k of keys)if(process.env[k])out[k]=process.env[k];return out;}
type Proc={exitCode:number|null;stdout:string;stderr:string;timedOut:boolean;spawnError?:string};
function runProcess(command:string,args:string[],cwd:string,timeoutMs:number):Promise<Proc>{return new Promise((resolve)=>{
 let out="",err="",timedOut=false,settled=false,spawnError:string|undefined;let child:any;
 try{child=spawn(command,args,{cwd,env:childEnv(),shell:false,windowsHide:true,stdio:["ignore","pipe","pipe"]});}catch(e){resolve({exitCode:null,stdout:out,stderr:err,timedOut,spawnError:e instanceof Error?e.message:"Could not start scanner."});return;}
 const add=(a:string,b:Buffer)=>a.length>=250000?a:(a+b.toString("utf8")).slice(0,250000);
 child.stdout.on("data",(b:Buffer)=>{out=add(out,b);});child.stderr.on("data",(b:Buffer)=>{err=add(err,b);});
 child.on("error",(e:NodeJS.ErrnoException)=>{spawnError=e.code==="ENOENT"?"Executable missing or not on PATH.":e.message;});
 const timer=setTimeout(()=>{timedOut=true;child.kill("SIGTERM");setTimeout(()=>{if(!settled)child.kill("SIGKILL");},300).unref();},timeoutMs);
 child.on("close",(code:number|null)=>{settled=true;clearTimeout(timer);resolve({exitCode:code,stdout:out,stderr:err,timedOut,spawnError});});
});}
async function probe(command:string){const r=await runProcess(command,["--version"],process.cwd(),1800);if(r.spawnError)return{installed:false,version:null as string|null,error:r.spawnError};if(r.timedOut)return{installed:true,version:null as string|null,error:"Version probe timed out."};return{installed:true,version:(r.stdout+"\n"+r.stderr).trim().split(/\r?\n/).filter(Boolean)[0]?.slice(0,200)||null};}
function findShellFiles(root:string):string[]{const files:string[]=[];const walk=(dir:string)=>{if(files.length>=150)return;let entries;try{entries=readdirSync(dir,{withFileTypes:true});}catch{return;}for(const e of entries){if(files.length>=150)break;if(e.isSymbolicLink())continue;const f=path.join(dir,e.name);if(e.isDirectory()){if(!IGNORED.has(e.name))walk(f);}else if(e.isFile()&&/\.(sh|bash)$/i.test(e.name))files.push(f);}};walk(root);return files;}
function outSummary(r:Proc){let output:unknown=null;if(r.stdout.trim())try{output=sanitizeScannerOutput(JSON.parse(r.stdout));}catch{output=sanitizeScannerOutput(r.stdout.trim());}const stderr=sanitizeScannerOutput(r.stderr.trim());const s=JSON.stringify({output,stderr:stderr||undefined});return s.length>OUTPUT_LIMIT?s.slice(0,OUTPUT_LIMIT)+"…[truncated]":s;}
async function execute(id:string,root:string,timeout:number){const spec=RUNNERS[id];if(!spec)return{engine:id,status:"not_directly_runnable"};if(id==="zizmor"){try{if(!statSync(path.join(root,".github")).isDirectory())return{engine:id,status:"skipped",message:"No .github directory."};}catch{return{engine:id,status:"skipped",message:"No .github directory."};}}
 let args=[...spec.args];if(spec.shellFiles){const files=findShellFiles(root);if(!files.length)return{engine:id,status:"skipped",message:"No shell scripts found."};args=["--format=json",...files];}
 const r=await runProcess(spec.command,args,root,timeout);if(r.spawnError)return{engine:id,status:"not_installed",message:r.spawnError};
 return{engine:id,status:r.timedOut?"timed_out":r.exitCode===0?"completed":"completed_nonzero",exitCode:r.exitCode,timedOut:r.timedOut,description:spec.description,output:outSummary(r),interpretation:r.timedOut?"Timeout; results may be incomplete.":r.exitCode===0?"Process exited successfully; coverage is not guaranteed.":"Non-zero exit may indicate findings, a scan error or incompatible CLI flags."};
}
export function registerAuditTools(register:(name:string,title:string,description:string,schema:z.ZodType,run:(input:any)=>Promise<unknown>|unknown)=>void){
 register("flutter_audit_engine_catalog","List audit engines","List discovered open-source engines, stated licenses, integration modes and limitations. Does not install tools.",z.object({}).strict(),()=>({count:ENGINES.length,engines:getAuditEngineCatalog(),licenseNote:"Check transitive dependencies, rule packs, containers and model-provider terms separately."}));
 register("flutter_audit_engine_status","Check local engine availability","Probe local command-line tools without scanning. Vercel does not bundle native scanners.",z.object({}).strict(),async()=>{const list=await Promise.all(ENGINES.map(async(e)=>{if(!e.command)return{id:e.id,mode:e.mode,status:"external_or_manual",runnableByThisServer:false,note:e.freeNotes};const p=await probe(e.command);return{id:e.id,mode:e.mode,status:p.installed?"installed":"not_installed",version:p.version,error:p.error,runnableByThisServer:Boolean(RUNNERS[e.id]),note:e.freeNotes};}));return{repositoryRoot:process.cwd(),engineCount:list.length,availableCliCount:list.filter((i)=>i.status==="installed").length,engines:list,note:"Catalog presence does not mean a scan has run."};});
 register("flutter_audit_scan_supplied_files","Run heuristic source checks","Scan supplied source text without executing it. Returns rules/paths/line numbers, never source lines. Heuristics do not replace dedicated scanners.",z.object({files:z.array(z.object({path:z.string().min(1).max(300),content:z.string().max(30000)}).strict()).min(1).max(20).refine((fs)=>fs.reduce((sum,f)=>sum+f.content.length,0)<=200000,"Combined source text must be 200 KB or less.")}).strict(),({files}:{files:Array<{path:string;content:string}>})=>scanSuppliedFiles(files));
 register("flutter_audit_run_engine","Run one allowlisted engine","Run a supported local CLI within AUDIT_ALLOWED_ROOTS. Fixed arguments only, shell disabled, bounded time and sanitized output.",z.object({engine:z.enum(["trivy","gitleaks","semgrep","osv-scanner","zizmor","ruff","shellcheck","biome","detekt","ktlint","golangci-lint","supply-chain-guard","prism-scanner"]),repositoryPath:z.string().min(1).max(1000).optional()}).strict(),async({engine,repositoryPath}:{engine:string;repositoryPath?:string})=>{const root=resolveRepo(repositoryPath);const p=await probe(RUNNERS[engine].command);if(!p.installed)return{engine,status:"not_installed",error:p.error,installHint:"Install the upstream CLI and add it to PATH."};const timeout=Math.min(20000,Math.max(1000,Number(process.env.AUDIT_ENGINE_TIMEOUT_MS)||12000));return{repositoryRoot:root,...await execute(engine,root,timeout),version:p.version,timeoutMs:timeout};});
 register("flutter_audit_scan_local_repository","Run available local engines","Run selected installed scanners with a 43-second total budget and combined sanitized output.",z.object({repositoryPath:z.string().min(1).max(1000).optional(),engines:z.array(z.enum(["trivy","gitleaks","semgrep","osv-scanner","zizmor","ruff","shellcheck","biome","detekt","ktlint","golangci-lint","supply-chain-guard","prism-scanner"])).max(13).optional()}).strict(),async({repositoryPath,engines}:{repositoryPath?:string;engines?:string[]})=>{const root=resolveRepo(repositoryPath);const selected=engines&&engines.length?[...new Set(engines)]:Object.keys(RUNNERS);const checks=await Promise.all(selected.map(async(id)=>({id,p:await probe(RUNNERS[id].command)})));const started=Date.now(),budget=43000;const results:Array<Record<string,unknown>>=checks.filter((i)=>!i.p.installed).map((i)=>({engine:i.id,status:"not_installed",error:i.p.error}));for(const i of checks.filter((item)=>item.p.installed)){const remaining=budget-(Date.now()-started);if(remaining<1000){results.push({engine:i.id,status:"not_run_budget_exhausted"});continue;}results.push(await execute(i.id,root,Math.min(15000,remaining)));}return{repositoryRoot:root,requestedEngines:selected,completedCount:results.filter((r)=>r.status==="completed"||r.status==="completed_nonzero").length,elapsedMs:Date.now()-started,results,note:"Unavailable, skipped, timed-out and non-zero processes are distinguished. Review sanitized reports before sharing."};});
}
