(()=>{var G=Object.defineProperty;var j=(s,e)=>{for(var t in e)G(s,t,{get:e[t],enumerable:!0})};var N={};j(N,{initialState:()=>z,reduce:()=>Q,render:()=>ae});var K={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"},Y=s=>String(s!=null?s:"").replace(/[&<>"]/g,e=>K[e]),q="\u202F";function W(s,e){let t=String(s!=null?s:"");return t=t.replace(/(\p{L})'(\p{L})/gu,"$1\u2019$2").replace(/(\p{L})'(?=[\s.,)]|$)/gu,"$1\u2019"),e!=="fr"&&(t=t.replace(/(\d) %/g,"$1%")),e==="fr"&&(t=t.replace(/ ([:;?!»])/g,q+"$1").replace(/« /g,"\xAB"+q).replace(/(\d) %/g,"$1"+q+"%")),t}var a=(s,e)=>Y(W(s,e));function T(s,e={}){return String(s).replace(/\{\{\s*(\w+)\s*\}\}/g,(t,n)=>{if(e[n]==null)throw new Error(`no value for {{${n}}} in "${s}"`);return String(e[n])})}var d=(...s)=>s.filter(Boolean).join(" ");var g=(s,e=16)=>`<svg class="ico" width="${e}" height="${e}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${s}</svg>`,$={timer:s=>g('<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 2M9.5 2.5h5M12 2.5V6"/>',s),check:s=>g('<path d="M5 12.5l4.5 4.5L19 7.5"/>',s),chevron:s=>g('<path d="M9.5 5.5L16 12l-6.5 6.5"/>',s),shield:s=>g('<path d="M12 3l7.5 2.8v5.4c0 4.6-3 8-7.5 9.8-4.5-1.8-7.5-5.2-7.5-9.8V5.8L12 3z"/><path d="M8.8 12.2l2.3 2.3 4.2-4.6"/>',s),download:s=>g('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',s),gauge:s=>g('<path d="M4.5 16.5a8 8 0 1 1 15 0"/><path d="M12 14l3.5-4.5"/><circle cx="12" cy="14.5" r="1"/>',s),battery:s=>g('<rect x="3.5" y="8" width="15" height="8.5" rx="1.5"/><path d="M21 11v2.5M6.5 11v2.5"/>',s),target:s=>g('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.6"/>',s),book:s=>g('<path d="M5 4.5h10.5a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3V4.5z"/><path d="M5 17a3 3 0 0 1 3-3h10.5"/>',s),calendar:s=>g('<rect x="4" y="5.5" width="16" height="14" rx="1.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',s),map:s=>g('<path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 0 0-13 0c0 5.4 6.5 11 6.5 11z"/><circle cx="12" cy="10" r="2.2"/>',s),menu:s=>g('<path d="M4.5 7h15M4.5 12h15M4.5 17h15"/>',s),close:s=>g('<path d="M6 6l12 12M18 6L6 18"/>',s)};var z=s=>({i:s.first,answers:{},picking:!1,family:"deaths",prepared:{},focus:null}),F=(s,e)=>{var t,n;return e.kind==="assumed"?"justified":e.kind==="other"?"mistake":(n=(t=s.options.find(l=>l.id===e.id))==null?void 0:t.outcome)!=null?n:"mistake"},Z=(s,e,t)=>{var l;let n=t.kind==="other"?e.other[t.slug]:t.kind==="option"?(l=e.options.find(p=>p.id===t.id))==null?void 0:l.fiche:null;return n?s.fiches[n]:null};function Q(s,e,t){let n=t.moments[s.i],l={...s,focus:null},p=i=>({...l,picking:!1,answers:{...l.answers,[n.key]:i},focus:"after"});switch(e.type){case"go":return{...l,i:Number(e.i),picking:!1,focus:`q-${e.i}`};case"answer":return p({kind:"option",id:e.id});case"pick":return{...l,picking:!0,focus:`fam-${l.family}`};case"family":return{...l,family:e.f,focus:`fam-${e.f}`};case"tag":return p({kind:"other",slug:e.slug});case"assume":return p({kind:"assumed"});case"cancel":return{...l,picking:!1,focus:"other"};case"prepare":return{...l,prepared:{...l.prepared,[n.key]:!0},focus:"prepared"};case"next":{let i=t.moments.length,r=t.moments.map((m,v)=>(l.i+1+v)%i).find(m=>!l.answers[t.moments[m].key]);return{...l,i:r!=null?r:l.i,focus:"summary"}}case"restart":return{...z(t),focus:"summary"};default:return s}}function ee(s,e){let l=c=>(c*.02).toFixed(1),p=c=>(300-c*.02).toFixed(1),i=c=>`<circle class="map-zone" cx="${l(c.x)}" cy="${p(c.y)}" r="${(e.pits.radius*.02).toFixed(1)}"/><circle class="map-pit" cx="${l(c.x)}" cy="${p(c.y)}" r="4"/>`;return`<svg class="map" viewBox="0 0 300 300" role="img" aria-label="${a(e.s.mapLabel,e.lang)}">
    <path class="map-river" d="M52 36 L36 52 L248 264 L264 248 Z"/>
    <path class="map-lane" d="M22 278 L22 22 L278 22 M22 278 L278 278 L278 22 M30 270 L270 30"/>
    <rect class="map-frame" x="8" y="8" width="284" height="284"/>
    <rect class="map-base map-own" x="8" y="244" width="48" height="48"/>
    <rect class="map-base" x="244" y="8" width="48" height="48"/>
    ${i(e.pits.baron)}${i(e.pits.dragon)}
    <circle class="map-ring" cx="${l(s.map.x)}" cy="${p(s.map.y)}" r="11"/>
    <circle class="map-you" cx="${l(s.map.x)}" cy="${p(s.map.y)}" r="5"/>
    <text class="map-label" x="${(Number(l(s.map.x))+16).toFixed(1)}" y="${(Number(p(s.map.y))+4).toFixed(1)}">${a(e.s.you,e.lang)}</text>
  </svg>`}function se(s,e,t,n){let l=n.prepared[t.key];return`<article class="${d("fiche",n.focus==="after"&&"is-new")}" data-k="after" tabindex="-1">
    <p class="fiche-kind">${$.book(14)}${a(e.s.codexTitle,e.lang)}</p>
    <h4 class="fiche-title">${a(s.headline,e.lang)}</h4>
    <p class="fiche-rule">${a(s.rule,e.lang)}</p>
    <div class="fiche-drill"><span>${a(e.s.drill,e.lang)}</span><p>${a(s.drill,e.lang)}</p></div>
    ${s.video?`<p class="fiche-note">${a(e.s.codexVideo,e.lang)}</p>`:""}
    ${l?`<p class="fiche-prepared" data-k="prepared" tabindex="-1">${$.calendar(14)}${a(T(e.s.prepareDone,{objective:s.objective}),e.lang)}</p>`:`<button class="app-btn app-btn-line" data-act="prepare" data-k="prepare">${$.calendar(14)}${a(e.s.prepare,e.lang)}</button>`}
  </article>`}function te(s,e){let t=e.families.map(l=>`<button aria-pressed="${s.family===l.id}" class="chip" data-act="family" data-f="${l.id}" data-k="fam-${l.id}"><i class="fam fam-${l.id}"></i>${a(l.label,e.lang)}</button>`).join(""),n=e.tags.filter(l=>l.family===s.family).map(l=>`<button class="tag" data-act="tag" data-slug="${l.slug}">${a(l.label,e.lang)}</button>`).join("");return`<div class="picker">
    <p class="picker-title">${a(e.s.otherTitle,e.lang)}</p>
    <div class="chips" role="group" aria-label="${a(e.s.familiesLabel,e.lang)}">${t}</div>
    <div class="tags">${n}</div>
    <button class="assume" data-act="assume">${$.shield(16)}<span><b>${a(e.s.otherJustified,e.lang)}</b><small>${a(e.s.justifiedBadge,e.lang)}</small></span></button>
    <div class="picker-foot"><button class="app-btn app-btn-ghost" data-act="cancel">${a(e.s.cancel,e.lang)}</button></div>
  </div>`}function ae(s,e){var f,b;let t=e.moments[s.i],n=s.answers[t.key],l=e.moments.filter(u=>s.answers[u.key]).length,p=l===e.moments.length,i=e.moments.filter(u=>s.answers[u.key]&&F(u,s.answers[u.key])==="justified").length,c=e.moments.some((u,x)=>x!==s.i&&!s.answers[u.key]),r=e.moments.map((u,x)=>`<li><button class="${d("q",x===s.i&&"is-current")}" data-act="go" data-i="${x}" data-k="q-${x}"${x===s.i?' aria-current="true"':""}>
      <span class="${d("q-n",s.answers[u.key]&&"is-done")}">${s.answers[u.key]?$.check(12):x+1}</span>
      <span class="q-clock">${u.clock}</span><span class="q-label">${a(u.label,e.lang)}</span></button></li>`).join(""),m=t.options.map(u=>{let x=(n==null?void 0:n.kind)==="option"&&n.id===u.id;return`<button class="${d("opt",x&&"is-selected",u.outcome==="justified"&&"opt-ok")}" data-act="answer" data-id="${u.id}" aria-pressed="${x}">
      <i class="${d("dot",u.outcome==="justified"&&"dot-ok")}"></i>
      <span><span class="opt-main">${a(u.main,e.lang)}</span><small>${a(u.sub,e.lang)}</small></span></button>`}).join(""),v=n&&n.kind!=="option",y=v?n.kind==="assumed"?e.s.assumed:(b=(f=e.tags.find(u=>u.slug===n.slug))==null?void 0:f.label)!=null?b:e.s.other:e.s.other,o="";if(n&&!s.picking){let u=F(t,n)==="justified"?null:Z(e,t,n);o=(F(t,n)==="justified"?`<p class="${d("justified",s.focus==="after"&&"is-new")}" data-k="after" tabindex="-1">${$.shield(16)}${a(e.s.justifiedDone,e.lang)}</p>`:u?se(u,e,t,s):"")+(c?`<button class="app-btn app-btn-solid" data-act="next" data-k="next">${a(e.s.next,e.lang)}${$.chevron(14)}</button>`:"")}return`<div class="mr">
    <header class="mr-head">
      <div><h3 class="mr-title">${$.timer(16)}${a(e.s.title,e.lang)}</h3><p class="mr-sub">${a(e.s.subtitle,e.lang)}</p></div>
      <span class="mr-count" aria-label="${l} / ${e.moments.length}">${l}/${e.moments.length}</span>
    </header>
    <ol class="mr-queue" aria-label="${a(e.s.queue,e.lang)}">${r}</ol>
    <div class="mr-body">
      <div class="mr-map">${ee(t,e)}<p class="mr-note">${$.map(13)}${a(e.s.noVod,e.lang)}</p></div>
      <div class="mr-qcm">
        <p class="mr-summary" data-k="summary" tabindex="-1"><span class="mr-clock">${t.clock}</span><span class="mr-zone">${a(t.zone,e.lang)}</span>${a(t.line,e.lang)}</p>
        ${s.picking?te(s,e):`<p class="mr-question">${a(e.s.question,e.lang)}</p>
        <div class="opts" role="group" aria-label="${a(e.s.question,e.lang)}">${m}
          <button class="${d("opt opt-other",v&&"is-selected")}" data-act="pick" data-k="other" aria-pressed="${!!v}"><span class="opt-main">${a(y,e.lang)}</span>${$.chevron(14)}</button>
        </div>`}
        <div class="mr-after" aria-live="polite">${o}</div>
      </div>
    </div>
    ${p?`<div class="mr-done"><div><p class="mr-done-title">${a(e.s.done,e.lang)}</p><p>${a(T(e.s.doneSummary,{mistakes:l-i,justified:i}),e.lang)}</p></div>
      <span class="mr-xp">${a(T(e.s.doneXp,{xp:e.xp}),e.lang)}</span>
      <button class="app-btn app-btn-ghost" data-act="restart" data-k="restart">${a(e.s.restart,e.lang)}</button></div>`:""}
  </div>`}var C={};j(C,{initialState:()=>ne,reduce:()=>le,render:()=>oe});var ne=()=>({calib:null,low:!1,focus:null});function le(s,e){switch(e.type){case"calib":return{...s,calib:e.f,focus:"calib-result"};case"low":return{...s,low:!0,focus:"low-done"};default:return s}}function oe(s,e){let t=e.lang,n=e.form.map(r=>`<li class="${d("res",r.win&&"res-w")}"><span class="vh">${a(r.label,t)}</span><span aria-hidden="true">${r.letter}</span></li>`).join(""),l=e.calib.families.map(r=>`<button class="${d("opt opt-tight",s.calib===r.id&&"is-selected")}" data-act="calib" data-f="${r.id}" aria-pressed="${s.calib===r.id}"><i class="fam fam-${r.id}"></i><span class="opt-main">${a(r.label,t)}</span></button>`).join(""),p=s.calib?`<div class="${d("calib-result",s.focus==="calib-result"&&"is-new")}" data-k="calib-result" tabindex="-1">
      <p>${a(e.calib.results[s.calib],t)}</p>
      <p class="calib-dist-title">${a(e.calib.distTitle,t)}</p>
      <ul class="dist">${e.calib.dist.map(r=>`<li><span>${a(r.label,t)}</span><span class="bar"><i style="width:${r.share}%"></i></span><b>${r.share} %</b></li>`).join("")}</ul>
    </div>`:"",i=s.low?e.session.objectivesLow:e.session.objectives,c=e.stats.map(r=>`<div><dt>${a(r.label,t)}</dt><dd>${a(r.value,t)}</dd></div>`).join("");return`<div class="db">
    <header class="db-head">
      <div>
        <p class="db-hello">${a(e.s.welcome,t)} <b>${a(e.name,t)}</b></p>
        <p class="db-formline">${a(e.s.formLine,t)} <b>${a(e.formWinrate,t)}</b> <span>${a(e.formDelta,t)}</span></p>
      </div>
      <div class="db-form"><span>${a(e.s.form,t)}</span><ol aria-label="${a(e.s.formLabel,t)}">${n}</ol><span class="db-role">${a(e.s.mainRole,t)} <b>${a(e.role,t)}</b></span></div>
    </header>

    <section class="panel calib" aria-live="polite">
      <h3 class="panel-title">${$.gauge(16)}${a(e.calib.title,t)}</h3>
      <p class="panel-sub">${a(e.calib.due,t)}</p>
      <p class="calib-q">${a(e.calib.question,t)}</p>
      <div class="calib-opts" role="group" aria-label="${a(e.calib.question,t)}">${l}</div>
      ${p}
    </section>

    <div class="db-cols">
      <section class="panel db-session">
        <h3 class="panel-kicker">${a(e.session.title,t)}</h3>
        <p class="db-objective">${a(i,t)}</p>
        <p class="panel-sub">${a(e.session.games,t)}</p>
        <dl class="db-stats">${c}</dl>
      </section>
      <section class="panel db-level">
        <h3 class="panel-kicker">${a(e.level.title,t)}</h3>
        <p class="db-level-n"><b>${a(e.level.level,t)}</b><span>${a(e.level.tier,t)}</span></p>
        <div class="meter" role="img" aria-label="${a(e.level.xp,t)}"><i style="width:${e.level.pct}%"></i></div>
        <p class="panel-sub"><span class="mono">${a(e.level.xp,t)}</span> ${a(e.level.toNext,t)}</p>
      </section>
      <section class="${d("panel db-low",s.low&&"is-on")}" aria-live="polite">
        <h3 class="panel-title">${$.battery(16)}${a(s.low?e.low.active:e.low.title,t)}</h3>
        ${s.low?`<p class="${d("db-low-done",s.focus==="low-done"&&"is-new")}" data-k="low-done" tabindex="-1">${a(e.low.done,t)}</p><p class="panel-sub">${a(e.low.rules,t)}</p>`:`<p>${a(e.low.reason,t)}</p><p class="panel-sub">${a(e.low.rules,t)}</p>
             <button class="app-btn app-btn-solid" data-act="low">${$.battery(14)}${a(e.low.activate,t)}</button>`}
      </section>
    </div>
  </div>`}var I={};j(I,{initialState:()=>ie,reduce:()=>re,render:()=>ce});var ie=s=>({family:"all",slug:s.rows[0].slug,focus:null}),R=(s,e)=>s.rows.filter(t=>e==="all"||t.family===e);function re(s,e,t){var n,l;switch(e.type){case"family":{let p=R(t,e.f),i=p.some(c=>c.slug===s.slug)?s.slug:(l=(n=p[0])==null?void 0:n.slug)!=null?l:s.slug;return{family:e.f,slug:i,focus:`fam-${e.f}`}}case"open":return{...s,slug:e.slug,focus:`row-${e.slug}`};default:return s}}function ce(s,e){var y;let t=e.lang,n=R(e,s.family),l=(y=e.rows.find(o=>o.slug===s.slug))!=null?y:e.rows[0],p=e.kpis.map(o=>`<div><dt>${a(o.label,t)}</dt><dd class="${d(o.text&&"is-text")}">${a(o.value,t)}</dd><dd class="kpi-sub">${a(o.sub,t)}</dd></div>`).join(""),i=[{id:"all",label:e.s.all},...e.families].map(o=>`<button class="chip" aria-pressed="${s.family===o.id}" data-act="family" data-f="${o.id}" data-k="fam-${o.id}">${o.id==="all"?"":`<i class="fam fam-${o.id}"></i>`}${a(o.label,t)}</button>`).join(""),c=n.length?n.map(o=>`<li><button class="${d("rank",o.slug===l.slug&&"is-current")}" data-act="open" data-slug="${o.slug}" data-k="row-${o.slug}" aria-pressed="${o.slug===l.slug}">
      <span class="rank-name"><i class="fam fam-${o.family}"></i>${a(o.label,t)}</span>
      <span class="rank-bar"><i style="width:${o.bar}%"></i></span>
      <span class="rank-count">${o.count}\xD7</span><span class="rank-share">${o.share} %</span>
      <span class="${d("rank-delta",o.delta==null&&"is-none",o.delta!=null&&o.delta<0&&"is-cost")}" title="${a(e.s.costTitle,t)}">${a(o.deltaLabel,t)}</span>
    </button></li>`).join(""):`<li class="rank-empty">${a(e.s.none,t)}</li>`,r=l.inspector,m=r.phases.map(o=>`<div><dt>${a(o.label,t)}<small>${a(o.range,t)}</small></dt><dd>${o.count}</dd><dd class="bar"><i style="width:${o.pct}%"></i></dd></div>`).join(""),v=r.moments.map(o=>`<li><span class="mono">${o.clock}</span><span>${a(o.label,t)}</span><span class="${d("res res-s",o.win&&"res-w")}">${o.letter}</span></li>`).join("");return`<div class="lab">
    <dl class="lab-kpis">${p}</dl>
    <div class="lab-cols">
      <section class="panel lab-rank">
        <h3 class="panel-title">${a(e.s.rankingTitle,t)}</h3>
        <div class="chips" role="group" aria-label="${a(e.s.families,t)}">${i}</div>
        <ol class="ranks">${c}</ol>
        <p class="panel-sub">${a(e.s.legend,t)}</p>
      </section>
      <section class="panel lab-inspect" aria-live="polite">
        <h3 class="lab-name">${a(l.label,t)}</h3>
        <p class="lab-family"><i class="fam fam-${l.family}"></i>${a(r.family,t)}</p>
        <p class="panel-sub">${a(r.summary,t)}</p>
        ${r.cost?`<p class="lab-cost">${a(r.cost,t)}</p>`:`<p class="lab-cost is-none">${a(e.s.noGap,t)}</p>`}
        <h4 class="panel-kicker">${a(e.s.when,t)}</h4>
        <dl class="phases">${m}</dl>
        ${r.fiche?`<p class="panel-sub">${a(r.prescTitle,t)}</p>
        <article class="fiche fiche-flat">
          <p class="fiche-kind">${$.book(14)}${a(e.s.codexTitle,t)}</p>
          <h4 class="fiche-title">${a(r.fiche.headline,t)}</h4>
          <p class="fiche-rule">${a(r.fiche.rule,t)}</p>
          <div class="fiche-drill"><span>${a(e.s.drill,t)}</span><p>${a(r.fiche.drill,t)}</p></div>
        </article>`:""}
        <h4 class="panel-kicker">${a(e.s.momentsTitle,t)}</h4>
        <ul class="lab-moments">${v}</ul>
        <p class="lab-hint">${$.target(14)}${a(e.s.actionHint,t)}</p>
      </section>
    </div>
  </div>`}var A={};j(A,{initialState:()=>pe,reduce:()=>ue,render:()=>me});var pe=()=>({role:"carry",axis:null,focus:null});function ue(s,e){switch(e.type){case"role":return{role:e.r,axis:null,focus:`role-${e.r}`};case"axis":return{...s,axis:e.a,focus:`axis-${e.a}`};case"hover":return s.axis===e.a?s:{...s,axis:e.a,focus:null};default:return s}}var S=160,de=104,w=(s,e,t)=>{let n=Math.PI*2*s/e-Math.PI/2,l=de*t/100;return[S+Math.cos(n)*l,S+Math.sin(n)*l]},_=s=>s.map(([e,t])=>`${e.toFixed(1)},${t.toFixed(1)}`).join(" ");function me(s,e){let t=e.lang,n=e.sets[s.role],l=n.points.length,p=[25,50,75,100].map(o=>`<polygon class="rd-ring" points="${_(n.points.map((f,b)=>w(b,l,o)))}"/>`).join(""),i=n.points.map((o,f)=>{let[b,u]=w(f,l,100);return`<line class="${d("rd-spoke",s.axis===o.key&&"is-on")}" x1="${S}" y1="${S}" x2="${b.toFixed(1)}" y2="${u.toFixed(1)}"/>`}).join(""),c=n.points.map((o,f)=>{let[b,u]=w(f,l,122),x=Math.abs(b-S)<12?"middle":b>S?"start":"end";return`<g class="${d("rd-axis",s.axis===o.key&&"is-on")}" data-act="axis" data-hover="hover" data-a="${o.key}"><circle cx="${b.toFixed(1)}" cy="${u.toFixed(1)}" r="20"/><text x="${b.toFixed(1)}" y="${(u+4).toFixed(1)}" text-anchor="${x}">${a(o.label,t)}</text></g>`}).join(""),r=n.points.map((o,f)=>{let[b,u]=w(f,l,o.rs);return`<circle class="${d("rd-dot",s.axis===o.key&&"is-on")}" cx="${b.toFixed(1)}" cy="${u.toFixed(1)}" r="${s.axis===o.key?5:3}"/>`}).join(""),m=n.points.find(o=>o.key===s.axis),v=e.roles.map(o=>`<button class="seg" aria-pressed="${s.role===o.id}" data-act="role" data-r="${o.id}" data-k="role-${o.id}">${a(o.label,t)}</button>`).join(""),y=n.points.map(o=>`<tr class="${d(s.axis===o.key&&"is-on")}">
      <th scope="row"><button data-act="axis" data-hover="hover" data-a="${o.key}" data-k="axis-${o.key}" aria-pressed="${s.axis===o.key}">${a(o.label,t)}</button></th>
      <td>${a(o.recent,t)}</td><td>${a(o.snapshot,t)}</td><td class="${d("gap",o.good&&"is-good")}">${a(o.gap,t)}</td></tr>`).join("");return`<div class="rd">
    <div class="rd-chart">
      <div class="rd-top">
        <h3 class="panel-title">${a(e.s.title,t)}</h3><span class="mono rd-score">${a(n.score,t)}</span>
      </div>
      <svg class="rd-svg" viewBox="0 0 320 320" role="img" aria-label="${a(e.s.title,t)}">
        ${p}${i}
        <polygon class="rd-snap" points="${_(n.points.map((o,f)=>w(f,l,o.ss)))}"/>
        <polygon class="rd-recent" points="${_(n.points.map((o,f)=>w(f,l,o.rs)))}"/>
        ${r}${c}
      </svg>
      <p class="rd-legend"><span><i class="lg lg-recent"></i>${a(e.s.recentLabel,t)}</span><span><i class="lg lg-snap"></i>${a(e.s.snapshotLabel,t)}</span></p>
      <p class="rd-readout" aria-live="polite">${a(m?m.readout:e.s.readoutIdle,t)}</p>
    </div>
    <div class="rd-side">
      <div class="segs" role="group" aria-label="${a(e.s.roleLabel,t)}">${v}</div>
      <table class="rd-table">
        <thead><tr><th scope="col">${a(e.s.colAxis,t)}</th><th scope="col">${a(e.s.colRecent,t)}</th><th scope="col">${a(e.s.colSnapshot,t)}</th><th scope="col">${a(e.s.colGap,t)}</th></tr></thead>
        <tbody>${y}</tbody>
      </table>
      <p class="panel-sub">${a(e.s.scale,t)}</p>
    </div>
  </div>`}var P={};j(P,{initialState:()=>$e,reduce:()=>he,render:()=>fe});var $e=s=>({id:s.current,focus:null});function he(s,e){return e.type==="tier"?{id:e.id,focus:`tier-${e.id}`}:s}function fe(s,e){var p;let t=e.lang,n=(p=e.tiers.find(i=>i.id===s.id))!=null?p:e.tiers[0],l=e.tiers.map(i=>`<li style="--h:${i.height}">
      <button class="${d("step",i.id===n.id&&"is-current",i.id===e.current&&"is-player")}" data-act="tier" data-id="${i.id}" data-k="tier-${i.id}" aria-pressed="${i.id===n.id}">
        <span class="step-name">${a(i.label,t)}</span><span class="step-level mono">${a(i.levelShort,t)}</span>
        <span class="step-bar" aria-hidden="true"></span>
      </button></li>`).join("");return`<div class="tiers">
    <ol class="stairs" aria-label="${a(e.s.scaleLabel,t)}">${l}</ol>
    <div class="tier-detail" aria-live="polite">
      <h3 class="tier-name">${a(n.label,t)}</h3>
      <p class="tier-level mono">${a(n.level,t)}</p>
      <ul>${n.detail.map(i=>`<li>${a(i,t)}</li>`).join("")}</ul>
      ${n.id===e.current?`<p class="tier-you">${a(e.s.you,t)}</p>`:""}
    </div>
  </div>`}var be=[["black","bg"],["dark","surface"],["panel","panel"],["border-dim","line"],["border","line-strong"],["gold","accent"],["gold-bright","accent-hi"],["cyan","second"],["text","text"],["text-bright","text-hi"]],ge="--hextech-";function V(s){return be.map(([e,t])=>{let n=s[ge+e];if(!/^#[0-9a-f]{6}$/i.test(n!=null?n:""))throw new Error(`theme token ${e} is not a colour: ${n}`);return[`--app-${t}`,n.toUpperCase()]})}function U(s,e){var p,i;let t=c=>{let[r,m=""]=String(c).replace(/^v/,"").split("-");return{core:r.split(".").map(Number),pre:m?m.split("."):[]}},n=t(s),l=t(e);if(n.core.some(Number.isNaN)||l.core.some(Number.isNaN))return!1;for(let c=0;c<Math.max(n.core.length,l.core.length);c++){let r=((p=n.core[c])!=null?p:0)-((i=l.core[c])!=null?i:0);if(r!==0)return r>0}if(!n.pre.length||!l.pre.length)return!n.pre.length&&l.pre.length>0;for(let c=0;c<Math.max(n.pre.length,l.pre.length);c++){let r=n.pre[c],m=l.pre[c];if(r===void 0)return!1;if(m===void 0)return!0;if(r===m)continue;let v=Number(r),y=Number(m);return!Number.isNaN(v)&&!Number.isNaN(y)?v>y:r>m}return!1}var O=s=>[1,3,5].map(e=>parseInt(s.slice(e,e+2),16)),ve=s=>"#"+s.map(e=>Math.round(Math.min(255,Math.max(0,e))).toString(16).padStart(2,"0")).join("").toUpperCase();function h(s,e,t){let n=O(s),l=O(e);return ve(n.map((p,i)=>p+(l[i]-p)*t))}function X(s){let e=l=>{let[p,i,c]=O(l);return(.2126*p+.7152*i+.0722*c)/255},t=e(s.base)>.12?h(s.base,"#000000",1-.12/e(s.base)):s.base,n="#FFFFFF";return{"--hextech-black":t,"--hextech-dark":h(t,n,.04),"--hextech-elevated":h(t,n,.09),"--hextech-panel":h(t,n,.09),"--hextech-border":h(t,s.accent,.55),"--hextech-border-dim":h(h(t,n,.08),s.accent,.22),"--hextech-cyan":s.secondary,"--hextech-teal":h(s.secondary,t,.4),"--hextech-gold":s.accent,"--hextech-gold-bright":h(s.accent,n,.72),"--hextech-text":h(h(n,s.accent,.12),t,.3),"--hextech-text-bright":h(n,s.accent,.08),"--hextech-text-dim":h(h(n,s.accent,.12),t,.58),"--hextech-blue":h(t,n,.06),"--hextech-blue-bright":h(s.accent,n,.35)}}var xe={micro:N,dashboard:C,lab:I,radar:A,tiers:P},D=s=>{let e=document.getElementById(s);return e?JSON.parse(e.textContent):null};function ye(s){let e=s.dataset.exhibit,t=xe[e],n=D(`data-${e}`);if(!t||!n)return;let l=t.initialState(n),p=(i,c)=>{let r=t.reduce(l,{...c.dataset,type:i},n);if(r===l||(l=r,s.innerHTML=t.render(l,n),!l.focus))return;let m=s.querySelector(`[data-k="${l.focus}"]`);m&&(m.focus({preventScroll:!0}),m.scrollIntoView({block:"nearest"}))};s.addEventListener("click",i=>{let c=i.target.closest("[data-act]");c&&s.contains(c)&&p(c.dataset.act,c)}),s.addEventListener("pointerover",i=>{if(i.pointerType!=="mouse")return;let c=i.target.closest("[data-hover]");c&&s.contains(c)&&p(c.dataset.hover,c)})}document.querySelectorAll("[data-exhibit]").forEach(ye);var M=document.querySelector("[data-themes]"),J=D("data-themes");if(M&&J){let s=M.querySelector("[data-sample]"),e=M.querySelector('input[name="theme"][value="custom"]'),t=e.parentElement.querySelectorAll(".sw-chip i"),n=i=>M.querySelector(`input[name="${i}"]`),l=()=>V(X({base:n("base").value,accent:n("accent").value,secondary:n("secondary").value})),p=i=>{for(let[c,r]of i)s.style.setProperty(c,r)};M.addEventListener("change",i=>{i.target.name==="theme"&&p(i.target.value==="custom"?l():J.presets[i.target.value])}),M.addEventListener("input",i=>{if(i.target.type!=="color")return;let c=l(),r=Object.fromEntries(c);e.checked=!0,p(c),t[0].style.background=r["--app-bg"],t[1].style.background=r["--app-accent"],t[2].style.background=r["--app-second"]})}var L=document.querySelector("[data-rail]"),k=L&&L.querySelector("[data-toggle]");if(k){let s=e=>{L.classList.toggle("is-open",e),k.setAttribute("aria-expanded",String(e))};k.setAttribute("role","button"),s(!1),k.addEventListener("click",e=>{e.preventDefault(),s(!L.classList.contains("is-open"))}),k.addEventListener("keydown",e=>{e.key===" "&&(e.preventDefault(),k.click())}),L.querySelector(".rail-nav").addEventListener("click",e=>{e.target.closest("a")&&s(!1)}),document.addEventListener("keydown",e=>{e.key!=="Escape"||!L.classList.contains("is-open")||(s(!1),k.focus())})}var H=new Map;document.querySelectorAll('.rail-nav a[href^="#"]').forEach(s=>H.set(s.getAttribute("href").slice(1),s));var B=[...H.keys()].map(s=>document.getElementById(s)).filter(Boolean);if(B.length&&"IntersectionObserver"in window){let s=new Set,e=new IntersectionObserver(t=>{for(let l of t)l.isIntersecting?s.add(l.target.id):s.delete(l.target.id);let n=B.find(l=>s.has(l.id));for(let[l,p]of H)n&&n.id===l?p.setAttribute("aria-current","location"):p.removeAttribute("aria-current")},{rootMargin:"-20% 0px -70% 0px"});B.forEach(t=>e.observe(t))}var E=D("data-release");E&&"fetch"in window&&fetch(E.api,{headers:{Accept:"application/vnd.github+json"}}).then(s=>s.ok?s.json():[]).then(s=>{let e=i=>/Setup.*\.exe$/i.test(i.name),t=s.find(i=>!i.draft&&i.assets.some(e));if(!t)return;let n=t.tag_name.replace(/^v/,"");if(!U(n,E.version))return;let l=t.assets.find(e),p=`${new Intl.NumberFormat(E.locale).format(Math.round(l.size/1048576))} ${E.sizeUnit}`;document.querySelectorAll("[data-download]").forEach(i=>{i.href=l.browser_download_url}),document.querySelectorAll("[data-version]").forEach(i=>{i.textContent=n}),document.querySelectorAll("[data-size]").forEach(i=>{i.textContent=p}),document.querySelectorAll("[data-verify]").forEach(i=>{i.hidden=!0})}).catch(()=>{});})();
