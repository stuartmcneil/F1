/* F1 Fantasy Tracker — shared logic. No build step, no backend: everything is stored in this browser (localStorage). */
(function(){
  const D = window.F1DATA;
  const KEY = "f1fantasy.v1";

  /* ---------- state ---------- */
  const defaults = () => ({
    team: { drivers: [], constructors: [], boost: null, name: "" },
    chipsUsed: {},                 // {chipId: roundNumber}
    chipPlan: {},                  // manual overrides {chipId: roundNumber}
    priceOverrides: {},            // {id: price}
    fpOverrides: {},               // {id: avg fantasy points}
    budget: D.rules.budget,
    freeTransfers: D.rules.freeTransfers,
    history: [],                   // [{round, points, rank, notes}]
    transfers: [],                 // [{round, out, in, date}]
    live: null,                    // {standings, constructors, results, fetchedAt, round}
    wiki: {},                      // {title: {thumb, extract, url, ts}}
    settings: { useWiki: true }
  });
  let S;
  try { S = Object.assign(defaults(), JSON.parse(localStorage.getItem(KEY) || "{}")); }
  catch(e){ S = defaults(); }
  function save(){ try{ localStorage.setItem(KEY, JSON.stringify(S)); }catch(e){} }

  /* ---------- merged data accessors ---------- */
  function teams(){
    return D.teams.map(t => {
      const o = Object.assign({}, t);
      if (S.priceOverrides[t.id] != null) { o.price = S.priceOverrides[t.id]; o.est = false; }
      if (S.fpOverrides[t.id] != null) o.avgFp = S.fpOverrides[t.id];
      const lv = S.live && S.live.constructors && S.live.constructors[t.id];
      if (lv) { o.points = lv.points; o.wins = lv.wins; o.pos = lv.pos; }
      return o;
    }).sort((a,b)=>a.pos-b.pos);
  }
  function drivers(){
    return D.drivers.map(d => {
      const o = Object.assign({}, d);
      if (S.priceOverrides[d.id] != null) { o.price = S.priceOverrides[d.id]; o.est = false; }
      if (S.fpOverrides[d.id] != null) o.avgFp = S.fpOverrides[d.id];
      const lv = S.live && S.live.standings && S.live.standings[d.id];
      if (lv) { o.points = lv.points; o.wins = lv.wins; o.pos = lv.pos; }
      return o;
    }).sort((a,b)=>a.pos-b.pos);
  }
  const teamById = id => teams().find(t=>t.id===id);
  const driverById = id => drivers().find(d=>d.id===id);
  function calendar(){
    return D.calendar.map(r => {
      const o = Object.assign({}, r);
      const lv = S.live && S.live.results && S.live.results[r.round];
      if (lv) { o.winner = lv.winner; o.winTeam = lv.winTeam; }
      return o;
    });
  }
  function lastCompletedRound(){
    const cal = calendar();
    let last = 0;
    cal.forEach(r => { if (r.winner) last = Math.max(last, r.round); });
    return Math.max(last, (S.live && S.live.round) || 0, D.lastCompletedRound);
  }
  function nextRace(){
    const now = new Date();
    const cal = calendar();
    return cal.find(r => !r.winner && new Date(r.date + "T23:59:59Z") >= now) || cal.find(r => !r.winner) || cal[cal.length-1];
  }
  function remainingRaces(){ const n = nextRace(); return calendar().filter(r => r.round >= n.round); }

  /* ---------- live refresh (Jolpica / Ergast mirror) ---------- */
  const JOLPICA = "https://api.jolpi.ca/ergast/f1/" + D.season;
  // map Ergast driverIds -> our ids
  const ERG = { antonelli:"antonelli", russell:"russell", hamilton:"hamilton", norris:"norris", leclerc:"leclerc", max_verstappen:"verstappen",
    piastri:"piastri", hadjar:"hadjar", lawson:"lawson", gasly:"gasly", lindblad:"lindblad", colapinto:"colapinto", bearman:"bearman",
    bortoleto:"bortoleto", hulkenberg:"hulkenberg", sainz:"sainz", albon:"albon", ocon:"ocon", alonso:"alonso", stroll:"stroll",
    perez:"perez", bottas:"bottas", tsunoda:"tsunoda" };
  const ERGT = { mercedes:"mercedes", ferrari:"ferrari", mclaren:"mclaren", red_bull:"red_bull", rb:"rb", alpine:"alpine", haas:"haas",
    audi:"audi", williams:"williams", aston_martin:"aston_martin", cadillac:"cadillac" };

  async function refreshLive(){
    const get = async p => (await fetch(JOLPICA + p, {cache:"no-store"})).json();
    const [ds, cs, rs] = await Promise.all([
      get("/driverStandings.json"), get("/constructorStandings.json"), get("/results/1.json?limit=40")
    ]);
    const live = { standings:{}, constructors:{}, results:{}, fetchedAt: Date.now(), round: 0 };
    const dl = ds.MRData.StandingsTable.StandingsLists[0];
    live.round = +dl.round;
    dl.DriverStandings.forEach(x => {
      const id = ERG[x.Driver.driverId] || x.Driver.driverId;
      live.standings[id] = { points:+x.points, wins:+x.wins, pos:+x.position };
    });
    cs.MRData.StandingsTable.StandingsLists[0].ConstructorStandings.forEach(x => {
      const id = ERGT[x.Constructor.constructorId] || x.Constructor.constructorId;
      live.constructors[id] = { points:+x.points, wins:+x.wins, pos:+x.position };
    });
    rs.MRData.RaceTable.Races.forEach(r => {
      const w = r.Results && r.Results[0];
      if (w) live.results[+r.round] = { winner: ERG[w.Driver.driverId] || w.Driver.driverId, winTeam: ERGT[w.Constructor.constructorId] || w.Constructor.constructorId };
    });
    S.live = live; save();
    return live;
  }

  /* ---------- Wikipedia photos + bios (cached 7 days) ---------- */
  async function wiki(title){
    if (!title) return null;
    const c = S.wiki[title];
    if (c && Date.now() - c.ts < 7*864e5) return c;
    if (!S.settings.useWiki) return c || null;
    try {
      const r = await fetch("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title), {headers:{Accept:"application/json"}});
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      const o = { thumb: j.thumbnail ? j.thumbnail.source : null, orig: j.originalimage ? j.originalimage.source : null,
                  extract: j.extract || "", url: j.content_urls ? j.content_urls.desktop.page : "", ts: Date.now() };
      S.wiki[title] = o; save();
      return o;
    } catch(e){ return c || null; }
  }
  // Fill an <img data-wiki="Title"> element (and optional [data-wiki-text] sibling) lazily
  async function hydrateWiki(root){
    root = root || document;
    const els = [...root.querySelectorAll("[data-wiki]")];
    for (const el of els) {
      const w = await wiki(el.dataset.wiki);
      if (!w) continue;
      if (el.tagName === "IMG") {
        if (w.thumb) { el.src = (el.dataset.big && w.orig) ? w.orig : w.thumb.replace(/\/\d+px-/, "/" + (el.dataset.px||400) + "px-"); el.classList.remove("hidden"); }
      } else if (el.dataset.wikiText != null) {
        el.innerHTML = w.extract ? `${esc(w.extract)} ${w.url?`<a class="muted" href="${w.url}" target="_blank" rel="noopener">Wikipedia ↗</a>`:""}` : "";
      }
    }
  }

  /* ---------- original F1 car illustration (side view) ---------- */
  function carSVG(c1, c2, opts){
    opts = opts || {}; const num = opts.num != null ? opts.num : "";
    c1 = c1 || "#e10600"; c2 = c2 || "#ffffff";
    const id = "g" + Math.random().toString(36).slice(2,7);
    return `
<svg viewBox="0 0 900 260" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Formula 1 car illustration">
  <defs>
    <linearGradient id="${id}b" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c1}" stop-opacity=".7"/></linearGradient>
    <linearGradient id="${id}t" x1="0" x2="1"><stop offset="0" stop-color="#222"/><stop offset=".5" stop-color="#3a3a3a"/><stop offset="1" stop-color="#111"/></linearGradient>
    <filter id="${id}s" x="-10%" y="-10%" width="120%" height="140%"><feDropShadow dx="0" dy="14" stdDeviation="10" flood-color="#000" flood-opacity=".55"/></filter>
  </defs>
  <g filter="url(#${id}s)">
    <!-- floor / diffuser -->
    <path d="M120 190 L790 190 L810 176 L770 170 L150 172 Z" fill="#101010"/>
    <!-- rear wing -->
    <path d="M760 70 L865 62 L868 82 L764 90 Z" fill="${c1}"/>
    <path d="M770 92 L860 88 L862 104 L774 108 Z" fill="${c2}"/>
    <path d="M790 106 L800 150 L812 150 L804 106 Z" fill="#1a1a1a"/>
    <path d="M840 104 L846 150 L858 150 L854 104 Z" fill="#1a1a1a"/>
    <!-- engine cover / body -->
    <path d="M150 165 C 230 165, 300 120, 420 112 C 520 104, 600 96, 690 96 C 760 96, 790 120, 820 150 L 820 172 L 150 172 Z" fill="url(#${id}b)"/>
    <!-- sidepod -->
    <path d="M330 172 C 340 138, 420 128, 560 132 C 640 134, 700 150, 760 172 Z" fill="${c1}"/>
    <path d="M360 172 C 380 150, 470 142, 560 146 C 640 150, 690 158, 740 172 Z" fill="${c2}" opacity=".85"/>
    <!-- airbox + halo -->
    <path d="M520 100 L560 60 L640 60 L650 100 Z" fill="${c1}"/>
    <path d="M470 118 C 500 76, 560 70, 610 92" fill="none" stroke="#1a1a1a" stroke-width="9" stroke-linecap="round"/>
    <path d="M500 118 L520 96" stroke="#1a1a1a" stroke-width="8" stroke-linecap="round"/>
    <!-- cockpit + helmet -->
    <path d="M455 118 L560 118 L570 104 L470 104 Z" fill="#111"/>
    <circle cx="530" cy="104" r="16" fill="${c2}" stroke="#111" stroke-width="3"/>
    <rect x="516" y="98" width="20" height="8" rx="3" fill="#111"/>
    <!-- nose -->
    <path d="M150 165 C 100 158, 60 150, 30 154 L 25 168 C 60 170, 120 172, 150 172 Z" fill="${c1}"/>
    <text x="330" y="160" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="30" fill="${c2}" opacity=".9">${num}</text>
    <!-- front wing -->
    <path d="M10 178 L190 176 L192 190 L12 192 Z" fill="${c1}"/>
    <path d="M14 162 L20 178 L26 178 L22 162 Z" fill="#1a1a1a"/>
    <path d="M40 186 L200 184 L200 196 L40 198 Z" fill="${c2}"/>
    <!-- suspension -->
    <path d="M215 130 L260 168 M215 130 L180 166 M665 118 L700 168 M665 118 L730 166" stroke="#222" stroke-width="7" stroke-linecap="round"/>
    <path d="M150 140 L215 128 L280 140" fill="none" stroke="#222" stroke-width="6"/>
    <path d="M610 124 L665 116 L740 130" fill="none" stroke="#222" stroke-width="6"/>
    <!-- wheels -->
    <g><ellipse cx="215" cy="175" rx="62" ry="60" fill="url(#${id}t)"/><ellipse cx="215" cy="175" rx="36" ry="35" fill="#2b2b2b" stroke="#555" stroke-width="3"/><ellipse cx="215" cy="175" rx="10" ry="10" fill="#777"/>
       <path d="M155 175 A60 60 0 0 1 275 175" fill="none" stroke="${c2}" stroke-width="3" opacity=".6"/></g>
    <g><ellipse cx="700" cy="175" rx="64" ry="62" fill="url(#${id}t)"/><ellipse cx="700" cy="175" rx="37" ry="36" fill="#2b2b2b" stroke="#555" stroke-width="3"/><ellipse cx="700" cy="175" rx="10" ry="10" fill="#777"/>
       <path d="M638 175 A62 62 0 0 1 762 175" fill="none" stroke="${c2}" stroke-width="3" opacity=".6"/></g>
    <!-- wheel covers (2026 style) -->
    <path d="M150 120 L280 120 L270 132 L160 132 Z" fill="#1a1a1a"/>
    <path d="M635 118 L765 118 L756 130 L645 130 Z" fill="#1a1a1a"/>
  </g>
</svg>`;
  }

  /* ---------- strategy engine ---------- */
  // Expected fantasy points for a driver at a given race (track-adjusted)
  function projDriver(d, race){
    let p = d.avgFp || 5;
    if (!race) return p;
    const t = teamById(d.team) || {};
    if (race.sprint) p *= 1.25;                              // extra scoring session
    if (race.type === "street") { p += (d.avgFp||0) < 15 ? 2 : 0; p -= (d.avgFp||0) > 30 ? 1 : 0; } // chaos favours cheap overtakers
    if (race.newCircuit) p *= 0.97;                           // uncertainty haircut
    if (d.country && race.country && d.country.indexOf(race.country) >= 0) p += 1; // home race bump
    if (d.id === "antonelli" && race.round === 13) p += 8;    // Monza grid penalty -> overtake points
    if (d.reserve) p = Math.min(p, 8);
    return p;
  }
  function projTeam(t, race){
    let p = t.avgFp || 5;
    if (race && race.sprint) p *= 1.2;
    return p;
  }
  function teamProjection(team, race){
    const ds = team.drivers.map(driverById).filter(Boolean);
    const cs = team.constructors.map(teamById).filter(Boolean);
    let total = 0;
    ds.forEach(d => { let p = projDriver(d, race); if (team.boost === d.id) p += p * 0.65; total += p; }); // 2x applies to GP part (~65% of a weekend)
    cs.forEach(c => total += projTeam(c, race));
    return total;
  }
  function teamCost(team){
    return team.drivers.map(driverById).filter(Boolean).reduce((a,d)=>a+d.price,0) +
           team.constructors.map(teamById).filter(Boolean).reduce((a,t)=>a+t.price,0);
  }
  function bestBoost(team, race){
    let best=null, bp=-1;
    team.drivers.map(driverById).filter(Boolean).forEach(d => { const p=projDriver(d,race); if (p>bp){bp=p;best=d.id;} });
    return best;
  }

  // Suggest transfers: all single and double swaps (drivers and constructors) within budget
  function suggestTransfers(team, race, opts){
    opts = opts || {};
    const budget = Math.max(S.budget, teamCost(team)), free = opts.free != null ? opts.free : S.freeTransfers, pen = D.rules.transferPenalty;
    const horizon = opts.horizon || 1; // races to look ahead
    const races = remainingRaces().slice(0, horizon);
    const baseTeam = { drivers:[...team.drivers], constructors:[...team.constructors], boost:null };
    const score = t => races.reduce((a,r)=>{ t.boost = bestBoost(t,r); return a + teamProjection(t,r); },0);
    const base = score(baseTeam);
    const allD = drivers().filter(d=>!d.reserve), allT = teams();
    const out = [];
    const consider = (t, moves) => {
      if (teamCost(t) > budget + 1e-9) return;
      const n = moves.length, penalty = Math.max(0, n-free) * -pen;
      const gain = score(t) - base - penalty;
      if (gain > 0.5) out.push({ moves, gain, cost: teamCost(t), penalty, team: t });
    };
    // single driver swaps
    for (const o of team.drivers) for (const i of allD) if (!team.drivers.includes(i.id)) {
      const t = { drivers: team.drivers.map(x=>x===o?i.id:x), constructors:[...team.constructors] };
      consider(t, [{type:"driver", out:o, in:i.id}]);
    }
    for (const o of team.constructors) for (const i of allT) if (!team.constructors.includes(i.id)) {
      const t = { drivers:[...team.drivers], constructors: team.constructors.map(x=>x===o?i.id:x) };
      consider(t, [{type:"constructor", out:o, in:i.id}]);
    }
    // double driver swaps
    const outs = team.drivers;
    for (let a=0;a<outs.length;a++) for (let b=a+1;b<outs.length;b++)
      for (const i of allD) if (!team.drivers.includes(i.id)) for (const j of allD) if (j.id!==i.id && !team.drivers.includes(j.id) && i.id < j.id) {
        const t = { drivers: team.drivers.map(x=>x===outs[a]?i.id:(x===outs[b]?j.id:x)), constructors:[...team.constructors] };
        consider(t, [{type:"driver", out:outs[a], in:i.id},{type:"driver", out:outs[b], in:j.id}]);
      }
    // driver + constructor
    for (const o of team.drivers) for (const i of allD) if (!team.drivers.includes(i.id))
      for (const oc of team.constructors) for (const ic of allT) if (!team.constructors.includes(ic.id)) {
        const t = { drivers: team.drivers.map(x=>x===o?i.id:x), constructors: team.constructors.map(x=>x===oc?ic.id:x) };
        consider(t, [{type:"driver", out:o, in:i.id},{type:"constructor", out:oc, in:ic.id}]);
      }
    out.sort((a,b)=>b.gain-a.gain);
    // de-duplicate by resulting team
    const seen = new Set(); const uniq = [];
    for (const s of out) { const k = [...s.team.drivers].sort().join(",")+"|"+[...s.team.constructors].sort().join(","); if (!seen.has(k)) { seen.add(k); uniq.push(s); } }
    return { base, suggestions: uniq.slice(0, opts.limit || 8) };
  }

  // Brute-force best team under a budget for a race (or the remaining horizon)
  function bestTeam(budget, race, horizon){
    const races = horizon ? remainingRaces().slice(0,horizon) : [race];
    const allD = drivers().filter(d=>!d.reserve), allT = teams();
    const pd = allD.map(d => ({ id:d.id, price:d.price, p: races.reduce((a,r)=>a+projDriver(d,r),0) }));
    const pt = allT.map(t => ({ id:t.id, price:t.price, p: races.reduce((a,r)=>a+projTeam(t,r),0) }));
    pd.sort((a,b)=>b.p-a.p);
    let best = null, bp = -1;
    const n = pd.length;
    const cPairs = [];
    for (let a=0;a<pt.length;a++) for (let b=a+1;b<pt.length;b++) cPairs.push({ids:[pt[a].id,pt[b].id], price:pt[a].price+pt[b].price, p:pt[a].p+pt[b].p});
    for (let a=0;a<n;a++) for (let b=a+1;b<n;b++) for (let c=b+1;c<n;c++) for (let d=c+1;d<n;d++) for (let e=d+1;e<n;e++) {
      const price = pd[a].price+pd[b].price+pd[c].price+pd[d].price+pd[e].price;
      if (price > budget) continue;
      const top = Math.max(pd[a].p,pd[b].p,pd[c].p,pd[d].p,pd[e].p);
      const pts = pd[a].p+pd[b].p+pd[c].p+pd[d].p+pd[e].p + top*0.65;
      for (const cp of cPairs) {
        if (price + cp.price > budget) continue;
        const tot = pts + cp.p;
        if (tot > bp) { bp = tot; best = { drivers:[pd[a].id,pd[b].id,pd[c].id,pd[d].id,pd[e].id], constructors: cp.ids, cost: price+cp.price, proj: tot }; }
      }
    }
    return best;
  }

  // Chip plan: score each remaining race for each unused chip, assign greedily (one chip per weekend)
  function chipPlan(){
    const rem = remainingRaces();
    const unused = D.chips.filter(c => !S.chipsUsed[c.id]);
    const last = rem[rem.length-1];
    const scores = {};
    for (const c of unused) {
      scores[c.id] = rem.map(r => {
        let s = 0, why = [];
        switch (c.id) {
          case "3x":
            s = 5; if (r.sprint) { s += 6; why.push("Sprint weekend: extra session tripled"); }
            if (r.type !== "street") { s += 1; why.push("low chaos — premium driver likely to convert"); }
            if (r.round === 13) { s += 2; why.push("Antonelli grid penalty = overtake points ×3"); }
            break;
          case "limitless":
            s = 5; if (r.sprint) { s += 3; why.push("Sprint weekend maximises premium assets"); }
            if (r.type !== "street") { s += 2; why.push("predictable race for a max-price line-up"); }
            if (r.round === 13) { s += 3; why.push("home race for Ferrari, Antonelli from the back, McLaren flying"); }
            if (r.round === 21) { s += 2; why.push("Vegas: top-speed cars dominate, plenty of overtakes"); }
            break;
          case "wildcard":
            s = 4; if (r.round === 15) { s += 4; why.push("last chance to restructure before the flyaway run"); }
            if (r.newCircuit) { s += 2; why.push("new circuit: reshape after seeing practice"); }
            if (r.round === 13) { s += 1; why.push("react to the summer-form shift towards McLaren/Ferrari"); }
            break;
          case "nonegative":
            s = 3; if (r.type === "street") { s += 4; why.push("street circuit: high DNF/penalty risk"); }
            if (r.round === 15) { s += 3; why.push("Baku is historically the biggest crash-fest"); }
            if (r.round === 19) { s += 2; why.push("altitude reliability failures"); }
            if (r.round === 20) { s += 3; why.push("rain lottery at Interlagos"); }
            break;
          case "autopilot":
            s = 4; if (r.newCircuit) { s += 4; why.push("no form data — let the result pick your 2x"); }
            if (r.round === 20) { s += 3; why.push("weather can flip the order"); }
            if (r.type === "street") { s += 1; why.push("unpredictable running order"); }
            break;
          case "finalfix":
            s = 3; if (r.round === 20) { s += 4; why.push("swap after a wet/grid-penalty qualifying"); }
            if (r.round === 16) { s += 2; why.push("tropical storms often hit Saturday"); }
            if (r.round === 19) { s += 2; why.push("grid penalties common late season"); }
            if (r === last) { s += 2; why.push("use it or lose it"); }
            break;
        }
        return { round: r.round, score: s, why };
      });
    }
    // greedy assignment, honouring manual overrides
    const taken = new Set(Object.values(S.chipPlan));
    const plan = {};
    for (const [cid, rnd] of Object.entries(S.chipPlan)) if (unused.find(c=>c.id===cid)) plan[cid] = { round: rnd, manual: true, why: ["your choice"] };
    const order = ["3x","limitless","nonegative","wildcard","autopilot","finalfix"];
    for (const cid of order) {
      if (!scores[cid] || plan[cid]) continue;
      const cands = [...scores[cid]].sort((a,b)=>b.score-a.score);
      const pick = cands.find(c => !taken.has(c.round)) || cands[0];
      if (pick) { taken.add(pick.round); plan[cid] = { round: pick.round, manual:false, why: pick.why, alternatives: cands.slice(1,3) }; }
    }
    return { plan, scores };
  }

  /* ---------- UI helpers ---------- */
  const esc = s => String(s==null?"":s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const money = n => "$" + (Math.round(n*10)/10).toFixed(1) + "M";
  const fmtDate = s => new Date(s+"T12:00:00Z").toLocaleDateString("en-GB",{day:"numeric",month:"short"});
  function toast(msg){ const t=document.createElement("div"); t.className="toast"; t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(),2600); }
  function initialsEl(d, cls){ const t=teamById(d.team)||{}; return `<div class="driverimg initials ${cls||""}" style="--tc:${t.color}">${esc(d.code)}</div>`; }
  function driverImg(d, cls){
    const t = teamById(d.team) || {};
    return `<img class="driverimg ${cls||""}" style="--tc:${t.color}" data-wiki="${esc(d.wiki)}" data-px="${cls==='big'?500:250}" alt="${esc(d.first+' '+d.last)}" src="data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><rect width='120' height='120' fill='${t.color||'#444'}'/><text x='60' y='72' text-anchor='middle' font-family='Arial' font-weight='bold' font-size='34' fill='#fff'>${d.code}</text></svg>`)}">`;
  }
  function nav(active){
    const links = [["index.html","Home"],["team.html","My Team"],["strategist.html","Strategist"],["calendar.html","Calendar & Chips"],["teams.html","Teams"],["drivers.html","Drivers"]];
    const el = document.createElement("div"); el.className="nav";
    el.innerHTML = `<div class="in"><a class="brand" href="index.html"><span class="stripe"></span>F1 Fantasy HQ</a>
      ${links.map(l=>`<a class="link ${l[0]===active?'active':''}" href="${l[0]}">${l[1]}</a>`).join("")}
      <button class="ghost small" id="refreshBtn" title="Pull latest standings & results from the Jolpica API">↻ Refresh live data</button></div>`;
    document.body.prepend(el);
    el.querySelector("#refreshBtn").onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = "Refreshing…";
      try { const l = await refreshLive(); toast(`Live data updated — standings after round ${l.round}`); setTimeout(()=>location.reload(), 900); }
      catch(err){ toast("Could not reach live data (offline or API blocked) — using bundled data"); e.target.disabled=false; e.target.textContent="↻ Refresh live data"; }
    };
  }
  function footer(){
    const f = document.createElement("div"); f.className="foot wrap";
    const lv = S.live ? `live standings fetched ${new Date(S.live.fetchedAt).toLocaleString("en-GB")} (after round ${S.live.round})` : `bundled data snapshot ${D.generated} (after round ${D.lastCompletedRound}) — press “Refresh live data”`;
    f.innerHTML = `F1 Fantasy HQ · ${lv} · prices marked <span class="tag">est.</span> are estimates, edit them on the My Team page · all data stays in this browser (localStorage) · <a href="https://fantasy.formula1.com" target="_blank" rel="noopener">fantasy.formula1.com ↗</a> · Not affiliated with Formula 1.`;
    document.querySelector(".wrap")?.after(f);
  }
  function chipName(id){ const c = D.chips.find(c=>c.id===id); return c ? c.name : id; }

  window.F1 = { D, S, save, teams, drivers, teamById, driverById, calendar, nextRace, remainingRaces, lastCompletedRound,
    refreshLive, wiki, hydrateWiki, carSVG, projDriver, projTeam, teamProjection, teamCost, bestBoost, suggestTransfers, bestTeam, chipPlan,
    esc, money, fmtDate, toast, driverImg, initialsEl, nav, footer, chipName };
})();
