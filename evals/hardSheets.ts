// The hard ones: built like the homework students actually get, not like a clean test page.
//  1. d2l-quiz      a quiz inside an embedded frame with its own scrollbar, inside a portal page (D2L Brightspace style)
//  2. google-form   Google Forms look: custom bubbles and checkboxes (not real inputs), a custom dropdown list,
//                   underline-only text boxes, required stars, an email field
//  3. math-editor   math answer boxes (contenteditable, like WebAssign / MyLab), a two-box fraction, exponents
//  4. multi-page    one question per page with a Next button, the answers kept as you go
// Every page has window.__grade() -> { right, total, wrong, blank }.

export type HardSheet = { id: string; title: string; subject: string; ask: string; html: string };

const GRADER_UTIL = `const num=(s)=>{const t=String(s).trim().replace(/[^0-9.\\/-]/g,"");if(t.includes("/")){const[a,b]=t.split("/").map(Number);return b?a/b:NaN}return parseFloat(t)};
const same=(v,a)=>typeof a==="number"?Math.abs(num(v)-a)<0.011:String(v).trim().toLowerCase().replace(/[.\\s]+$/,"")===String(a).toLowerCase();`;

// ---------------------------------------------------------------------------------------------
const d2lInner = `<!DOCTYPE html><html><head><style>
body{font:15px/1.5 Lato,Arial,sans-serif;color:#202122;margin:0;padding:16px 20px;background:#fff}
.qbox{border:1px solid #d3d9e3;border-radius:6px;margin:0 0 16px;padding:0}
.qhead{background:#f1f5fb;border-bottom:1px solid #d3d9e3;padding:8px 14px;font-weight:700;display:flex;justify-content:space-between}
.qbody{padding:14px}.qbody p{margin:0 0 10px}
label{display:block;padding:5px 0}input[type=text]{font:15px Arial;padding:6px 8px;border:1px solid #7c7c7c;border-radius:3px;width:200px}
.pts{font-weight:400;color:#6e7376}
</style></head><body>
<div class="qbox"><div class="qhead"><span>Question 1</span><span class="pts">2 points</span></div><div class="qbody"><p>Which sampling method gives every member of the population an equal chance of being selected?</p>
<label><input type="radio" name="q1" value="0"> Convenience sample</label><label><input type="radio" name="q1" value="1"> Simple random sample</label><label><input type="radio" name="q1" value="2"> Voluntary response sample</label></div></div>
<div class="qbox"><div class="qhead"><span>Question 2</span><span class="pts">2 points</span></div><div class="qbody"><p>Data: 2, 4, 4, 4, 5, 5, 7, 9. What is the mode?</p><input type="text" id="q2"></div></div>
<div class="qbox"><div class="qhead"><span>Question 3</span><span class="pts">2 points</span></div><div class="qbody"><p>A variable that can take any value in a range (like height) is:</p>
<label><input type="radio" name="q3" value="0"> Categorical</label><label><input type="radio" name="q3" value="1"> Discrete</label><label><input type="radio" name="q3" value="2"> Continuous</label></div></div>
<div class="qbox"><div class="qhead"><span>Question 4</span><span class="pts">2 points</span></div><div class="qbody"><p>The standard deviation of 2, 4, 4, 4, 5, 5, 7, 9 (population) is:</p><input type="text" id="q4"></div></div>
<div class="qbox"><div class="qhead"><span>Question 5</span><span class="pts">2 points</span></div><div class="qbody"><p>Check ALL that are measures of spread.</p>
<label><input type="checkbox" name="q5" value="0"> Range</label><label><input type="checkbox" name="q5" value="1"> Mean</label><label><input type="checkbox" name="q5" value="2"> Standard deviation</label><label><input type="checkbox" name="q5" value="3"> Interquartile range</label><label><input type="checkbox" name="q5" value="4"> Mode</label></div></div>
<div class="qbox"><div class="qhead"><span>Question 6</span><span class="pts">2 points</span></div><div class="qbody"><p>If P(A) = 0.4, what is P(not A)?</p><input type="text" id="q6"></div></div>
<div class="qbox"><div class="qhead"><span>Question 7</span><span class="pts">2 points</span></div><div class="qbody"><p>A correlation of r = −0.92 shows a relationship that is:</p>
<label><input type="radio" name="q7" value="0"> Strong and negative</label><label><input type="radio" name="q7" value="1"> Weak and negative</label><label><input type="radio" name="q7" value="2"> Strong and positive</label></div></div>
<p style="color:#6e7376">End of questions. Use “Submit Quiz” at the bottom of the page when you’re done.</p>
</body></html>`;

const d2l = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Quiz 6 - Statistical Analysis</title><style>
body{margin:0;font:15px/1.5 Lato,Arial,sans-serif;background:#f6f7f8;color:#202122}
.top{background:#fff;border-bottom:1px solid #d3d9e3;height:56px;display:flex;align-items:center;padding:0 24px;gap:20px}
.logo{font-weight:800;color:#4d2d73}.nav{background:#4d2d73;color:#fff;display:flex;gap:28px;padding:10px 24px;font-size:14px}
.wrap{max-width:1000px;margin:20px auto;background:#fff;border:1px solid #d3d9e3;border-radius:6px;padding:20px 24px}
h1{font-size:24px;margin:0 0 4px}.info{color:#6e7376;font-size:14px;margin-bottom:14px;display:flex;gap:24px}
.timer{float:right;background:#fff4e5;border:1px solid #f0c36d;padding:4px 10px;border-radius:4px;font-size:13px}
iframe{width:100%;height:520px;border:1px solid #d3d9e3;border-radius:4px}
.foot{display:flex;gap:10px;justify-content:flex-end;margin-top:14px}button{font:600 14px Arial;padding:9px 16px;border-radius:4px;border:1px solid #4d2d73;background:#fff;color:#4d2d73}
button.sub{background:#4d2d73;color:#fff}
</style></head><body>
<div class="top"><span class="logo">TCU Online</span><span>Statistical Analysis 035</span></div>
<div class="nav"><span>Course Home</span><span>Content</span><span>Assessments</span><span>Grades</span><span>Classlist</span></div>
<div class="wrap"><span class="timer">Time left: 41:12</span><h1>Quiz 6: Describing Data</h1><div class="info"><span>Attempt 1 of 2</span><span>Written: Nov 24</span><span>7 questions</span></div>
<iframe id="quiz" title="Quiz questions"></iframe>
<div class="foot"><button>Save All Responses</button><button class="sub">Submit Quiz</button></div></div>
<script>
document.getElementById("quiz").srcdoc=${JSON.stringify(d2lInner)};
${GRADER_UTIL}
window.__grade=()=>{const d=document.getElementById("quiz").contentDocument;let right=0;const wrong=[],blank=[];
const r=(n,a)=>{const c=d.querySelector('input[name="'+n+'"]:checked');if(!c)return blank.push(n);+c.value===a?right++:wrong.push(n)};
const t=(id,a)=>{const v=d.getElementById(id).value;if(!v.trim())return blank.push(id);same(v,a)?right++:wrong.push(id)};
r("q1",1);t("q2",4);r("q3",2);t("q4",2);
const c=[...d.querySelectorAll('input[name="q5"]:checked')].map(e=>+e.value).sort().join();if(!c)blank.push("q5");else c==="0,2,3"?right++:wrong.push("q5");
t("q6",0.6);r("q7",0);return{right,total:7,wrong,blank}};
</script></body></html>`;

// ---------------------------------------------------------------------------------------------
const gform = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Psych 101 Check-In</title><style>
body{margin:0;background:#f0ebf8;font:15px/1.5 Roboto,Arial,sans-serif;color:#202124}
.f{max-width:640px;margin:12px auto 40px}.card{background:#fff;border:1px solid #dadce0;border-radius:8px;padding:24px;margin-top:12px}
.head{border-top:10px solid #673ab7}.head h1{font-size:30px;font-weight:400;margin:0 0 8px}.req{color:#d93025}
.q{font-size:16px;margin-bottom:16px}.u{border:0;border-bottom:1px solid #dadce0;font:15px Roboto,Arial;padding:6px 0;width:60%;outline:0}
.u:focus{border-bottom:2px solid #673ab7}.opt{display:flex;align-items:center;gap:12px;padding:8px 0;cursor:pointer;user-select:none}
.rad{width:20px;height:20px;border:2px solid #5f6368;border-radius:50%;box-sizing:border-box;display:grid;place-items:center}
.opt[aria-checked=true] .rad{border-color:#673ab7}.opt[aria-checked=true] .rad::after{content:"";width:10px;height:10px;border-radius:50%;background:#673ab7}
.box{width:18px;height:18px;border:2px solid #5f6368;border-radius:2px;box-sizing:border-box;display:grid;place-items:center;color:#fff;font-size:13px}
.opt[aria-checked=true] .box{background:#673ab7;border-color:#673ab7}.opt[aria-checked=true] .box::after{content:"✓"}
.dd{position:relative;display:inline-block}.ddb{border:1px solid #dadce0;border-radius:4px;padding:10px 40px 10px 14px;min-width:200px;cursor:pointer;background:#fff}
.ddl{display:none;position:absolute;top:0;left:0;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.25);border-radius:4px;z-index:5;min-width:240px}
.dd.open .ddl{display:block}.ddo{padding:10px 16px;cursor:pointer}.ddo:hover{background:#f1f3f4}
.sub{background:#673ab7;color:#fff;border:0;border-radius:4px;padding:9px 24px;font:500 14px Roboto,Arial;margin-top:16px}
</style></head><body><div class="f">
<div class="card head"><h1>Psych 101: Week 12 Check-In</h1><div>Answer every question. <span class="req">* Indicates required question</span></div></div>
<div class="card"><div class="q">Email <span class="req">*</span></div><input class="u" id="email" placeholder="Your email"></div>
<div class="card"><div class="q">Full name <span class="req">*</span></div><input class="u" id="name" placeholder="Your answer"></div>
<div class="card"><div class="q">Who is known for classical conditioning (the dog experiments)? <span class="req">*</span></div>
<div role="radiogroup" data-q="g1">${["B. F. Skinner", "Ivan Pavlov", "Sigmund Freud", "Jean Piaget"].map((o, i) => `<div class="opt" role="radio" aria-checked="false" data-v="${i}"><span class="rad"></span>${o}</div>`).join("")}</div></div>
<div class="card"><div class="q">Which of these are parts of the brain? (Select all that apply) <span class="req">*</span></div>
<div data-q="g2">${["Hippocampus", "Amygdala", "Pancreas", "Cerebellum"].map((o, i) => `<div class="opt" role="checkbox" aria-checked="false" data-v="${i}"><span class="box"></span>${o}</div>`).join("")}</div></div>
<div class="card"><div class="q">Piaget's first stage of cognitive development is the ____ stage. <span class="req">*</span></div>
<div class="dd" id="g3"><div class="ddb" data-v="">Choose</div><div class="ddl">${["Choose", "Sensorimotor", "Preoperational", "Concrete operational", "Formal operational"].map((o, i) => `<div class="ddo" data-v="${i}">${o}</div>`).join("")}</div></div></div>
<div class="card"><div class="q">What does the abbreviation REM stand for in "REM sleep"? <span class="req">*</span></div><input class="u" id="g4" placeholder="Your answer"></div>
<div class="card"><div class="q">On a scale of 1–5, how confident do you feel about the exam? (pick 4)</div>
<div role="radiogroup" data-q="g5" style="display:flex;gap:18px">${[1, 2, 3, 4, 5].map((n) => `<div class="opt" role="radio" aria-checked="false" data-v="${n}" style="flex-direction:column;gap:4px">${n}<span class="rad"></span></div>`).join("")}</div></div>
<button class="sub">Submit</button></div>
<script>
document.querySelectorAll('[role=radiogroup]').forEach(g=>g.addEventListener("click",e=>{const o=e.target.closest(".opt");if(!o)return;g.querySelectorAll(".opt").forEach(x=>x.setAttribute("aria-checked","false"));o.setAttribute("aria-checked","true")}));
document.querySelectorAll('[data-q=g2] .opt').forEach(o=>o.addEventListener("click",()=>o.setAttribute("aria-checked",o.getAttribute("aria-checked")==="true"?"false":"true")));
const dd=document.getElementById("g3");dd.querySelector(".ddb").addEventListener("click",()=>dd.classList.add("open"));
dd.querySelectorAll(".ddo").forEach(o=>o.addEventListener("click",e=>{e.stopPropagation();const b=dd.querySelector(".ddb");b.textContent=o.textContent;b.dataset.v=o.dataset.v;dd.classList.remove("open")}));
document.addEventListener("click",e=>{if(!dd.contains(e.target))dd.classList.remove("open")});
${GRADER_UTIL}
window.__grade=()=>{let right=0;const wrong=[],blank=[];
const t=(id,ok)=>{const v=document.getElementById(id).value.trim();if(!v)return blank.push(id);ok(v)?right++:wrong.push(id)};
t("email",v=>/^[^@\\s]+@[^@\\s]+\\.[a-z]{2,}$/i.test(v));t("name",v=>/jake/i.test(v));
const one=(q,a)=>{const c=document.querySelector('[data-q='+q+'] [aria-checked=true]');if(!c)return blank.push(q);+c.dataset.v===a?right++:wrong.push(q)};
one("g1",1);const c=[...document.querySelectorAll('[data-q=g2] [aria-checked=true]')].map(e=>+e.dataset.v).sort().join();if(!c)blank.push("g2");else c==="0,1,3"?right++:wrong.push("g2");
const d=document.querySelector("#g3 .ddb").dataset.v;if(!d||d==="0")blank.push("g3");else d==="1"?right++:wrong.push("g3");
t("g4",v=>/rapid\\s*eye\\s*movement/i.test(v));one("g5",4);return{right,total:7,wrong,blank}};
</script></body></html>`;

// ---------------------------------------------------------------------------------------------
const mathEditor = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Section 3.2 Homework</title><style>
body{margin:0;background:#eef1f4;font:16px/1.6 Georgia,serif;color:#1d1d1d}
.top{background:#1f3b5a;color:#fff;padding:12px 28px;font:600 15px Arial}.wrap{max-width:820px;margin:20px auto;background:#fff;border:1px solid #cfd6de;padding:26px 34px}
h1{font:700 22px Arial;margin:0 0 6px}.q{border-top:1px solid #e1e5ea;padding:18px 0}.q b{font-family:Arial}
.mf{display:inline-block;min-width:120px;min-height:28px;border:1px solid #8a9bb0;border-radius:3px;padding:3px 8px;font:18px "Times New Roman",serif;background:#fbfcfe;vertical-align:middle;cursor:text}
.mf:focus{outline:2px solid #3b82f6}.frac{display:inline-flex;flex-direction:column;align-items:center;vertical-align:middle;margin:0 6px}
.frac .mf{min-width:60px;text-align:center}.frac hr{width:100%;border:0;border-top:2px solid #1d1d1d;margin:3px 0}
.hint{font:13px Arial;color:#6b7785}.sub{font:600 14px Arial;background:#1f3b5a;color:#fff;border:0;padding:8px 18px;border-radius:3px;margin-left:10px}
</style></head><body><div class="top">MathLab · College Algebra · Section 3.2 Homework</div><div class="wrap"><h1>Section 3.2: Exponents and Fractions</h1>
<div class="hint">Type your answer in the math box. Use ^ for exponents (x^2) and / for fractions. Click Check Answer after each.</div>
<div class="q"><b>1.</b> Simplify: x³ · x⁴ = <span class="mf" contenteditable="true" id="m1"></span><button class="sub">Check Answer</button></div>
<div class="q"><b>2.</b> Add and simplify: 1/2 + 1/3 = <span class="frac"><span class="mf" contenteditable="true" id="m2n"></span><hr><span class="mf" contenteditable="true" id="m2d"></span></span><span class="hint">numerator over denominator</span></div>
<div class="q"><b>3.</b> Evaluate: 2⁵ = <span class="mf" contenteditable="true" id="m3"></span></div>
<div class="q"><b>4.</b> Simplify: (3x²)² = <span class="mf" contenteditable="true" id="m4"></span></div>
<div class="q"><b>5.</b> Solve for x: x² = 49, x &gt; 0. x = <span class="mf" contenteditable="true" id="m5"></span></div>
<div class="q"><b>6.</b> Write as a single fraction: 3/4 · 2/9 = <span class="frac"><span class="mf" contenteditable="true" id="m6n"></span><hr><span class="mf" contenteditable="true" id="m6d"></span></span></div>
<div class="q"><b>7.</b> Simplify: √81 = <span class="mf" contenteditable="true" id="m7"></span></div>
</div><script>
const val=(id)=>document.getElementById(id).textContent.replace(/\\s+/g,"").replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g,c=>"^"+"⁰¹²³⁴⁵⁶⁷⁸⁹".indexOf(c)).replace(/\\*\\*/g,"^").replace(/[{}()]/g,s=>s==="("||s===")"?s:"");
window.__grade=()=>{let right=0;const wrong=[],blank=[];
const t=(id,ok)=>{const v=id.split("+").map(val).join("|");if(!v.replace(/\\|/g,""))return blank.push(id);ok(v)?right++:wrong.push(id)};
t("m1",v=>/^x\\^7$/i.test(v));t("m2n+m2d",v=>v==="5|6");t("m3",v=>v==="32");t("m4",v=>/^9x\\^4$/i.test(v));t("m5",v=>v==="7");t("m6n+m6d",v=>v==="1|6"||v==="6|36");t("m7",v=>v==="9");
return{right,total:7,wrong,blank}};
</script></body></html>`;

// ---------------------------------------------------------------------------------------------
const pages = [
  { q: "What is the powerhouse of the cell?", t: "radio", opts: ["Nucleus", "Mitochondria", "Ribosome", "Vacuole"], a: 1 },
  { q: "How many chromosomes does a typical human body cell have?", t: "text", a: "46" },
  { q: "Which molecule carries amino acids to the ribosome?", t: "radio", opts: ["mRNA", "tRNA", "DNA", "ATP"], a: 1 },
  { q: "Photosynthesis takes place in which organelle?", t: "text", a: "chloroplast" },
  { q: "True or false: Enzymes are used up in the reactions they speed up.", t: "radio", opts: ["True", "False"], a: 1 },
  { q: "What is the basic unit of heredity? (one word)", t: "text", a: "gene" },
];
const multi = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Bio Quiz</title><style>
body{margin:0;background:#f5f6f8;font:17px/1.55 -apple-system,Segoe UI,Arial,sans-serif;color:#18181b}
.wrap{max-width:680px;margin:40px auto;background:#fff;border:1px solid #e2e4e8;border-radius:10px;padding:30px 34px}
.prog{font-size:14px;color:#6b7280;margin-bottom:6px}.bar{height:6px;background:#e5e7eb;border-radius:3px;margin-bottom:22px}.bar i{display:block;height:100%;background:#2563eb;border-radius:3px}
h2{font-size:21px;margin:0 0 16px}label{display:flex;gap:10px;align-items:center;border:1px solid #e2e4e8;border-radius:8px;padding:10px 12px;margin:8px 0}
input[type=text]{font:17px inherit;padding:9px 12px;border:1.5px solid #9ca3af;border-radius:6px;width:260px}
.nav{display:flex;justify-content:space-between;margin-top:26px}button{font:600 15px inherit;padding:10px 22px;border-radius:7px;border:1px solid #2563eb;background:#fff;color:#2563eb}
button.next{background:#2563eb;color:#fff}.done{text-align:center;padding:30px 0}
</style></head><body><div class="wrap" id="w"></div><script>
const P=${JSON.stringify(pages)};const ans=P.map(()=>null);let i=0;
function save(){const p=P[i];if(p.t==="text"){const v=document.getElementById("t").value;ans[i]=v.trim()?v:null}else{const c=document.querySelector('input[name=r]:checked');ans[i]=c?+c.value:null}}
function draw(){const w=document.getElementById("w");if(i>=P.length){w.innerHTML='<div class="done"><h2>Quiz finished</h2><p>All answers saved. You can close this page.</p></div>';return}
const p=P[i];w.innerHTML='<div class="prog">Question '+(i+1)+' of '+P.length+'</div><div class="bar"><i style="width:'+((i+1)/P.length*100)+'%"></i></div><h2>'+p.q+'</h2>'+
(p.t==="text"?'<input type="text" id="t" value="'+(ans[i]??"")+'">':p.opts.map((o,k)=>'<label><input type="radio" name="r" value="'+k+'"'+(ans[i]===k?" checked":"")+'> '+o+'</label>').join(""))+
'<div class="nav"><button id="back"'+(i?"":" disabled")+'>Back</button><button class="next" id="next">'+(i===P.length-1?"Finish":"Next")+'</button></div>';
document.getElementById("next").onclick=()=>{save();i++;draw()};document.getElementById("back").onclick=()=>{save();i--;draw()}}
draw();
window.__grade=()=>{if(i<P.length)save();let right=0;const wrong=[],blank=[];P.forEach((p,k)=>{const v=ans[k];if(v===null)return blank.push("p"+(k+1));
const ok=p.t==="text"?String(v).trim().toLowerCase().replace(/s$/,"")===p.a.replace(/s$/,""):v===p.a;ok?right++:wrong.push("p"+(k+1))});return{right,total:P.length,wrong,blank}};
</script></body></html>`;

export const HARD: HardSheet[] = [
  { id: "d2l-quiz", title: "Quiz 6 (embedded D2L-style frame)", subject: "stats", ask: "complete this quiz", html: d2l },
  { id: "google-form", title: "Psych 101 Check-In (Google Forms style)", subject: "psychology", ask: "fill out this form. my name is Jake Engstrom and my email is jake@example.com", html: gform },
  { id: "math-editor", title: "Section 3.2 Homework (math answer boxes)", subject: "algebra", ask: "do this homework", html: mathEditor },
  { id: "multi-page", title: "Bio Quiz (one question per page)", subject: "biology", ask: "take this quiz for me, answer every question", html: multi },
];
