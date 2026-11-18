(()=>{var G=Object.defineProperty;var j=(t,e)=>{for(var s in e)G(t,s,{get:e[s],enumerable:!0})};var N={};j(N,{initialState:()=>z,reduce:()=>Q,render:()=>ae});var K={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"},Y=t=>String(t!=null?t:"").replace(/[&<>"]/g,e=>K[e]),q="\u202F";function W(t,e){let s=String(t!=null?t:"");return s=s.replace(/(\p{L})'(\p{L})/gu,"$1\u2019$2").replace(/(\p{L})'(?=[\s.,)]|$)/gu,"$1\u2019"),e!=="fr"&&(s=s.replace(/(\d) %/g,"$1%")),e==="fr"&&(s=s.replace(/ ([:;?!»])/g,q+"$1").replace(/« /g,"\xAB"+q).replace(/(\d) %/g,"$1"+q+"%")),s}var a=(t,e)=>Y(W(t,e));function T(t,e={}){return String(t).replace(/\{\{\s*(\w+)\s*\}\}/g,(s,n)=>{if(e[n]==null)throw new Error(`no value for {{${n}}} in "${t}"`);return String(e[n])})}var d=(...t)=>t.filter(Boolean).join(" ");var y=(t,e=16)=>`<svg class="ico" width="${e}" height="${e}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${t}</svg>`,$={timer:t=>y('<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 2M9.5 2.5h5M12 2.5V6"/>',t),check:t=>y('<path d="M5 12.5l4.5 4.5L19 7.5"/>',t),chevron:t=>y('<path d="M9.5 5.5L16 12l-6.5 6.5"/>',t),shield:t=>y('<path d="M12 3l7.5 2.8v5.4c0 4.6-3 8-7.5 9.8-4.5-1.8-7.5-5.2-7.5-9.8V5.8L12 3z"/><path d="M8.8 12.2l2.3 2.3 4.2-4.6"/>',t),download:t=>y('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',t),gauge:t=>y('<path d="M4.5 16.5a8 8 0 1 1 15 0"/><path d="M12 14l3.5-4.5"/><circle cx="12" cy="14.5" r="1"/>',t),target:t=>y('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.6"/>',t),book:t=>y('<path d="M5 4.5h10.5a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3V4.5z"/><path d="M5 17a3 3 0 0 1 3-3h10.5"/>',t),calendar:t=>y('<rect x="4" y="5.5" width="16" height="14" rx="1.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',t),map:t=>y('<path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 0 0-13 0c0 5.4 6.5 11 6.5 11z"/><circle cx="12" cy="10" r="2.2"/>',t),menu:t=>y('<path d="M4.5 7h15M4.5 12h15M4.5 17h15"/>',t),close:t=>y('<path d="M6 6l12 12M18 6L6 18"/>',t)};var z=t=>({i:t.first,answers:{},picking:!1,family:"deaths",prepared:{},focus:null}),F=(t,e)=>{var s,n;return e.kind==="assumed"?"justified":e.kind==="other"?"mistake":(n=(s=t.options.find(r=>r.id===e.id))==null?void 0:s.outcome)!=null?n:"mistake"},Z=(t,e,s)=>{var r;let n=s.kind==="other"?e.other[s.slug]:s.kind==="option"?(r=e.options.find(c=>c.id===s.id))==null?void 0:r.fiche:null;return n?t.fiches[n]:null};function Q(t,e,s){let n=s.moments[t.i],r={...t,focus:null},c=i=>({...r,picking:!1,answers:{...r.answers,[n.key]:i},focus:"after"});switch(e.type){case"go":return{...r,i:Number(e.i),picking:!1,focus:`q-${e.i}`};case"answer":return c({kind:"option",id:e.id});case"pick":return{...r,picking:!0,focus:`fam-${r.family}`};case"family":return{...r,family:e.f,focus:`fam-${e.f}`};case"tag":return c({kind:"other",slug:e.slug});case"assume":return c({kind:"assumed"});case"cancel":return{...r,picking:!1,focus:"other"};case"prepare":return{...r,prepared:{...r.prepared,[n.key]:!0},focus:"prepared"};case"next":{let i=s.moments.length,p=s.moments.map((m,g)=>(r.i+1+g)%i).find(m=>!r.answers[s.moments[m].key]);return{...r,i:p!=null?p:r.i,focus:"summary"}}case"restart":return{...z(s),focus:"summary"};default:return t}}function ee(t,e){let r=o=>(o*.02).toFixed(1),c=o=>(300-o*.02).toFixed(1),i=o=>`<circle class="map-zone" cx="${r(o.x)}" cy="${c(o.y)}" r="${(e.pits.radius*.02).toFixed(1)}"/><circle class="map-pit" cx="${r(o.x)}" cy="${c(o.y)}" r="4"/>`;return`<svg class="map" viewBox="0 0 300 300" role="img" aria-label="${a(e.s.mapLabel,e.lang)}">
    <path class="map-river" d="M52 36 L36 52 L248 264 L264 248 Z"/>
    <path class="map-lane" d="M22 278 L22 22 L278 22 M22 278 L278 278 L278 22 M30 270 L270 30"/>
    <rect class="map-frame" x="8" y="8" width="284" height="284"/>
    <rect class="map-base map-own" x="8" y="244" width="48" height="48"/>
    <rect class="map-base" x="244" y="8" width="48" height="48"/>
    ${i(e.pits.baron)}${i(e.pits.dragon)}
    <circle class="map-ring" cx="${r(t.map.x)}" cy="${c(t.map.y)}" r="11"/>
    <circle class="map-you" cx="${r(t.map.x)}" cy="${c(t.map.y)}" r="5"/>
    <text class="map-label" x="${(Number(r(t.map.x))+16).toFixed(1)}" y="${(Number(c(t.map.y))+4).toFixed(1)}">${a(e.s.you,e.lang)}</text>
  </svg>`}function te(t,e,s,n){let r=n.prepared[s.key];return`<article class="${d("fiche",n.focus==="after"&&"is-new")}" data-k="after" tabindex="-1">
    <p class="fiche-kind">${$.book(14)}${a(e.s.codexTitle,e.lang)}</p>
    <h4 class="fiche-title">${a(t.headline,e.lang)}</h4>
    <p class="fiche-rule">${a(t.rule,e.lang)}</p>
    <div class="fiche-drill"><span>${a(e.s.drill,e.lang)}</span><p>${a(t.drill,e.lang)}</p></div>
    ${t.video?`<p class="fiche-note">${a(e.s.codexVideo,e.lang)}</p>`:""}
    ${r?`<p class="fiche-prepared" data-k="prepared" tabindex="-1">${$.calendar(14)}${a(T(e.s.prepareDone,{objective:t.objective}),e.lang)}</p>`:`<button class="app-btn app-btn-line" data-act="prepare" data-k="prepare">${$.calendar(14)}${a(e.s.prepare,e.lang)}</button>`}
  </article>`}function se(t,e){let s=e.families.map(r=>`<button aria-pressed="${t.family===r.id}" class="chip" data-act="family" data-f="${r.id}" data-k="fam-${r.id}"><i class="fam fam-${r.id}"></i>${a(r.label,e.lang)}</button>`).join(""),n=e.tags.filter(r=>r.family===t.family).map(r=>`<button class="tag" data-act="tag" data-slug="${r.slug}">${a(r.label,e.lang)}</button>`).join("");return`<div class="picker">
    <p class="picker-title">${a(e.s.otherTitle,e.lang)}</p>
    <div class="chips" role="group" aria-label="${a(e.s.familiesLabel,e.lang)}">${s}</div>
    <div class="tags">${n}</div>
    <button class="assume" data-act="assume">${$.shield(16)}<span><b>${a(e.s.otherJustified,e.lang)}</b><small>${a(e.s.justifiedBadge,e.lang)}</small></span></button>
    <div class="picker-foot"><button class="app-btn app-btn-ghost" data-act="cancel">${a(e.s.cancel,e.lang)}</button></div>
  </div>`}function ae(t,e){var f,b;let s=e.moments[t.i],n=t.answers[s.key],r=e.moments.filter(u=>t.answers[u.key]).length,c=r===e.moments.length,i=e.moments.filter(u=>t.answers[u.key]&&F(u,t.answers[u.key])==="justified").length,o=e.moments.some((u,x)=>x!==t.i&&!t.answers[u.key]),p=e.moments.map((u,x)=>`<li><button class="${d("q",x===t.i&&"is-current")}" data-act="go" data-i="${x}" data-k="q-${x}"${x===t.i?' aria-current="true"':""}>
      <span class="${d("q-n",t.answers[u.key]&&"is-done")}">${t.answers[u.key]?$.check(12):x+1}</span>
      <span class="q-clock">${u.clock}</span><span class="q-label">${a(u.label,e.lang)}</span></button></li>`).join(""),m=s.options.map(u=>{let x=(n==null?void 0:n.kind)==="option"&&n.id===u.id;return`<button class="${d("opt",x&&"is-selected",u.outcome==="justified"&&"opt-ok")}" data-act="answer" data-id="${u.id}" aria-pressed="${x}">
      <i class="${d("dot",u.outcome==="justified"&&"dot-ok")}"></i>
      <span><span class="opt-main">${a(u.main,e.lang)}</span><small>${a(u.sub,e.lang)}</small></span></button>`}).join(""),g=n&&n.kind!=="option",v=g?n.kind==="assumed"?e.s.assumed:(b=(f=e.tags.find(u=>u.slug===n.slug))==null?void 0:f.label)!=null?b:e.s.other:e.s.other,l="";if(n&&!t.picking){let u=F(s,n)==="justified"?null:Z(e,s,n);l=(F(s,n)==="justified"?`<p class="${d("justified",t.focus==="after"&&"is-new")}" data-k="after" tabindex="-1">${$.shield(16)}${a(e.s.justifiedDone,e.lang)}</p>`:u?te(u,e,s,t):"")+(o?`<button class="app-btn app-btn-solid" data-act="next" data-k="next">${a(e.s.next,e.lang)}${$.chevron(14)}</button>`:"")}return`<div class="mr">
    <header class="mr-head">
      <div><h3 class="mr-title">${$.timer(16)}${a(e.s.title,e.lang)}</h3><p class="mr-sub">${a(e.s.subtitle,e.lang)}</p></div>
      <span class="mr-count" aria-label="${r} / ${e.moments.length}">${r}/${e.moments.length}</span>
    </header>
    <ol class="mr-queue" aria-label="${a(e.s.queue,e.lang)}">${p}</ol>
    <div class="mr-body">
      <div class="mr-map">${ee(s,e)}<p class="mr-note">${$.map(13)}${a(e.s.noVod,e.lang)}</p></div>
      <div class="mr-qcm">
        <p class="mr-summary" data-k="summary" tabindex="-1"><span class="mr-clock">${s.clock}</span><span class="mr-zone">${a(s.zone,e.lang)}</span>${a(s.line,e.lang)}</p>
        ${t.picking?se(t,e):`<p class="mr-question">${a(e.s.question,e.lang)}</p>
        <div class="opts" role="group" aria-label="${a(e.s.question,e.lang)}">${m}
          <button class="${d("opt opt-other",g&&"is-selected")}" data-act="pick" data-k="other" aria-pressed="${!!g}"><span class="opt-main">${a(v,e.lang)}</span>${$.chevron(14)}</button>
        </div>`}
        <div class="mr-after" aria-live="polite">${l}</div>
      </div>
    </div>
    ${c?`<div class="mr-done"><div><p class="mr-done-title">${a(e.s.done,e.lang)}</p><p>${a(T(e.s.doneSummary,{mistakes:r-i,justified:i}),e.lang)}</p></div>
      <span class="mr-xp">${a(T(e.s.doneXp,{xp:e.xp}),e.lang)}</span>
      <button class="app-btn app-btn-ghost" data-act="restart" data-k="restart">${a(e.s.restart,e.lang)}</button></div>`:""}
  </div>`}var C={};j(C,{initialState:()=>ne,reduce:()=>re,render:()=>le});var ne=()=>({calib:null,focus:null});function re(t,e){switch(e.type){case"calib":return{...t,calib:e.f,focus:"calib-result"};default:return t}}function le(t,e){let s=e.lang,n=e.form.map(o=>`<li class="${d("res",o.win&&"res-w")}"><span class="vh">${a(o.label,s)}</span><span aria-hidden="true">${o.letter}</span></li>`).join(""),r=e.calib.families.map(o=>`<button class="${d("opt opt-tight",t.calib===o.id&&"is-selected")}" data-act="calib" data-f="${o.id}" aria-pressed="${t.calib===o.id}"><i class="fam fam-${o.id}"></i><span class="opt-main">${a(o.label,s)}</span></button>`).join(""),c=t.calib?`<div class="${d("calib-result",t.focus==="calib-result"&&"is-new")}" data-k="calib-result" tabindex="-1">
      <p>${a(e.calib.results[t.calib],s)}</p>
      <p class="calib-dist-title">${a(e.calib.distTitle,s)}</p>
      <ul class="dist">${e.calib.dist.map(o=>`<li><span>${a(o.label,s)}</span><span class="bar"><i style="width:${o.share}%"></i></span><b>${o.share} %</b></li>`).join("")}</ul>
    </div>`:"",i=e.stats.map(o=>`<div><dt>${a(o.label,s)}</dt><dd>${a(o.value,s)}</dd></div>`).join("");return`<div class="db">
    <header class="db-head">
      <div>
        <p class="db-hello">${a(e.s.welcome,s)} <b>${a(e.name,s)}</b></p>
        <p class="db-formline">${a(e.s.formLine,s)} <b>${a(e.formWinrate,s)}</b> <span>${a(e.formDelta,s)}</span></p>
      </div>
      <div class="db-form"><span>${a(e.s.form,s)}</span><ol aria-label="${a(e.s.formLabel,s)}">${n}</ol><span class="db-role">${a(e.s.mainRole,s)} <b>${a(e.role,s)}</b></span></div>
    </header>

    <section class="panel calib" aria-live="polite">
      <h3 class="panel-title">${$.gauge(16)}${a(e.calib.title,s)}</h3>
      <p class="panel-sub">${a(e.calib.due,s)}</p>
      <p class="calib-q">${a(e.calib.question,s)}</p>
      <div class="calib-opts" role="group" aria-label="${a(e.calib.question,s)}">${r}</div>
      ${c}
    </section>

    <section class="panel db-session">
      <h3 class="panel-kicker">${a(e.session.title,s)}</h3>
      <p class="db-objective">${a(e.session.objectives,s)}</p>
      <p class="panel-sub">${a(e.session.games,s)}</p>
      <dl class="db-stats">${i}</dl>
    </section>
  </div>`}var I={};j(I,{initialState:()=>ie,reduce:()=>oe,render:()=>ce});var ie=t=>({family:"all",slug:t.rows[0].slug,focus:null}),R=(t,e)=>t.rows.filter(s=>e==="all"||s.family===e);function oe(t,e,s){var n,r;switch(e.type){case"family":{let c=R(s,e.f),i=c.some(o=>o.slug===t.slug)?t.slug:(r=(n=c[0])==null?void 0:n.slug)!=null?r:t.slug;return{family:e.f,slug:i,focus:`fam-${e.f}`}}case"open":return{...t,slug:e.slug,focus:`row-${e.slug}`};default:return t}}function ce(t,e){var v;let s=e.lang,n=R(e,t.family),r=(v=e.rows.find(l=>l.slug===t.slug))!=null?v:e.rows[0],c=e.kpis.map(l=>`<div><dt>${a(l.label,s)}</dt><dd class="${d(l.text&&"is-text")}">${a(l.value,s)}</dd><dd class="kpi-sub">${a(l.sub,s)}</dd></div>`).join(""),i=[{id:"all",label:e.s.all},...e.families].map(l=>`<button class="chip" aria-pressed="${t.family===l.id}" data-act="family" data-f="${l.id}" data-k="fam-${l.id}">${l.id==="all"?"":`<i class="fam fam-${l.id}"></i>`}${a(l.label,s)}</button>`).join(""),o=n.length?n.map(l=>`<li><button class="${d("rank",l.slug===r.slug&&"is-current")}" data-act="open" data-slug="${l.slug}" data-k="row-${l.slug}" aria-pressed="${l.slug===r.slug}">
      <span class="rank-name"><i class="fam fam-${l.family}"></i>${a(l.label,s)}</span>
      <span class="rank-bar"><i style="width:${l.bar}%"></i></span>
      <span class="rank-count">${l.count}\xD7</span><span class="rank-share">${l.share} %</span>
      <span class="${d("rank-delta",l.delta==null&&"is-none",l.delta!=null&&l.delta<0&&"is-cost")}" title="${a(e.s.costTitle,s)}">${a(l.deltaLabel,s)}</span>
    </button></li>`).join(""):`<li class="rank-empty">${a(e.s.none,s)}</li>`,p=r.inspector,m=p.phases.map(l=>`<div><dt>${a(l.label,s)}<small>${a(l.range,s)}</small></dt><dd>${l.count}</dd><dd class="bar"><i style="width:${l.pct}%"></i></dd></div>`).join(""),g=p.moments.map(l=>`<li><span class="mono">${l.clock}</span><span>${a(l.label,s)}</span><span class="${d("res res-s",l.win&&"res-w")}">${l.letter}</span></li>`).join("");return`<div class="lab">
    <dl class="lab-kpis">${c}</dl>
    <div class="lab-cols">
      <section class="panel lab-rank">
        <h3 class="panel-title">${a(e.s.rankingTitle,s)}</h3>
        <div class="chips" role="group" aria-label="${a(e.s.families,s)}">${i}</div>
        <ol class="ranks">${o}</ol>
        <p class="panel-sub">${a(e.s.legend,s)}</p>
      </section>
      <section class="panel lab-inspect" aria-live="polite">
        <h3 class="lab-name">${a(r.label,s)}</h3>
        <p class="lab-family"><i class="fam fam-${r.family}"></i>${a(p.family,s)}</p>
        <p class="panel-sub">${a(p.summary,s)}</p>
        ${p.cost?`<p class="lab-cost">${a(p.cost,s)}</p>`:`<p class="lab-cost is-none">${a(e.s.noGap,s)}</p>`}
        <h4 class="panel-kicker">${a(e.s.when,s)}</h4>
        <dl class="phases">${m}</dl>
        ${p.fiche?`<p class="panel-sub">${a(p.prescTitle,s)}</p>
        <article class="fiche fiche-flat">
          <p class="fiche-kind">${$.book(14)}${a(e.s.codexTitle,s)}</p>
          <h4 class="fiche-title">${a(p.fiche.headline,s)}</h4>
          <p class="fiche-rule">${a(p.fiche.rule,s)}</p>
          <div class="fiche-drill"><span>${a(e.s.drill,s)}</span><p>${a(p.fiche.drill,s)}</p></div>
        </article>`:""}
        <h4 class="panel-kicker">${a(e.s.momentsTitle,s)}</h4>
        <ul class="lab-moments">${g}</ul>
        <p class="lab-hint">${$.target(14)}${a(e.s.actionHint,s)}</p>
      </section>
    </div>
  </div>`}var A={};j(A,{initialState:()=>pe,reduce:()=>ue,render:()=>me});var pe=()=>({role:"carry",axis:null,focus:null});function ue(t,e){switch(e.type){case"role":return{role:e.r,axis:null,focus:`role-${e.r}`};case"axis":return{...t,axis:e.a,focus:`axis-${e.a}`};case"hover":return t.axis===e.a?t:{...t,axis:e.a,focus:null};default:return t}}var S=160,de=104,w=(t,e,s)=>{let n=Math.PI*2*t/e-Math.PI/2,r=de*s/100;return[S+Math.cos(n)*r,S+Math.sin(n)*r]},_=t=>t.map(([e,s])=>`${e.toFixed(1)},${s.toFixed(1)}`).join(" ");function me(t,e){let s=e.lang,n=e.sets[t.role],r=n.points.length,c=[25,50,75,100].map(l=>`<polygon class="rd-ring" points="${_(n.points.map((f,b)=>w(b,r,l)))}"/>`).join(""),i=n.points.map((l,f)=>{let[b,u]=w(f,r,100);return`<line class="${d("rd-spoke",t.axis===l.key&&"is-on")}" x1="${S}" y1="${S}" x2="${b.toFixed(1)}" y2="${u.toFixed(1)}"/>`}).join(""),o=n.points.map((l,f)=>{let[b,u]=w(f,r,122),x=Math.abs(b-S)<12?"middle":b>S?"start":"end";return`<g class="${d("rd-axis",t.axis===l.key&&"is-on")}" data-act="axis" data-hover="hover" data-a="${l.key}"><circle cx="${b.toFixed(1)}" cy="${u.toFixed(1)}" r="20"/><text x="${b.toFixed(1)}" y="${(u+4).toFixed(1)}" text-anchor="${x}">${a(l.label,s)}</text></g>`}).join(""),p=n.points.map((l,f)=>{let[b,u]=w(f,r,l.rs);return`<circle class="${d("rd-dot",t.axis===l.key&&"is-on")}" cx="${b.toFixed(1)}" cy="${u.toFixed(1)}" r="${t.axis===l.key?5:3}"/>`}).join(""),m=n.points.find(l=>l.key===t.axis),g=e.roles.map(l=>`<button class="seg" aria-pressed="${t.role===l.id}" data-act="role" data-r="${l.id}" data-k="role-${l.id}">${a(l.label,s)}</button>`).join(""),v=n.points.map(l=>`<tr class="${d(t.axis===l.key&&"is-on")}">
      <th scope="row"><button data-act="axis" data-hover="hover" data-a="${l.key}" data-k="axis-${l.key}" aria-pressed="${t.axis===l.key}">${a(l.label,s)}</button></th>
      <td>${a(l.recent,s)}</td><td>${a(l.snapshot,s)}</td><td class="${d("gap",l.good&&"is-good")}">${a(l.gap,s)}</td></tr>`).join("");return`<div class="rd">
    <div class="rd-chart">
      <div class="rd-top">
        <h3 class="panel-title">${a(e.s.title,s)}</h3><span class="mono rd-score">${a(n.score,s)}</span>
      </div>
      <svg class="rd-svg" viewBox="0 0 320 320" role="img" aria-label="${a(e.s.title,s)}">
        ${c}${i}
        <polygon class="rd-snap" points="${_(n.points.map((l,f)=>w(f,r,l.ss)))}"/>
        <polygon class="rd-recent" points="${_(n.points.map((l,f)=>w(f,r,l.rs)))}"/>
        ${p}${o}
      </svg>
      <p class="rd-legend"><span><i class="lg lg-recent"></i>${a(e.s.recentLabel,s)}</span><span><i class="lg lg-snap"></i>${a(e.s.snapshotLabel,s)}</span></p>
      <p class="rd-readout" aria-live="polite">${a(m?m.readout:e.s.readoutIdle,s)}</p>
    </div>
    <div class="rd-side">
      <div class="segs" role="group" aria-label="${a(e.s.roleLabel,s)}">${g}</div>
      <table class="rd-table">
        <thead><tr><th scope="col">${a(e.s.colAxis,s)}</th><th scope="col">${a(e.s.colRecent,s)}</th><th scope="col">${a(e.s.colSnapshot,s)}</th><th scope="col">${a(e.s.colGap,s)}</th></tr></thead>
        <tbody>${v}</tbody>
      </table>
      <p class="panel-sub">${a(e.s.scale,s)}</p>
    </div>
  </div>`}var P={};j(P,{initialState:()=>$e,reduce:()=>he,render:()=>fe});var $e=t=>({id:t.current,focus:null});function he(t,e){return e.type==="tier"?{id:e.id,focus:`tier-${e.id}`}:t}function fe(t,e){var c;let s=e.lang,n=(c=e.tiers.find(i=>i.id===t.id))!=null?c:e.tiers[0],r=e.tiers.map(i=>`<li style="--h:${i.height}">
      <button class="${d("step",i.id===n.id&&"is-current",i.id===e.current&&"is-player")}" data-act="tier" data-id="${i.id}" data-k="tier-${i.id}" aria-pressed="${i.id===n.id}">
        <span class="step-name">${a(i.label,s)}</span><span class="step-level mono">${a(i.levelShort,s)}</span>
        <span class="step-bar" aria-hidden="true"></span>
      </button></li>`).join("");return`<div class="tiers">
    <ol class="stairs" aria-label="${a(e.s.scaleLabel,s)}">${r}</ol>
    <div class="tier-detail" aria-live="polite">
      <h3 class="tier-name">${a(n.label,s)}</h3>
      <p class="tier-level mono">${a(n.level,s)}</p>
      <ul>${n.detail.map(i=>`<li>${a(i,s)}</li>`).join("")}</ul>
      ${n.id===e.current?`<p class="tier-you">${a(e.s.you,s)}</p>`:""}
    </div>
  </div>`}var be=[["black","bg"],["dark","surface"],["panel","panel"],["border-dim","line"],["border","line-strong"],["gold","accent"],["gold-bright","accent-hi"],["cyan","second"],["text","text"],["text-bright","text-hi"]],ge="--hextech-";function V(t){return be.map(([e,s])=>{let n=t[ge+e];if(!/^#[0-9a-f]{6}$/i.test(n!=null?n:""))throw new Error(`theme token ${e} is not a colour: ${n}`);return[`--app-${s}`,n.toUpperCase()]})}function U(t,e){var c,i;let s=o=>{let[p,m=""]=String(o).replace(/^v/,"").split("-");return{core:p.split(".").map(Number),pre:m?m.split("."):[]}},n=s(t),r=s(e);if(n.core.some(Number.isNaN)||r.core.some(Number.isNaN))return!1;for(let o=0;o<Math.max(n.core.length,r.core.length);o++){let p=((c=n.core[o])!=null?c:0)-((i=r.core[o])!=null?i:0);if(p!==0)return p>0}if(!n.pre.length||!r.pre.length)return!n.pre.length&&r.pre.length>0;for(let o=0;o<Math.max(n.pre.length,r.pre.length);o++){let p=n.pre[o],m=r.pre[o];if(p===void 0)return!1;if(m===void 0)return!0;if(p===m)continue;let g=Number(p),v=Number(m);return!Number.isNaN(g)&&!Number.isNaN(v)?g>v:p>m}return!1}var O=t=>[1,3,5].map(e=>parseInt(t.slice(e,e+2),16)),xe=t=>"#"+t.map(e=>Math.round(Math.min(255,Math.max(0,e))).toString(16).padStart(2,"0")).join("").toUpperCase();function h(t,e,s){let n=O(t),r=O(e);return xe(n.map((c,i)=>c+(r[i]-c)*s))}function X(t){let e=r=>{let[c,i,o]=O(r);return(.2126*c+.7152*i+.0722*o)/255},s=e(t.base)>.12?h(t.base,"#000000",1-.12/e(t.base)):t.base,n="#FFFFFF";return{"--hextech-black":s,"--hextech-dark":h(s,n,.04),"--hextech-elevated":h(s,n,.09),"--hextech-panel":h(s,n,.09),"--hextech-border":h(s,t.accent,.55),"--hextech-border-dim":h(h(s,n,.08),t.accent,.22),"--hextech-cyan":t.secondary,"--hextech-teal":h(t.secondary,s,.4),"--hextech-gold":t.accent,"--hextech-gold-bright":h(t.accent,n,.72),"--hextech-text":h(h(n,t.accent,.12),s,.3),"--hextech-text-bright":h(n,t.accent,.08),"--hextech-text-dim":h(h(n,t.accent,.12),s,.58),"--hextech-blue":h(s,n,.06),"--hextech-blue-bright":h(t.accent,n,.35)}}var ye={micro:N,dashboard:C,lab:I,radar:A,tiers:P},D=t=>{let e=document.getElementById(t);return e?JSON.parse(e.textContent):null};function ve(t){let e=t.dataset.exhibit,s=ye[e],n=D(`data-${e}`);if(!s||!n)return;let r=s.initialState(n),c=(i,o)=>{let p=s.reduce(r,{...o.dataset,type:i},n);if(p===r||(r=p,t.innerHTML=s.render(r,n),!r.focus))return;let m=t.querySelector(`[data-k="${r.focus}"]`);m&&(m.focus({preventScroll:!0}),m.scrollIntoView({block:"nearest"}))};t.addEventListener("click",i=>{let o=i.target.closest("[data-act]");o&&t.contains(o)&&c(o.dataset.act,o)}),t.addEventListener("pointerover",i=>{if(i.pointerType!=="mouse")return;let o=i.target.closest("[data-hover]");o&&t.contains(o)&&c(o.dataset.hover,o)})}document.querySelectorAll("[data-exhibit]").forEach(ve);var M=document.querySelector("[data-themes]"),J=D("data-themes");if(M&&J){let t=M.querySelector("[data-sample]"),e=M.querySelector('input[name="theme"][value="custom"]'),s=e.parentElement.querySelectorAll(".sw-chip i"),n=i=>M.querySelector(`input[name="${i}"]`),r=()=>V(X({base:n("base").value,accent:n("accent").value,secondary:n("secondary").value})),c=i=>{for(let[o,p]of i)t.style.setProperty(o,p)};M.addEventListener("change",i=>{i.target.name==="theme"&&c(i.target.value==="custom"?r():J.presets[i.target.value])}),M.addEventListener("input",i=>{if(i.target.type!=="color")return;let o=r(),p=Object.fromEntries(o);e.checked=!0,c(o),s[0].style.background=p["--app-bg"],s[1].style.background=p["--app-accent"],s[2].style.background=p["--app-second"]})}var L=document.querySelector("[data-rail]"),k=L&&L.querySelector("[data-toggle]");if(k){let t=e=>{L.classList.toggle("is-open",e),k.setAttribute("aria-expanded",String(e))};k.setAttribute("role","button"),t(!1),k.addEventListener("click",e=>{e.preventDefault(),t(!L.classList.contains("is-open"))}),k.addEventListener("keydown",e=>{e.key===" "&&(e.preventDefault(),k.click())}),L.querySelector(".rail-nav").addEventListener("click",e=>{e.target.closest("a")&&t(!1)}),document.addEventListener("keydown",e=>{e.key!=="Escape"||!L.classList.contains("is-open")||(t(!1),k.focus())})}var H=new Map;document.querySelectorAll('.rail-nav a[href^="#"]').forEach(t=>H.set(t.getAttribute("href").slice(1),t));var B=[...H.keys()].map(t=>document.getElementById(t)).filter(Boolean);if(B.length&&"IntersectionObserver"in window){let t=new Set,e=new IntersectionObserver(s=>{for(let r of s)r.isIntersecting?t.add(r.target.id):t.delete(r.target.id);let n=B.find(r=>t.has(r.id));for(let[r,c]of H)n&&n.id===r?c.setAttribute("aria-current","location"):c.removeAttribute("aria-current")},{rootMargin:"-20% 0px -70% 0px"});B.forEach(s=>e.observe(s))}var E=D("data-release");E&&"fetch"in window&&fetch(E.api,{headers:{Accept:"application/vnd.github+json"}}).then(t=>t.ok?t.json():[]).then(t=>{let e=i=>/Setup.*\.exe$/i.test(i.name),s=t.find(i=>!i.draft&&i.assets.some(e));if(!s)return;let n=s.tag_name.replace(/^v/,"");if(!U(n,E.version))return;let r=s.assets.find(e),c=`${new Intl.NumberFormat(E.locale).format(Math.round(r.size/1048576))} ${E.sizeUnit}`;document.querySelectorAll("[data-download]").forEach(i=>{i.href=r.browser_download_url}),document.querySelectorAll("[data-version]").forEach(i=>{i.textContent=n}),document.querySelectorAll("[data-size]").forEach(i=>{i.textContent=c}),document.querySelectorAll("[data-verify]").forEach(i=>{i.hidden=!0})}).catch(()=>{});})();
