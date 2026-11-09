const socket = io();
const $ = id => document.getElementById(id);
const screens = ["home","lobby","game","finished"];
const teams = [
  ["Real Madrid","RM","#f5f5f5","#c8a64d"],["Barcelona","FCB","#183b83","#a91d35"],
  ["Manchester United","MUN","#d52831","#f0c34c"],["Manchester City","MCI","#6caddf","#fff"],
  ["Liverpool","LIV","#d92732","#e8c64c"],["Bayern Münih","FCB","#d92938","#fff"],
  ["Borussia Dortmund","BVB","#f4d52b","#111"],["PSG","PSG","#153a78","#e53b56"],
  ["Beşiktaş","BJK","#111","#fff"],["Fenerbahçe","FB","#f2d12f","#1a4c9a"],
  ["Galatasaray","GS","#d92836","#e9a52e"],["Trabzonspor","TS","#7d2439","#79b7dc"],
  ["Arsenal","ARS","#d82e37","#fff"],["Chelsea","CHE","#164b9a","#fff"],
  ["Milan","MIL","#c82c35","#111"],["Inter","INT","#143d85","#111"]
];
let room = null, myIndex = -1, myTeam = null, amReady = false, locked = false, lastResult = null;
const toast = msg => { $("toast").textContent = msg; $("toast").classList.add("show"); setTimeout(()=>$("toast").classList.remove("show"),2600); };
function show(id){ screens.forEach(s=>$(s).classList.toggle("hidden",s!==id)); }
function name(){ return $("playerName").value.trim() || "Oyuncu"; }
function teamData(name){ return teams.find(t=>t[0]===name); }
function crestHTML(t){ return `<div class="crest" style="background:linear-gradient(145deg,${t[2]},${t[3]})">${t[1]}</div>`; }
function drawTeams(){
  $("teams").innerHTML = teams.map(t=>`<button class="team-card ${myTeam===t[0]?'selected':''}" data-team="${t[0]}" ${amReady?'disabled':''}>${crestHTML(t)}<span class="team-name">${t[0]}</span></button>`).join("");
  document.querySelectorAll(".team-card").forEach(b=>b.addEventListener("click",()=>socket.emit("team:select",{team:b.dataset.team})));
}
function updateRoom(r){
  room=r;
  // Slot is assigned by the server: room creator is 0, joining player is 1.
  myIndex=window.__myIndex ?? 0;
  const me=r.players[myIndex];
  myTeam=me?.team||null; amReady=!!me?.ready;
  $("player0").querySelector(".p-name").textContent=r.players[0]?.name||"Bekleniyor";
  $("player1").querySelector(".p-name").textContent=r.players[1]?.name||"Rakip bekleniyor";
  [0,1].forEach(i=>{
    const p=r.players[i], card=$("player"+i);
    card.querySelector(".p-team").textContent=p?.team||"Takım seçmedi";
    const st=card.querySelector(".status");
    st.textContent=p?(p.ready?"HAZIR":"HAZIR DEĞİL"):"BEKLİYOR";
    st.classList.toggle("ready",!!p?.ready);
  });
  $("lobbyMessage").textContent=r.message;
  $("readyBtn").textContent=amReady?"HAZIR DEĞİL":"HAZIR";
  $("readyBtn").disabled=!myTeam && !amReady;
  $("startBtn").disabled=!(window.__isHost && r.players.length===2 && r.players.every(p=>p.ready&&p.team));
  drawTeams();
  if(r.status==="waiting") show("lobby");
  if(r.status==="playing"||r.status==="paused") { show("game"); renderGame(r); }
  if(r.status==="finished"){ show("finished"); $("winnerText").textContent=r.message; $("finalScore").textContent=`${r.scores[0]} - ${r.scores[1]}`; $("finishMessage").textContent="Rövanş için iki oyuncunun da istekte bulunması gerekiyor."; }
}
function renderGame(r){
  const p0=r.players[0],p1=r.players[1];
  $("gameTeam0").textContent=p0?.team||"EV SAHİBİ"; $("gameTeam1").textContent=p1?.team||"DEPLASMAN";
  $("gameLogo0").textContent=teamData(p0?.team)?.[1]||"1"; $("gameLogo1").textContent=teamData(p1?.team)?.[1]||"2";
  $("score").textContent=`${r.scores[0]} - ${r.scores[1]}`;
  $("roundLabel").textContent=r.suddenDeath?`ALTIN GOL • ${r.round}. ATIŞ`:`PENALTI ${Math.min(r.round,10)} / 10`;
  [0,1].forEach(i=>{
    const count=r.kicks[i]||0;
    $(`dots${i}`).innerHTML=Array.from({length:5},(_,j)=>`<i class="dot ${j<count?'scored':''}"></i>`).join("");
  });
  const shooter=r.shooter, me=window.__myIndex??0;
  const isShooter=me===shooter;
  $("turnNotice").textContent=isShooter?"ŞUT SIRASI SENDE":"KALECİ SIRASI SENDE";
  $("controlHeading").textContent=isShooter?"ŞUT YÖNÜNÜ SEÇ":"DALIŞ YÖNÜNÜ SEÇ";
  $("selectionStatus").textContent=r.selections?.[me]?"Seçimin kilitlendi. Rakibin seçimi bekleniyor.":"Seçimin rakibinden gizli.";
  document.querySelectorAll(".direction").forEach(b=>{b.disabled=locked||!!r.selections?.[me]||!!r.result;b.classList.toggle("chosen",!!r.selections?.[me]);});
  if(r.result && (!lastResult || lastResult!==r.result)) animateResult(r.result);
  if(r.status==="paused") $("turnNotice").textContent="RAKİBİN BAĞLANTISI KESİLDİ";
}
function animateResult(result){
  lastResult=result;
  const keeper=$("keeper"),ball=$("ball"),striker=$("striker"),txt=$("resultText");
  const x={left:-105,center:0,right:105};
  striker.style.transform="translateX(-50%) translateY(-22px) rotate(-8deg)";
  setTimeout(()=>{
    ball.style.left=`calc(50% + ${x[result.shotDirection]}px)`;
    ball.style.bottom=result.goal?"47%":"43%";
    ball.style.transform="translateX(-50%) scale(1.35)";
    keeper.style.transform=`translateX(calc(-50% + ${x[result.keeperDirection]}px)) rotate(${result.keeperDirection==="left"?-55:result.keeperDirection==="right"?55:0}deg) translateY(-12px)`;
  },260);
  txt.textContent=result.goal?"GOOOL!":"KURTARIŞ!";
  txt.style.color=result.goal?"#f5bd54":"#69e2cb";
  setTimeout(()=>txt.classList.add("show"),500);
  playTone(result.goal);
  setTimeout(()=>{
    txt.classList.remove("show"); keeper.style.transform="translateX(-50%)"; striker.style.transform="translateX(-50%)";
    ball.style.left="50%";ball.style.bottom="12%";ball.style.transform="translateX(-50%)";
    lastResult=null;
  },3200);
}
function playTone(goal){
  try{
    const ctx=new (window.AudioContext||window.webkitAudioContext)();
    const osc=ctx.createOscillator(),gain=ctx.createGain();
    osc.type="triangle";osc.frequency.setValueAtTime(goal?180:420,ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(goal?75:180,ctx.currentTime+.35);
    gain.gain.setValueAtTime(.0001,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.18,ctx.currentTime+.02);gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+.5);
    osc.connect(gain);gain.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+.52);
  }catch(e){}
}
$("createBtn").onclick=()=>socket.emit("room:create",{name:name()});
$("joinBtn").onclick=()=>socket.emit("room:join",{name:name(),code:$("joinCode").value});
$("copyCode").onclick=()=>{if(room?.code)navigator.clipboard?.writeText(room.code).then(()=>toast("Oda kodu kopyalandı."));};
$("readyBtn").onclick=()=>socket.emit("player:ready",{ready:!amReady});
$("startBtn").onclick=()=>socket.emit("match:start");
$("rematchBtn").onclick=()=>socket.emit("match:rematch");
$("homeBtn").onclick=()=>{socket.emit("room:leave");room=null;myTeam=null;amReady=false;show("home");};
document.querySelectorAll(".direction").forEach(b=>b.onclick=()=>{
  if(locked)return;locked=true;
  document.querySelectorAll(".direction").forEach(x=>x.disabled=true);
  $("selectionStatus").textContent="Seçimin gizlice gönderildi. Rakibin seçimi bekleniyor.";
  socket.emit("kick:choose",{direction:b.dataset.dir});
});
socket.on("room:created",({code})=>{$("copyCode").textContent=code;window.__isHost=true;window.__myIndex=0;show("lobby");});
socket.on("room:state",r=>{
  if(!room && r.players.length) { window.__myIndex=window.__isHost?0:1; }
  if(r.code) $("copyCode").textContent=r.code;
  // Keep the local player index stable even if both users happen to share a display name.
  updateRoom(r);
  if(r.status!=="playing")locked=false;
});
socket.on("room:joined",()=>{});
socket.on("kick:locked",()=>{locked=true;});
socket.on("kick:result",r=>{locked=true;});
socket.on("app:error",msg=>toast(msg));
socket.on("connect",()=>{});
socket.on("disconnect",()=>toast("Bağlantı kesildi. Sayfayı yenileyip yeniden bağlan."));
// The room join event is acknowledged by the first room state; joining client is always slot 1.
const originalJoin=$("joinBtn").onclick;
$("joinBtn").onclick=()=>{window.__isHost=false;window.__myIndex=1;socket.emit("room:join",{name:name(),code:$("joinCode").value});};
