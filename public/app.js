const menu=document.getElementById('menu');
const game=document.getElementById('game');
const statusEl=document.getElementById('status');
const roomLabel=document.getElementById('roomLabel');
const roomInput=document.getElementById('roomInput');
const speedSelect=document.getElementById('speedSelect');
const copyLinkBtn=document.getElementById('copyLinkBtn');
const leftScore=document.getElementById('leftScore');
const rightScore=document.getElementById('rightScore');
const canvas=document.getElementById('canvas');
const ctx=canvas.getContext('2d');
const rotate=document.getElementById('rotate');

const W=1600,H=900,GRID_W=40,GRID_H=22,CELL=40,TOP=10;
const COLORS={
  left:{body:'#4d9d55',belly:'#a8d98e',dark:'#173f21',eye:'#f5d76e'},
  right:{body:'#bd7b31',belly:'#edc276',dark:'#593616',eye:'#fff0a0'}
};

let socket=null,side='left',mode=null,roomCode='',state=null,previousState=null,lastStateAt=0,audioCtx=null;
let pointerStart=null,lastSentDirection=null;

function speedLevel(){return Number(speedSelect.value)||2;}
function setStatus(text){statusEl.textContent=text||'';}
function showGame(label){roomLabel.textContent=label;menu.classList.add('hidden');game.classList.remove('hidden');syncOrientation();tryLandscape();}
function wsUrl(code,hostMode=null,speed=null){const protocol=location.protocol==='https:'?'wss':'ws';const url=new URL(`${protocol}://${location.host}/ws/${code}`);if(hostMode)url.searchParams.set('mode',hostMode);if(speed)url.searchParams.set('speed',String(speed));return url.toString();}
function roomShareUrl(code){const url=new URL(location.origin+location.pathname);url.searchParams.set('room',code);return url.toString();}
function setRoomUrl(code){history.replaceState(null,'',roomShareUrl(code));}

async function createRoom(){const response=await fetch('/api/room/create',{method:'POST'});if(!response.ok)throw new Error('Creazione stanza fallita');return (await response.json()).code;}

function ensureAudio(){const AudioContextClass=window.AudioContext||window.webkitAudioContext;if(!AudioContextClass)return;if(!audioCtx)audioCtx=new AudioContextClass();if(audioCtx.state==='suspended')audioCtx.resume().catch(()=>{});}
function playSfx(name){if(!audioCtx||audioCtx.state!=='running')return;const now=audioCtx.currentTime;const osc=audioCtx.createOscillator();const gain=audioCtx.createGain();osc.connect(gain);gain.connect(audioCtx.destination);if(name==='eat'){osc.type='sine';osc.frequency.setValueAtTime(420,now);osc.frequency.exponentialRampToValueAtTime(720,now+.11);}else if(name==='crash'){osc.type='sawtooth';osc.frequency.setValueAtTime(150,now);osc.frequency.exponentialRampToValueAtTime(70,now+.16);}else{osc.type='triangle';osc.frequency.setValueAtTime(300,now);osc.frequency.exponentialRampToValueAtTime(520,now+.12);}gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(name==='crash'?.075:.055,now+.008);gain.gain.exponentialRampToValueAtTime(.0001,now+.18);osc.start(now);osc.stop(now+.2);}

async function copyRoomLink(){if(!roomCode)return;const url=roomShareUrl(roomCode);let copied=false;try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(url);copied=true;}}catch{}if(!copied){const text=document.createElement('textarea');text.value=url;text.setAttribute('readonly','');text.style.position='fixed';text.style.opacity='0';document.body.appendChild(text);text.select();try{copied=document.execCommand('copy');}catch{}text.remove();}const original=copyLinkBtn.textContent;copyLinkBtn.textContent=copied?'COPIATO!':'COPIA FALLITA';setTimeout(()=>copyLinkBtn.textContent=original,1400);}

function connectRoom(code,hostMode=null,speed=null){return new Promise((resolve,reject)=>{socket=new WebSocket(wsUrl(code,hostMode,speed));socket.onopen=()=>resolve();socket.onerror=()=>reject(new Error('Connessione non riuscita'));socket.onmessage=(event)=>{let message;try{message=JSON.parse(event.data);}catch{return;}if(message.type==='joined'){side=message.side;roomCode=message.code;mode=message.mode;setRoomUrl(roomCode);copyLinkBtn.classList.toggle('hidden',mode!=='pvp');showGame(mode==='cpu'?'1 VS CPU':`STANZA ${roomCode}`);setStatus(mode==='cpu'?'Mangia più frutta della CPU!':side==='left'?`Condividi ${roomCode} oppure usa COPIA LINK`:'Connesso. Buona partita!');}else if(message.type==='state'){previousState=state;state=message;lastStateAt=performance.now();leftScore.textContent=String(message.leftRounds);rightScore.textContent=String(message.rightRounds);roomLabel.textContent=message.mode==='cpu'?'TU  ·  VS  ·  CPU':`STANZA ${message.code}`;}else if(message.type==='sfx'){playSfx(message.name);}};socket.onclose=()=>{if(!game.classList.contains('hidden'))setStatus('Connessione chiusa.');};});}

document.getElementById('cpuBtn').addEventListener('click',async()=>{try{ensureAudio();setStatus('Preparazione partita…');const code=await createRoom();await connectRoom(code,'cpu',speedLevel());}catch(error){setStatus(error.message||'Errore');}});
document.getElementById('createBtn').addEventListener('click',async()=>{try{ensureAudio();setStatus('Creazione stanza…');const code=await createRoom();await connectRoom(code,'pvp',speedLevel());}catch(error){setStatus(error.message||'Errore');}});
document.getElementById('joinBtn').addEventListener('click',async()=>{const code=roomInput.value.trim().toUpperCase();if(!/^[A-Z0-9]{6}$/.test(code)){setStatus('Inserisci un codice stanza di 6 caratteri.');return;}try{ensureAudio();setStatus('Connessione…');await connectRoom(code);}catch(error){setStatus(error.message||'Errore');}});
document.getElementById('copyLinkBtn').addEventListener('click',()=>copyRoomLink());
document.getElementById('backBtn').addEventListener('click',()=>{try{socket?.close();}catch{}location.assign(location.origin+location.pathname);});
document.getElementById('fullscreenBtn').addEventListener('click',async()=>{try{ensureAudio();if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen();await tryLandscape();}catch{}});

async function tryLandscape(){try{if(screen.orientation?.lock)await screen.orientation.lock('landscape');}catch{}}
function syncOrientation(){const portrait=matchMedia('(orientation: portrait)').matches&&innerWidth<900&&!game.classList.contains('hidden');rotate.classList.toggle('hidden',!portrait);}
addEventListener('resize',syncOrientation);addEventListener('orientationchange',syncOrientation);

function sendDirection(direction){if(!socket||socket.readyState!==WebSocket.OPEN||direction===lastSentDirection)return;ensureAudio();lastSentDirection=direction;socket.send(JSON.stringify({type:'turn',direction}));}

const keyMap={arrowup:'up',w:'up',arrowdown:'down',s:'down',arrowleft:'left',a:'left',arrowright:'right',d:'right'};
addEventListener('keydown',(event)=>{const direction=keyMap[event.key.toLowerCase()];if(direction&&!game.classList.contains('hidden')){event.preventDefault();sendDirection(direction);}});
document.querySelectorAll('[data-dir]').forEach((button)=>button.addEventListener('pointerdown',(event)=>{event.preventDefault();sendDirection(button.dataset.dir);}));

canvas.addEventListener('pointerdown',(event)=>{ensureAudio();pointerStart={x:event.clientX,y:event.clientY,id:event.pointerId};canvas.setPointerCapture(event.pointerId);});
canvas.addEventListener('pointerup',(event)=>{if(!pointerStart||pointerStart.id!==event.pointerId)return;const dx=event.clientX-pointerStart.x,dy=event.clientY-pointerStart.y;pointerStart=null;if(Math.hypot(dx,dy)<24)return;sendDirection(Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up'));});

function cellCenter(point){return{x:(point.x+.5)*CELL,y:TOP+(point.y+.5)*CELL};}
function lerp(a,b,t){return a+(b-a)*t;}
function interpolatedSnake(current,previous,t){if(!previous||!previous.length)return current.map(cellCenter);return current.map((point,index)=>{const now=cellCenter(point);const before=cellCenter(previous[Math.min(index,previous.length-1)]||point);return{x:lerp(before.x,now.x,t),y:lerp(before.y,now.y,t)};});}

const fieldDots=Array.from({length:100},(_,i)=>({x:(i*137)%W,y:(i*79+43)%H,r:2+(i%3)}));
function drawField(){const gradient=ctx.createLinearGradient(0,0,0,H);gradient.addColorStop(0,'#355c35');gradient.addColorStop(.52,'#294a2d');gradient.addColorStop(1,'#203d27');ctx.fillStyle=gradient;ctx.fillRect(0,0,W,H);ctx.fillStyle='rgba(216,235,177,.08)';for(const dot of fieldDots){ctx.beginPath();ctx.arc(dot.x,dot.y,dot.r,0,Math.PI*2);ctx.fill();}ctx.strokeStyle='rgba(237,245,218,.08)';ctx.lineWidth=2;ctx.strokeRect(8,8,W-16,H-16);}

function drawFood(food){if(!food)return;const p=cellCenter(food);ctx.save();ctx.translate(p.x,p.y);ctx.fillStyle='rgba(0,0,0,.2)';ctx.beginPath();ctx.ellipse(4,15,18,8,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#d84d48';ctx.beginPath();ctx.arc(0,1,14,0,Math.PI*2);ctx.arc(10,2,11,0,Math.PI*2);ctx.fill();ctx.fillStyle='#f28772';ctx.beginPath();ctx.arc(-4,-4,4,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#59411f';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(4,-10);ctx.quadraticCurveTo(3,-22,10,-27);ctx.stroke();ctx.fillStyle='#71a34a';ctx.beginPath();ctx.ellipse(14,-22,9,5,-.45,0,Math.PI*2);ctx.fill();ctx.restore();}

function snakeAngle(points,direction){if(points.length>1)return Math.atan2(points[0].y-points[1].y,points[0].x-points[1].x);return{right:0,left:Math.PI,up:-Math.PI/2,down:Math.PI/2}[direction]||0;}
function drawSnake(points,rawSnake,direction,palette,isMine){if(!points.length)return;ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.shadowColor='rgba(0,0,0,.3)';ctx.shadowBlur=10;ctx.shadowOffsetY=5;ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);for(let i=1;i<points.length;i++)ctx.lineTo(points[i].x,points[i].y);ctx.strokeStyle=palette.dark;ctx.lineWidth=36;ctx.stroke();ctx.shadowColor='transparent';ctx.strokeStyle=palette.body;ctx.lineWidth=29;ctx.stroke();for(let i=2;i<points.length;i+=2){const p=points[i];ctx.fillStyle=i%4===0?palette.belly:'rgba(255,255,255,.16)';ctx.beginPath();ctx.ellipse(p.x,p.y,7,5,0,0,Math.PI*2);ctx.fill();}const head=points[0];const angle=snakeAngle(points,direction);ctx.translate(head.x,head.y);ctx.rotate(angle);ctx.fillStyle=palette.dark;ctx.beginPath();ctx.ellipse(1,0,25,20,0,0,Math.PI*2);ctx.fill();ctx.fillStyle=palette.body;ctx.beginPath();ctx.ellipse(0,-1,22,17,0,0,Math.PI*2);ctx.fill();ctx.fillStyle=palette.belly;ctx.beginPath();ctx.ellipse(8,8,11,5,.12,0,Math.PI*2);ctx.fill();ctx.fillStyle='#f7f3d8';ctx.beginPath();ctx.arc(7,-9,5.5,0,Math.PI*2);ctx.arc(7,7,5.5,0,Math.PI*2);ctx.fill();ctx.fillStyle='#111';ctx.beginPath();ctx.arc(9,-9,2.6,0,Math.PI*2);ctx.arc(9,7,2.6,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#d34c56';ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(20,0);ctx.lineTo(31,0);ctx.moveTo(31,0);ctx.lineTo(37,-5);ctx.moveTo(31,0);ctx.lineTo(37,5);ctx.stroke();if(isMine){ctx.strokeStyle='rgba(255,255,255,.85)';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(0,0,29,24,0,0,Math.PI*2);ctx.stroke();}ctx.restore();}

function drawOverlay(current){if(!current)return;if(current.status==='waiting'){overlayBox(`STANZA ${current.code}`,'In attesa del secondo serpente…');}else if(current.status==='roundover'){let title='PAREGGIO!';if(current.winner==='left')title=side==='left'?'HAI VINTO IL ROUND!':current.mode==='cpu'?'VINCI TU!':'VINCE IL VERDE!';if(current.winner==='right')title=side==='right'?'HAI VINTO IL ROUND!':current.mode==='cpu'?'VINCE LA CPU!':'VINCE L’AMBRA!';overlayBox(title,'Nuovo round tra un attimo…');}}
function overlayBox(title,subtitle){ctx.fillStyle='rgba(8,24,12,.68)';ctx.fillRect(0,0,W,H);ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='900 64px system-ui';ctx.fillText(title,W/2,H/2-32);ctx.font='700 30px system-ui';ctx.fillStyle='rgba(255,255,255,.82)';ctx.fillText(subtitle,W/2,H/2+42);}

function draw(){requestAnimationFrame(draw);drawField();if(!state){ctx.fillStyle='rgba(255,255,255,.85)';ctx.textAlign='center';ctx.font='900 52px system-ui';ctx.fillText('SnakeBattle',W/2,H/2);return;}const duration=state.tickMs||125;const t=Math.min(1,(performance.now()-lastStateAt)/duration);const leftPoints=interpolatedSnake(state.left,previousState?.left,t);const rightPoints=interpolatedSnake(state.right,previousState?.right,t);drawFood(state.food);drawSnake(leftPoints,state.left,state.leftDirection,COLORS.left,side==='left');drawSnake(rightPoints,state.right,state.rightDirection,COLORS.right,side==='right');drawOverlay(state);}

async function joinSharedRoom(){const code=(new URLSearchParams(location.search).get('room')||'').trim().toUpperCase();if(!/^[A-Z0-9]{6}$/.test(code))return;roomInput.value=code;try{setStatus('Connessione alla stanza condivisa…');await connectRoom(code);}catch(error){setStatus(error.message||'Impossibile entrare nella stanza');}}

draw();
joinSharedRoom();
