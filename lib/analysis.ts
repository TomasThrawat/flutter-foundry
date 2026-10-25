export type Finding={severity:"critical"|"high"|"medium"|"low"|"info";title:string;evidence:string;recommendation:string};
export function analyzeBuildLog(log:string){
 const patterns:Array<{category:string;regex:RegExp;cause:string;action:string}>=[
 {category:"Dart compile error",regex:/Error: (?:The getter|The method|Undefined name|A value of type|Expected|Can't|The argument type|Not a constant expression)/i,cause:"Dart source failed static compilation.",action:"Fix the first Dart error at its source location before addressing follow-on errors."},
 {category:"Package resolution",regex:/version solving failed|Because .* depends on .* version solving failed|pub get failed|could not resolve/i,cause:"Pub could not resolve a compatible dependency graph.",action:"Inspect the constraints in the first solver block and change the smallest set of incompatible constraints."},
 {category:"Gradle dependency/network",regex:/Could not resolve all files|Could not GET|UnknownHostException|Connection timed out|PKIX path building failed/i,cause:"Gradle could not retrieve a dependency or trust its TLS connection.",action:"Check repository access, DNS, proxy and certificates before changing dependency versions."},
 {category:"Android SDK",regex:/SDK location not found|failed to find target with hash string|platforms;android-|licenses not accepted/i,cause:"The Android SDK or a required platform/license is missing.",action:"Install the requested SDK platform/build-tools and accept licenses in the build environment."},
 {category:"Kotlin/Gradle compatibility",regex:/Unsupported class file major version|requires .* Gradle|minimum supported Gradle version|Kotlin Gradle plugin/i,cause:"JDK, Gradle wrapper, Android Gradle Plugin, or Kotlin plugin versions may be incompatible.",action:"Compare the full version matrix in official Android Gradle Plugin compatibility guidance."},
 {category:"Out of memory",regex:/Java heap space|OutOfMemoryError|GC overhead limit exceeded|Killed process .*java/i,cause:"The build process exhausted available memory.",action:"Reduce parallel builds and check runner memory/heap settings before changing application code."},
 {category:"Test failure",regex:/Some tests failed|Expected: .*Actual:|TestFailure|Exception caught by test/i,cause:"At least one test assertion or test setup failed.",action:"Run the named test in isolation and fix the earliest failing assertion or test setup issue."},
 {category:"Signing/release configuration",regex:/Keystore file not found|Execution failed for task .*sign|SigningConfig .* is missing|required a signing config/i,cause:"Release signing configuration is incomplete or points to a missing file.",action:"Check signing configuration and secret/file availability without committing keystores or passwords."}
 ];
 const lines=log.split(/\r?\n/);const findings:Array<{category:string;line:number;excerpt:string;cause:string;action:string}>=[];const seen=new Set<string>();
 lines.forEach((line,index)=>{for(const item of patterns){if(item.regex.test(line)){const key=`${item.category}:${line.trim()}`;if(!seen.has(key)){findings.push({category:item.category,line:index+1,excerpt:line.trim().slice(0,500),cause:item.cause,action:item.action});seen.add(key);}break;} }});
 return{linesAnalyzed:lines.length,findings:findings.slice(0,60),unclassified:findings.length===0,note:"Pattern-based triage only; the complete log and actual project remain authoritative."};
}
export function summarizeLcov(lcov:string,thresholdPercent=80){
 if(!Number.isFinite(thresholdPercent)||thresholdPercent<0||thresholdPercent>100)throw new Error("thresholdPercent must be between 0 and 100.");
 const files:Array<{file:string;covered:number;total:number;coveragePercent:number}>=[];let current:{file:string;covered:number;total:number}|null=null;
 for(const line of lcov.split(/\r?\n/)){if(line.startsWith("SF:")){if(current)files.push({...current,coveragePercent:current.total?current.covered/current.total*100:0});current={file:line.slice(3).trim(),covered:0,total:0};}
 else if(current&&line.startsWith("DA:")){const hit=Number(line.slice(3).split(",")[1]);if(Number.isFinite(hit)){current.total++;if(hit>0)current.covered++;}}}
 if(current)files.push({...current,coveragePercent:current.total?current.covered/current.total*100:0});const coveredLines=files.reduce((sum,file)=>sum+file.covered,0);const executableLines=files.reduce((sum,file)=>sum+file.total,0);
 return{lineCoveragePercent:executableLines?coveredLines/executableLines*100:0,coveredLines,executableLines,files:files.sort((a,b)=>a.coveragePercent-b.coveragePercent),belowThreshold:files.filter(file=>file.total>0&&file.coveragePercent<thresholdPercent).map(file=>file.file)};
}
function parseArb(text:string,label:string):Record<string,unknown>{try{const value:unknown=JSON.parse(text);if(!value||typeof value!=="object"||Array.isArray(value))throw new Error();return value as Record<string,unknown>;}catch{throw new Error(`${label} must be a valid ARB JSON object.`);}}
function placeholders(value:unknown):string[]{if(typeof value!=="string")return[];return[...value.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map(match=>match[1]).sort();}
export function checkLocalizations(baseText:string,localized:Record<string,string>){
 const base=parseArb(baseText,"base ARB");const baseKeys=Object.keys(base).filter(key=>!key.startsWith("@")&&key!=="@@locale");
 const reports=Object.entries(localized).map(([locale,text])=>{const target=parseArb(text,`ARB for ${locale}`);const keys=Object.keys(target).filter(key=>!key.startsWith("@")&&key!=="@@locale");const missing=baseKeys.filter(key=>!(key in target));const extra=keys.filter(key=>!(key in base));
 const placeholderMismatches=baseKeys.filter(key=>key in target&&JSON.stringify(placeholders(base[key]))!==JSON.stringify(placeholders(target[key]))).map(key=>({key,expected:placeholders(base[key]),actual:placeholders(target[key])}));
 return{locale,baseKeyCount:baseKeys.length,translatedKeyCount:keys.length,missing,extra,placeholderMismatches,complete:missing.length===0&&placeholderMismatches.length===0};});return{baseKeyCount:baseKeys.length,reports};
}
export function auditAndroidFiles(manifest:string,gradle=""):Finding[]{
 const findings:Finding[]=[];const add=(severity:Finding["severity"],title:string,evidence:string,recommendation:string)=>findings.push({severity,title,evidence,recommendation});
 if(/android:usesCleartextTraffic\s*=\s*"true"/i.test(manifest))add("high","Cleartext HTTP is allowed",'android:usesCleartextTraffic="true"',"Prefer HTTPS. If needed, scope exceptions to explicit domains using Network Security Configuration.");
 if(/android:debuggable\s*=\s*"true"/i.test(manifest)||/debuggable\s+true/i.test(gradle))add("high","Debuggable build flag appears enabled","A debuggable=true setting was found.","Ensure release variants are not debuggable and verify the merged release manifest.");
 if(/android:allowBackup\s*=\s*"true"/i.test(manifest))add("medium","Application backup is enabled",'android:allowBackup="true"',"Review data backup rules and whether app data can be exported.");
 if(/android:exported\s*=\s*"true"/i.test(manifest))add("medium","At least one component is exported",'android:exported="true"',"Review every exported component and its intent filters/permissions.");
 if(/uses-permission[^>]+WRITE_EXTERNAL_STORAGE/i.test(manifest))add("medium","Legacy external-storage write permission","WRITE_EXTERNAL_STORAGE appears in manifest.","Check whether scoped storage or the Storage Access Framework removes the need.");
 if(/uses-permission[^>]+READ_PHONE_STATE/i.test(manifest))add("medium","Phone-state permission requested","READ_PHONE_STATE appears in manifest.","Confirm the permission is essential to user-facing functionality.");
 if(!/android:usesCleartextTraffic|networkSecurityConfig/i.test(manifest))add("info","Network policy not explicit","No explicit network security setting was found in supplied snippet.","Inspect the complete merged manifest and decide whether a network-security config is needed.");
 return findings;
}
export function auditAccessibility(files:Array<{path:string;source:string}>){
 const findings:Array<{file:string;line:number;issue:string;evidence:string;recommendation:string}>=[];
 for(const file of files){file.source.split(/\r?\n/).forEach((line,index)=>{
 if (/\bIconButton\s*\(/.test(line) && !/tooltip:|Tooltip\s*\(/.test(line)) findings.push({file:file.path,line:index+1,issue:"IconButton may lack a tooltip/accessible label",evidence:line.trim().slice(0,240),recommendation:"Provide a Tooltip and meaningful semantic label; verify the final widget tree."});
 if (/\bGestureDetector\s*\(/.test(line) && !/\bSemantics\s*\(/.test(line)) findings.push({file:file.path,line:index+1,issue:"GestureDetector may miss semantic affordances",evidence:line.trim().slice(0,240),recommendation:"Check keyboard activation, focus behavior, and Semantics/InkWell usage."});
 if(/Image\.asset\(|Image\.network\(/.test(line)&&!/semanticLabel:/.test(line))findings.push({file:file.path,line:index+1,issue:"Image may lack a semantic label",evidence:line.trim().slice(0,240),recommendation:"Add semanticLabel for meaningful images or exclude decorative imagery from semantics."});
 if(/Color\(0x[0-9A-Fa-f]{8}\)/.test(line))findings.push({file:file.path,line:index+1,issue:"Hard-coded color: contrast has not been verified",evidence:line.trim().slice(0,240),recommendation:"Measure foreground/background contrast; this pattern alone does not prove a failure."});
 });}return{filesScanned:files.length,findings,note:"Heuristic source scan only. Confirm with Flutter accessibility tests and manual screen-reader/keyboard checks."};
}