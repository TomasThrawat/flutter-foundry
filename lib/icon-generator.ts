export type IconStyle = "auto" | "minimal" | "geometric" | "rounded" | "outline" | "pixel" | "abstract";
export type IconGenerationInput = {
  prompt: string; style?: IconStyle; size?: number;
  backgroundColor?: string; foregroundColor?: string; accentColor?: string;
};
export type IconGenerationResult = {
  prompt: string; concept: string; style: Exclude<IconStyle,"auto">; size: number;
  colors: { background: string; foreground: string; accent: string };
  generationMode: "procedural-svg"; noTemplateAssetsUsed: true; svgMarkup: string; notes: string[];
};
const COLORS: Record<string,string> = {
  black:"#000000",white:"#ffffff",red:"#ef4444",blue:"#2563eb",green:"#16a34a",purple:"#7c3aed",violet:"#7c3aed",
  orange:"#f97316",yellow:"#eab308",pink:"#ec4899",cyan:"#06b6d4",teal:"#0d9488",navy:"#1e3a8a",gold:"#d4a72c",
  gray:"#6b7280",grey:"#6b7280",silver:"#9ca3af",brown:"#92400e",lime:"#65a30d",magenta:"#c026d3",indigo:"#4f46e5",
  "أسود":"#000000","سوداء":"#000000","أبيض":"#ffffff","بيضاء":"#ffffff","أحمر":"#ef4444","حمراء":"#ef4444",
  "أزرق":"#2563eb","زرقاء":"#2563eb","أخضر":"#16a34a","خضراء":"#16a34a","بنفسجي":"#7c3aed","برتقالي":"#f97316","أصفر":"#eab308","وردي":"#ec4899"
};
function color(value:string|undefined,fallback:string,transparent=false):string {
  if(!value||!value.trim())return fallback;
  const v=value.trim().toLowerCase();
  if(transparent&&(v==="transparent"||v==="none"))return "transparent";
  if(COLORS[v])return COLORS[v];
  if(/^#[0-9a-f]{3}$/i.test(v))return "#"+v[1]+v[1]+v[2]+v[2]+v[3]+v[3];
  if(/^#[0-9a-f]{6}$/i.test(v))return v;
  throw new Error("Unsupported color '"+value+"'. Use a named color or hex such as #111111.");
}
function light(c:string):boolean { if(c==="transparent")return false;const s=c.slice(1);return .2126*parseInt(s.slice(0,2),16)+.7152*parseInt(s.slice(2,4),16)+.0722*parseInt(s.slice(4,6),16)>150; }
function hash(s:string):number { let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0; }
function rng(seed:number):()=>number {let s=seed>>>0;return()=>{s+=0x6D2B79F5;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
function inferColor(p:string,role:"background"|"foreground"|"accent"):string|undefined {
  const lower=p.toLowerCase();
  const words=Object.keys(COLORS).filter(x=>/^[a-z]+$/.test(x)).sort((a,b)=>b.length-a.length);
  if(role==="background"){
    const m=lower.match(/(?:background|backdrop|bg).{0,24}(black|white|red|blue|green|purple|violet|orange|yellow|pink|cyan|teal|navy|gold|gray|grey|silver|brown|lime|magenta|indigo)|(?:black|white|red|blue|green|purple|violet|orange|yellow|pink|cyan|teal|navy|gold|gray|grey|silver|brown|lime|magenta|indigo).{0,18}(?:background|backdrop|bg)/i);
    if(m){const w=words.find(x=>m[0].includes(x));if(w)return COLORS[w];}
    for(const w of Object.keys(COLORS).filter(x=>! /^[a-z]+$/.test(x)))if(/خلفية/.test(lower)&&lower.includes(w))return COLORS[w];
    return undefined;
  }
  if(role==="foreground"){
    const m=lower.match(new RegExp("\\b("+words.join("|")+")\\b.{0,18}\\b(icon|symbol|logo|foreground|shape|mark)\\b|\\b(icon|symbol|logo|foreground|shape|mark)\\b.{0,18}\\b("+words.join("|")+")\\b","i"));
    if(m){const w=(m[1]||m[4]||"").toLowerCase();if(COLORS[w])return COLORS[w];}
    return undefined;
  }
  const accentMatch=lower.match(new RegExp("\\b("+words.join("|")+")\\b.{0,16}\\baccent\\b|\\baccent\\b.{0,16}\\b("+words.join("|")+")\\b","i"));
  if(accentMatch){const w=(accentMatch[1]||accentMatch[2]||"").toLowerCase();return COLORS[w];}
  return undefined;
}
function conceptOf(p:string):string {
  const rules:Array<[string,RegExp]>=[
    ["qr-code",/(?:\bqr\b|qr[- ]?code|barcode|باركود|كيو\s*آر)/i],
    ["camera",/(?:camera|photo|photography|picture|كاميرا|تصوير|صورة)/i],
    ["calculator",/(?:calculator|math|arithmetic|آلة حاسبة|حاسبة)/i],
    ["weather",/(?:weather|sunny|cloud|rain|storm|forecast|طقس|شمس|سحاب|مطر)/i],
    ["shield",/(?:shield|security|secure|protection|lock|privacy|درع|حماية|قفل)/i],
    ["location",/(?:location|map pin|navigation|gps|compass|موقع|خريطة|ملاحة|بوصلة)/i],
    ["chat",/(?:chat|message|speech bubble|messenger|محادثة|رسالة|دردشة)/i],
    ["code",/(?:coding|developer|terminal|programming|code editor|code|برمجة|كود|طرفية)/i],
    ["heart",/(?:heart|health|medical|wellness|قلب|صحة|طبي)/i],
    ["leaf",/(?:leaf|plant|nature|eco|environment|ورقة شجر|نبات|طبيعة)/i],
    ["rocket",/(?:rocket|launch|space|startup|صاروخ|إطلاق|فضاء)/i],
    ["book",/(?:book|reading|library|pages|كتاب|قراءة|مكتبة)/i],
    ["mail",/(?:email|e-mail|mail|envelope|inbox|بريد|إيميل)/i],
    ["search",/(?:search|find|magnifier|بحث|تكبير)/i],
    ["settings",/(?:settings|gear|cog|preferences|إعدادات|ترس)/i],
    ["wifi",/(?:wi-?fi|wireless|network|signal|واي\s*فاي|شبكة|إشارة)/i],
    ["battery",/(?:battery|charging|بطارية|شحن)/i],
    ["clock",/(?:clock|time|timer|watch|ساعة|وقت|مؤقت)/i],
    ["calendar",/(?:calendar|schedule|date|تقويم|جدول|تاريخ)/i],
    ["folder",/(?:folder|files|directory|ملفات|مجلد)/i],
    ["cart",/(?:shopping cart|cart|basket|store|shop|عربة تسوق|متجر|سلة)/i],
    ["music",/(?:music|audio|sound|headphones|note|موسيقى|صوت|سماعة|نغمة)/i],
    ["home",/(?:\bhome\b|house|building|منزل|بيت)/i],
    ["user",/(?:profile|user|account|person|avatar|حساب|شخص|ملف شخصي)/i],
    ["ai",/(?:\bai\b|artificial intelligence|brain|neural|sparkle|magic|intelligence|ذكاء اصطناعي|دماغ|نجمة|سحر)/i],
    ["flower",/(?:flower|blossom|petal|floral|زهرة|وردة|بتلة)/i]
  ];
  for(const [name,re] of rules)if(re.test(p))return name;
  return "abstract";
}
function escapeXml(s:string):string{return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");}

export function generateIconFromPrompt(input:IconGenerationInput):IconGenerationResult {
  const prompt=input.prompt.trim();
  if(prompt.length<3)throw new Error("Describe the icon in at least 3 characters.");
  if(prompt.length>500)throw new Error("Prompt exceeds the 500-character limit.");
  const size=input.size??512;
  if(!Number.isInteger(size)||size<128||size>1024)throw new Error("Icon size must be an integer from 128 to 1024.");
  const bg= color(input.backgroundColor,inferColor(prompt,"background")||(/transparent|شفاف/i.test(prompt)?"transparent":"#000000"),true);
  const fg=color(input.foregroundColor,inferColor(prompt,"foreground")||(bg==="transparent"?"#111827":light(bg)?"#111827":"#ffffff"));
  const accent=color(input.accentColor,inferColor(prompt,"accent")||fg);
  const negative=bg!=="transparent"?bg:(light(fg)?"#000000":"#ffffff");
  const lower=prompt.toLowerCase(),random=rng(hash(lower)),concept=conceptOf(prompt);
  let style:Exclude<IconStyle,"auto">=input.style&&input.style!=="auto"?input.style:"geometric";
  if(!input.style||input.style==="auto"){
    if(/\b(pixel|8-bit)\b|pixel art|بيكسل/i.test(lower))style="pixel";
    else if(/\boutline\b|outlined|line art|خطوط فقط|مخطط/i.test(lower))style="outline";
    else if(/\brounded\b|round corners|soft corners|مستدير|حواف ناعمة/i.test(lower))style="rounded";
    else if(/\bminimal\b|minimalist|simple|بسيط|بسيطة/i.test(lower))style="minimal";
    else if(/\babstract\b|nonfigurative|تجريدي/i.test(lower))style="abstract";
  }
  const outline=style==="outline",radius=style==="rounded"?22:style==="minimal"?6:style==="pixel"?0:12;
  const s:string[]=[];
  const rect=(x:number,y:number,w:number,h:number,fill:string,rx=0,stroke="none",sw=0)=>s.push("<rect x=\""+x+"\" y=\""+y+"\" width=\""+w+"\" height=\""+h+"\" fill=\""+fill+"\""+(rx?" rx=\""+rx+"\"":"")+(stroke!=="none"?" stroke=\""+stroke+"\" stroke-width=\""+sw+"\"":"")+"/>");
  const circle=(x:number,y:number,r:number,fill:string,stroke="none",sw=0)=>s.push("<circle cx=\""+x+"\" cy=\""+y+"\" r=\""+r+"\" fill=\""+fill+"\""+(stroke!=="none"?" stroke=\""+stroke+"\" stroke-width=\""+sw+"\"":"")+"/>");
  const path=(d:string,fill="none",stroke="none",sw=0)=>s.push("<path d=\""+d+"\" fill=\""+fill+"\""+(stroke!=="none"?" stroke=\""+stroke+"\" stroke-width=\""+sw+"\" stroke-linecap=\"round\" stroke-linejoin=\"round\"":"")+"/>");
  const line=(x1:number,y1:number,x2:number,y2:number,c:string,w:number)=>s.push("<line x1=\""+x1+"\" y1=\""+y1+"\" x2=\""+x2+"\" y2=\""+y2+"\" stroke=\""+c+"\" stroke-width=\""+w+"\" stroke-linecap=\"round\"/>");
  const poly=(points:string,fill:string,stroke="none",sw=0)=>s.push("<polygon points=\""+points+"\" fill=\""+fill+"\""+(stroke!=="none"?" stroke=\""+stroke+"\" stroke-width=\""+sw+"\" stroke-linejoin=\"round\"":"")+"/>");
  const main=outline?"none":fg,edge=outline?fg:"none",ew=outline?15:0;

  if(concept==="qr-code"){
    const cell=16,start=88, reserved=(r:number,c:number)=>(r<7&&c<7)||(r<7&&c>=14)||(r>=14&&c<7)||(r>=14&&r<=18&&c>=14&&c<=18)||r===6||c===6;
    for(let r=0;r<21;r++)for(let c=0;c<21;c++){if(reserved(r,c)||random()<(style==="minimal"?.62:.51))continue;const d=style==="pixel"?14:style==="rounded"?12:11;if(style==="abstract")circle(start+c*cell+8,start+r*cell+8,5.8,fg);else rect(start+c*cell+(16-d)/2,start+r*cell+(16-d)/2,d,d,fg,style==="rounded"?4:0);}
    for(const [r,c] of [[0,0],[0,14],[14,0]]){const x=start+c*cell,y=start+r*cell;rect(x,y,112,112,fg);rect(x+16,y+16,80,80,negative);rect(x+32,y+32,48,48,fg);}
    const ax=start+14*cell,ay=start+14*cell;rect(ax,ay,80,80,fg,radius);rect(ax+16,ay+16,48,48,negative,radius/2);rect(ax+32,ay+32,16,16,accent);
    for(let i=8;i<13;i+=2){rect(start+i*cell,start+6*cell,cell,cell,fg);rect(start+6*cell,start+i*cell,cell,cell,fg);}
    if(accent!==fg)rect(242,242,28,28,accent,radius);
  } else if(concept==="camera"){
    rect(98,178,316,224,main,radius+8,edge,ew);rect(154,132,92,56,main,radius,edge,ew);
    circle(260,286,86,outline?"none":negative,outline?fg:"none",outline?14:0);circle(260,286,63,"none",accent,15);circle(260,286,32,outline?"none":fg,outline?fg:"none",outline?12:0);circle(360,222,14,accent);
  } else if(concept==="calculator"){
    rect(132,72,248,368,main,radius+8,edge,ew);rect(164,110,184,66,outline?"none":negative,radius);
    for(let r=0;r<3;r++)for(let c=0;c<3;c++)rect(164+c*60,208+r*61,42,42,(r===2&&c===2)||(r===0&&c===2)?accent:main,style==="rounded"?12:7,edge,outline?8:0);
    rect(164,391,102,24,main,7,edge,outline?8:0);rect(286,391,42,24,accent,7,edge,outline?8:0);
  } else if(concept==="weather"){
    circle(196,188,62,outline?"none":accent,outline?fg:"none",outline?12:0);for(let i=0;i<8;i++){const a=i*Math.PI/4;line(196+Math.cos(a)*78,188+Math.sin(a)*78,196+Math.cos(a)*96,188+Math.sin(a)*96,accent,10);}
    path("M126 360 C86 360 76 334 90 307 C100 287 120 278 143 282 C157 233 217 222 248 263 C285 236 334 254 340 293 C377 290 401 314 398 340 C396 363 374 376 350 376 L126 376 Z",main,edge,ew);
  } else if(concept==="shield"){
    path("M256 64 L402 122 L386 282 C370 352 322 411 256 450 C190 411 142 352 126 282 L110 122 Z",main,edge,ew);path("M178 255 L234 311 L335 203","none",accent,23);
  } else if(concept==="location"){
    path("M256 444 C226 393 142 311 142 222 C142 155 192 105 256 105 C320 105 370 155 370 222 C370 311 286 393 256 444 Z",main,edge,ew);circle(256,220,57,outline?"none":negative,outline?fg:"none",outline?14:0);circle(256,220,23,accent);path("M174 323 L220 365 M338 323 L292 365","none",accent,9);
  } else if(concept==="chat"){
    path("M104 112 Q104 92 126 92 H386 Q408 92 408 114 V306 Q408 328 386 328 H244 L165 400 V328 H126 Q104 328 104 306 Z",main,edge,ew);circle(178,211,17,outline?fg:negative);circle(256,211,17,outline?fg:negative);circle(334,211,17,outline?fg:negative);
  } else if(concept==="code"){
    path("M202 154 L104 256 L202 358","none",fg,27);path("M310 154 L408 256 L310 358","none",fg,27);path("M282 126 L230 386","none",accent,23);
  } else if(concept==="heart"){
    path("M256 414 C218 379 105 291 105 194 C105 136 146 101 196 101 C226 101 248 118 256 141 C264 118 286 101 316 101 C366 101 407 136 407 194 C407 291 294 379 256 414 Z",outline?"none":accent,outline?fg:"none",outline?17:0);
  } else if(concept==="leaf"){
    path("M112 356 C112 190 237 82 405 102 C407 270 296 400 132 398 C186 334 248 264 339 176 C269 228 207 281 112 356 Z",outline?"none":accent,outline?fg:"none",outline?16:0);path("M142 365 C201 298 267 235 354 161","none",outline?accent:negative,12);path("M235 278 L232 212 M282 232 L340 234","none",outline?fg:negative,10);
  } else if(concept==="rocket"){
    path("M256 70 C322 110 358 186 352 267 L291 333 L221 333 L160 267 C154 186 190 110 256 70 Z",main,edge,ew);circle(256,211,33,outline?"none":negative,outline?fg:"none",outline?12:0);
    path("M160 251 L102 309 L111 369 L202 326 Z M352 251 L410 309 L401 369 L310 326 Z",outline?"none":accent,outline?fg:"none",outline?12:0);path("M222 333 L226 389 L256 424 L286 389 L290 333 Z",outline?"none":accent,outline?fg:"none",outline?12:0);
  } else if(concept==="book"){
    path("M86 126 Q168 96 250 148 V388 Q168 336 86 366 Z",main,edge,ew);path("M426 126 Q344 96 262 148 V388 Q344 336 426 366 Z",main,edge,ew);line(256,150,256,389,negative,10);
    for(let i=0;i<3;i++){line(118,202+i*43,216,202+i*43,outline?fg:negative,8);line(296,202+i*43,394,202+i*43,outline?fg:negative,8);}
  } else if(concept==="mail"){
    rect(82,140,348,238,main,radius+4,edge,ew);path("M100 169 L256 294 L412 169","none",outline?fg:negative,17);path("M105 352 L205 263 M407 352 L307 263","none",outline?fg:negative,13);circle(355,170,18,accent);
  } else if(concept==="search"){
    circle(220,218,111,"none",fg,22);line(301,300,403,402,accent,29);circle(220,218,51,outline?"none":(accent===fg?negative:accent),outline?accent:"none",outline?12:0);
  } else if(concept==="settings"){
    const pts:string[]=[];for(let i=0;i<24;i++){const a=i*Math.PI/12-Math.PI/2,rr=i%2===0?150:119;pts.push((256+Math.cos(a)*rr).toFixed(1)+","+(256+Math.sin(a)*rr).toFixed(1));}poly(pts.join(" "),main,edge,ew);circle(256,256,64,outline?"none":negative,outline?fg:"none",outline?15:0);circle(256,256,25,accent);
  } else if(concept==="wifi"){
    path("M94 190 Q256 54 418 190","none",fg,25);path("M145 246 Q256 152 367 246","none",accent,23);path("M198 303 Q256 253 314 303","none",fg,22);circle(256,356,19,accent);
  } else if(concept==="battery"){
    rect(90,152,332,216,main,radius+4,edge,ew);rect(422,218,29,84,fg,8);const fw=80+Math.floor(random()*3)*58;rect(122,184,fw,152,accent,Math.min(radius,12));if(fw<260)rect(122+fw+12,184,15,152,negative,4);
  } else if(concept==="clock"){
    circle(256,256,166,main,fg,outline?17:12);line(256,256,256,160,accent,20);line(256,256,329,294,fg,17);circle(256,256,15,accent);
  } else if(concept==="calendar"){
    rect(104,108,304,306,main,radius+3,edge,ew);rect(104,108,304,78,accent,radius+3);line(178,82,178,137,fg,18);line(334,82,334,137,fg,18);
    for(let r=0;r<3;r++)for(let c=0;c<4;c++)if(!((r===1&&c===2)||(r===2&&c===1)))circle(159+c*65,238+r*54,8,outline?fg:negative);
  } else if(concept==="folder"){
    path("M78 160 H203 L241 202 H434 Q450 202 450 220 V360 Q450 380 430 380 H93 Q74 380 74 360 V181 Q74 160 78 160 Z",main,edge,ew);path("M76 231 H448","none",outline?fg:accent,13);
  } else if(concept==="cart"){
    path("M78 112 H126 L165 306 H371 L418 172 H146","none",fg,23);line(166,306,376,306,accent,17);circle(207,370,23,accent);circle(354,370,23,accent);
  } else if(concept==="music"){
    line(156,152,156,337,fg,20);line(156,152,350,110,accent,17);line(350,110,350,297,fg,20);circle(125,347,34,accent);circle(319,307,34,fg);path("M350 110 Q415 142 384 191","none",accent,15);
  } else if(concept==="home"){
    path("M76 244 L256 91 L436 244",outline?"none":accent,outline?fg:"none",outline?20:0);path("M118 224 V419 H394 V224",main,edge,ew);rect(222,300,68,119,outline?"none":negative,7,outline?fg:"none",outline?12:0);rect(148,261,47,48,outline?"none":negative,6,outline?fg:"none",outline?10:0);rect(318,261,47,48,outline?"none":negative,6,outline?fg:"none",outline?10:0);
  } else if(concept==="user"){
    circle(256,169,72,main,edge,ew);path("M108 430 C116 329 180 284 256 284 C332 284 396 329 404 430 Z",main,edge,ew);
  } else if(concept==="ai"){
    circle(256,256,136,"none",accent,12);circle(256,256,89,"none",fg,10);path("M256 198 L270 241 L314 256 L270 271 L256 314 L242 271 L198 256 L242 241 Z",accent);path("M126 104 L134 126 L156 134 L134 142 L126 164 L118 142 L96 134 L118 126 Z",fg);path("M386 332 L394 354 L416 362 L394 370 L386 392 L378 370 L356 362 L378 354 Z",fg);circle(378,133,10,accent);
  } else if(concept==="flower"){
    const petals=8+Math.floor(random()*5);for(let i=0;i<petals;i++){const a=i*Math.PI*2/petals,x=256+Math.cos(a)*84,y=256+Math.sin(a)*84,rot=a*180/Math.PI;s.push("<ellipse cx=\""+x.toFixed(1)+"\" cy=\""+y.toFixed(1)+"\" rx=\"45\" ry=\"70\" fill=\""+(i%2===0?accent:fg)+"\" transform=\"rotate("+rot.toFixed(1)+" "+x.toFixed(1)+" "+y.toFixed(1)+")\"/>");}circle(256,256,45,negative,accent,12);circle(256,256,15,accent);
  } else {
    const sides=7+Math.floor(random()*4),pts:string[]=[];for(let i=0;i<sides;i++){const a=-Math.PI/2+i*Math.PI*2/sides,rr=104+random()*48;pts.push((256+Math.cos(a)*rr).toFixed(1)+","+(256+Math.sin(a)*rr).toFixed(1));}poly(pts.join(" "),outline?"none":accent,fg,outline?15:8);
    for(let i=0;i<4;i++){const a=i*Math.PI/2+random()*.3,x=256+Math.cos(a)*62,y=256+Math.sin(a)*62;circle(x,y,22+random()*7,outline?"none":fg,outline?fg:"none",outline?9:0);}circle(256,256,28+random()*10,negative,accent,12);
    if(style==="abstract"||style==="geometric")for(let i=0;i<3;i++)circle(92+random()*328,92+random()*328,5+random()*6,accent);
  }
  const backgroundMarkup=bg==="transparent"?"":"<rect width=\"512\" height=\"512\" fill=\""+bg+"\"/>";
  const svgMarkup="<svg xmlns=\"http://www.w3.org/2000/svg\" width=\""+size+"\" height=\""+size+"\" viewBox=\"0 0 512 512\" shape-rendering=\""+(style==="pixel"?"crispEdges":"geometricPrecision")+"\"><title>"+escapeXml(prompt.slice(0,120))+"</title>"+backgroundMarkup+s.join("")+"</svg>";
  return {prompt,concept,style,size,colors:{background:bg,foreground:fg,accent},generationMode:"procedural-svg",noTemplateAssetsUsed:true,svgMarkup,notes:[
    "The artwork is synthesized from vector primitives and a prompt-derived seed; no preset SVG files or image API are used.",
    "QR-themed output is a visual motif, not a scannable QR payload. Use a QR encoder when machine-readable codes are required."
  ]};
}
