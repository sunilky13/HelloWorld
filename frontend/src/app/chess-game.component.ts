import { Component, signal } from '@angular/core';

// ── Types ────────────────────────────────────────────────────────────────────
type Color = 'w' | 'b';
type Piece = string | null;   // 'wK', 'bP', …
type Board = Piece[][];
type Sq = [number, number];
interface CR { wK:boolean; wQ:boolean; bK:boolean; bQ:boolean; }

// ── Display ───────────────────────────────────────────────────────────────────
const SYM: Record<string,string> = {
  wK:'♔',wQ:'♕',wR:'♖',wB:'♗',wN:'♘',wP:'♙',
  bK:'♚',bQ:'♛',bR:'♜',bB:'♝',bN:'♞',bP:'♟'
};

// ── Piece-square tables (white's perspective; flip row for black) ─────────────
const PST: Record<string,number[][]> = {
  P:[ [0,0,0,0,0,0,0,0],[50,50,50,50,50,50,50,50],[10,10,20,30,30,20,10,10],
      [5,5,10,25,25,10,5,5],[0,0,0,20,20,0,0,0],[5,-5,-10,0,0,-10,-5,5],
      [5,10,10,-20,-20,10,10,5],[0,0,0,0,0,0,0,0] ],
  N:[ [-50,-40,-30,-30,-30,-30,-40,-50],[-40,-20,0,0,0,0,-20,-40],
      [-30,0,10,15,15,10,0,-30],[-30,5,15,20,20,15,5,-30],
      [-30,0,15,20,20,15,0,-30],[-30,5,10,15,15,10,5,-30],
      [-40,-20,0,5,5,0,-20,-40],[-50,-40,-30,-30,-30,-30,-40,-50] ],
  B:[ [-20,-10,-10,-10,-10,-10,-10,-20],[-10,0,0,0,0,0,0,-10],
      [-10,0,5,10,10,5,0,-10],[-10,5,5,10,10,5,5,-10],
      [-10,0,10,10,10,10,0,-10],[-10,10,10,10,10,10,10,-10],
      [-10,5,0,0,0,0,5,-10],[-20,-10,-10,-10,-10,-10,-10,-20] ],
  R:[ [0,0,0,0,0,0,0,0],[5,10,10,10,10,10,10,5],[-5,0,0,0,0,0,0,-5],
      [-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],
      [-5,0,0,0,0,0,0,-5],[0,0,0,5,5,0,0,0] ],
  Q:[ [-20,-10,-10,-5,-5,-10,-10,-20],[-10,0,0,0,0,0,0,-10],
      [-10,0,5,5,5,5,0,-10],[-5,0,5,5,5,5,0,-5],[0,0,5,5,5,5,0,-5],
      [-10,5,5,5,5,5,0,-10],[-10,0,5,0,0,0,0,-10],[-20,-10,-10,-5,-5,-10,-10,-20] ],
  K:[ [-30,-40,-40,-50,-50,-40,-40,-30],[-30,-40,-40,-50,-50,-40,-40,-30],
      [-30,-40,-40,-50,-50,-40,-40,-30],[-30,-40,-40,-50,-50,-40,-40,-30],
      [-20,-30,-30,-40,-40,-30,-30,-20],[-10,-20,-20,-20,-20,-20,-20,-10],
      [20,20,0,0,0,0,20,20],[20,30,10,0,0,10,30,20] ]
};
const VAL: Record<string,number> = { P:100,N:320,B:330,R:500,Q:900,K:20000 };

// ── Board setup ───────────────────────────────────────────────────────────────
function initBoard(): Board {
  return [
    ['bR','bN','bB','bQ','bK','bB','bN','bR'],
    ['bP','bP','bP','bP','bP','bP','bP','bP'],
    Array(8).fill(null), Array(8).fill(null),
    Array(8).fill(null), Array(8).fill(null),
    ['wP','wP','wP','wP','wP','wP','wP','wP'],
    ['wR','wN','wB','wQ','wK','wB','wN','wR'],
  ];
}
function clone(b: Board): Board { return b.map(r => [...r]); }
function inB(r:number,c:number){ return r>=0&&r<8&&c>=0&&c<8; }

// ── Attack / check ────────────────────────────────────────────────────────────
function attacked(b:Board,r:number,c:number,by:Color): boolean {
  const pr = by==='w'?r+1:r-1;
  for (const dc of[-1,1]) if(inB(pr,c+dc)&&b[pr][c+dc]===by+'P') return true;
  for (const [dr,dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]])
    if(inB(r+dr,c+dc)&&b[r+dr][c+dc]===by+'N') return true;
  const slide=(dr:number,dc:number,types:string[])=>{
    let rr=r+dr,cc=c+dc;
    while(inB(rr,cc)){if(b[rr][cc]){return types.some(t=>b[rr][cc]===by+t);}rr+=dr;cc+=dc;}
    return false;
  };
  if(slide(-1,0,['R','Q'])||slide(1,0,['R','Q'])||slide(0,-1,['R','Q'])||slide(0,1,['R','Q'])) return true;
  if(slide(-1,-1,['B','Q'])||slide(-1,1,['B','Q'])||slide(1,-1,['B','Q'])||slide(1,1,['B','Q'])) return true;
  for (const [dr,dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]])
    if(inB(r+dr,c+dc)&&b[r+dr][c+dc]===by+'K') return true;
  return false;
}
function inCheck(b:Board,col:Color): boolean {
  for(let r=0;r<8;r++) for(let c=0;c<8;c++) if(b[r][c]===col+'K') return attacked(b,r,c,col==='w'?'b':'w');
  return false;
}

// ── Move generation ───────────────────────────────────────────────────────────
function pseudoMoves(b:Board,r:number,c:number,ep:Sq|null): Sq[] {
  const p=b[r][c]; if(!p) return [];
  const col=p[0] as Color, type=p[1], moves:Sq[]=[];
  const empty=(rr:number,cc:number)=>inB(rr,cc)&&!b[rr][cc];
  const enemy=(rr:number,cc:number)=>inB(rr,cc)&&!!b[rr][cc]&&b[rr][cc]![0]!==col;
  const push=(rr:number,cc:number)=>{ if(empty(rr,cc)||enemy(rr,cc)) moves.push([rr,cc]); };
  const slide=(dr:number,dc:number)=>{
    let rr=r+dr,cc=c+dc;
    while(inB(rr,cc)){if(b[rr][cc]){if(b[rr][cc]![0]!==col)moves.push([rr,cc]);break;}moves.push([rr,cc]);rr+=dr;cc+=dc;}
  };
  if(type==='P'){
    const d=col==='w'?-1:1,sr=col==='w'?6:1;
    if(empty(r+d,c)){moves.push([r+d,c]);if(r===sr&&empty(r+2*d,c))moves.push([r+2*d,c]);}
    for(const dc of[-1,1]){
      if(enemy(r+d,c+dc))moves.push([r+d,c+dc]);
      if(ep&&r+d===ep[0]&&c+dc===ep[1])moves.push([r+d,c+dc]);
    }
  } else if(type==='N'){
    for(const [dr,dc] of[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]])push(r+dr,c+dc);
  } else if(type==='B'){slide(-1,-1);slide(-1,1);slide(1,-1);slide(1,1);}
  else if(type==='R'){slide(-1,0);slide(1,0);slide(0,-1);slide(0,1);}
  else if(type==='Q'){slide(-1,-1);slide(-1,1);slide(1,-1);slide(1,1);slide(-1,0);slide(1,0);slide(0,-1);slide(0,1);}
  else if(type==='K'){for(const[dr,dc]of[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]])push(r+dr,c+dc);}
  return moves;
}

function legalMoves(b:Board,r:number,c:number,ep:Sq|null,cr:CR): Sq[] {
  const p=b[r][c]; if(!p) return [];
  const col=p[0] as Color, enemy:Color=col==='w'?'b':'w';
  const legal:Sq[]=[];
  for(const [tr,tc] of pseudoMoves(b,r,c,ep)){
    const nb=clone(b);
    if(p[1]==='P'&&ep&&tr===ep[0]&&tc===ep[1]) nb[col==='w'?tr+1:tr-1][tc]=null;
    nb[tr][tc]=nb[r][c]; nb[r][c]=null;
    if(p[1]==='P'&&(tr===0||tr===7)) nb[tr][tc]=col+'Q';
    if(!inCheck(nb,col)) legal.push([tr,tc]);
  }
  // Castling
  if(p[1]==='K'){
    const br=col==='w'?7:0;
    if(r===br&&c===4){
      const kk=col==='w'?'wK':'bK', qq=col==='w'?'wQ':'bQ';
      if(cr[kk as keyof CR]&&!b[br][5]&&!b[br][6]&&!attacked(b,br,4,enemy)&&!attacked(b,br,5,enemy)&&!attacked(b,br,6,enemy))
        legal.push([br,6]);
      if(cr[qq as keyof CR]&&!b[br][3]&&!b[br][2]&&!b[br][1]&&!attacked(b,br,4,enemy)&&!attacked(b,br,3,enemy)&&!attacked(b,br,2,enemy))
        legal.push([br,2]);
    }
  }
  return legal;
}

function doMove(b:Board,fr:Sq,to:Sq,ep:Sq|null,cr:CR):{b:Board;ep:Sq|null;cr:CR} {
  const nb=clone(b), [fr0,fr1]=fr, [to0,to1]=to;
  const p=nb[fr0][fr1]!, col=p[0] as Color;
  let newEp:Sq|null=null;
  const nc={...cr};
  if(p[1]==='P'&&ep&&to0===ep[0]&&to1===ep[1]) nb[col==='w'?to0+1:to0-1][to1]=null;
  if(p[1]==='P'&&Math.abs(to0-fr0)===2) newEp=[(fr0+to0)/2,fr1];
  if(p[1]==='K'&&Math.abs(to1-fr1)===2){
    if(to1===6){nb[to0][5]=nb[to0][7];nb[to0][7]=null;}
    else{nb[to0][3]=nb[to0][0];nb[to0][0]=null;}
  }
  if(p==='wK'){nc.wK=false;nc.wQ=false;} if(p==='bK'){nc.bK=false;nc.bQ=false;}
  if(fr0===7&&fr1===0||to0===7&&to1===0) nc.wQ=false;
  if(fr0===7&&fr1===7||to0===7&&to1===7) nc.wK=false;
  if(fr0===0&&fr1===0||to0===0&&to1===0) nc.bQ=false;
  if(fr0===0&&fr1===7||to0===0&&to1===7) nc.bK=false;
  nb[to0][to1]=p; nb[fr0][fr1]=null;
  if(p[1]==='P'&&(to0===0||to0===7)) nb[to0][to1]=col+'Q';
  return {b:nb,ep:newEp,cr:nc};
}

function allMoves(b:Board,col:Color,ep:Sq|null,cr:CR):{fr:Sq;to:Sq}[] {
  const out:{fr:Sq;to:Sq}[]=[];
  for(let r=0;r<8;r++) for(let c=0;c<8;c++)
    if(b[r][c]?.[0]===col) for(const to of legalMoves(b,r,c,ep,cr)) out.push({fr:[r,c],to});
  return out;
}

// ── Evaluation + minimax ─────────────────────────────────────────────────────
function evalBoard(b:Board): number {
  let s=0;
  for(let r=0;r<8;r++) for(let c=0;c<8;c++){
    const p=b[r][c]; if(!p) continue;
    const isW=p[0]==='w',t=p[1];
    const base=VAL[t]??0, pst=PST[t]??([]as number[][]);
    const pos=pst[isW?r:7-r]?.[c]??0;
    s+=isW?base+pos:-(base+pos);
  }
  return s;
}

function minimax(b:Board,d:number,a:number,bv:number,max:boolean,ep:Sq|null,cr:CR): number {
  const col:Color=max?'w':'b';
  if(d===0) return evalBoard(b);
  const moves=allMoves(b,col,ep,cr);
  if(moves.length===0) return inCheck(b,col)?(max?-100000+d:100000-d):0;
  if(max){
    let best=-Infinity;
    for(const {fr,to} of moves){
      const {b:nb,ep:ne,cr:nc}=doMove(b,fr,to,ep,cr);
      best=Math.max(best,minimax(nb,d-1,a,bv,false,ne,nc));
      a=Math.max(a,best); if(bv<=a) break;
    }
    return best;
  } else {
    let best=Infinity;
    for(const {fr,to} of moves){
      const {b:nb,ep:ne,cr:nc}=doMove(b,fr,to,ep,cr);
      best=Math.min(best,minimax(nb,d-1,a,bv,true,ne,nc));
      bv=Math.min(bv,best); if(bv<=a) break;
    }
    return best;
  }
}

function bestMove(b:Board,col:Color,ep:Sq|null,cr:CR,depth:number):{fr:Sq;to:Sq}|null {
  const moves=allMoves(b,col,ep,cr); if(!moves.length) return null;
  moves.sort(()=>Math.random()-.5);
  const max=col==='w'; let bestVal=max?-Infinity:Infinity, bm=moves[0];
  for(const m of moves){
    const {b:nb,ep:ne,cr:nc}=doMove(b,m.fr,m.to,ep,cr);
    const v=minimax(nb,depth-1,-Infinity,Infinity,!max,ne,nc);
    if(max?v>bestVal:v<bestVal){bestVal=v;bm=m;}
  }
  return bm;
}

// ── Component ────────────────────────────────────────────────────────────────
@Component({
  selector: 'app-chess-game',
  standalone: true,
  imports: [],
  templateUrl: './chess-game.component.html',
  styleUrl:    './chess-game.component.css'
})
export class ChessGameComponent {
  board       = signal<Board>(initBoard());
  selected    = signal<Sq|null>(null);
  validMoves  = signal<Sq[]>([]);
  turn        = signal<Color>('w');
  status      = signal<'playing'|'check'|'checkmate'|'stalemate'>('playing');
  vsAI        = signal(false);
  lastMove    = signal<{fr:Sq;to:Sq}|null>(null);
  captured    = signal<{w:string[];b:string[]}>({w:[],b:[]});
  thinking    = signal(false);

  private ep: Sq|null = null;
  private cr: CR = {wK:true,wQ:true,bK:true,bQ:true};

  readonly rows = [0,1,2,3,4,5,6,7];
  readonly cols = [0,1,2,3,4,5,6,7];
  readonly files = 'abcdefgh';

  sym(r:number,c:number): string { const p=this.board()[r][c]; return p?SYM[p]??'':''; }
  isLight(r:number,c:number){ return (r+c)%2===0; }
  isSel(r:number,c:number){ const s=this.selected(); return !!s&&s[0]===r&&s[1]===c; }
  isVM(r:number,c:number){ return this.validMoves().some(([vr,vc])=>vr===r&&vc===c); }
  isLM(r:number,c:number){ const m=this.lastMove(); return !!m&&((m.fr[0]===r&&m.fr[1]===c)||(m.to[0]===r&&m.to[1]===c)); }
  isKC(r:number,c:number){ const p=this.board()[r][c]; return !!p&&p[1]==='K'&&p[0]===this.turn()&&this.status()==='check'; }
  isCap(r:number,c:number){ return this.isVM(r,c)&&!!this.board()[r][c]; }
  pieceColor(r:number,c:number): string { return this.board()[r][c]?.[0]??''; }

  get statusMsg(): string {
    const t=this.turn()==='w'?'White':'Black';
    if(this.status()==='checkmate') return `Checkmate! ${t==='White'?'Black':'White'} wins! 🏆`;
    if(this.status()==='stalemate') return 'Stalemate — Draw!';
    if(this.status()==='check') return `${t} is in check!`;
    return this.thinking()?'AI thinking…':`${t}'s turn`;
  }
  get capByWhite(): string { return this.captured().b.map(p=>SYM[p]??'').join(' '); }
  get capByBlack(): string { return this.captured().w.map(p=>SYM[p]??'').join(' '); }

  newGame() {
    this.board.set(initBoard()); this.selected.set(null); this.validMoves.set([]);
    this.turn.set('w'); this.status.set('playing'); this.lastMove.set(null);
    this.captured.set({w:[],b:[]}); this.thinking.set(false);
    this.ep=null; this.cr={wK:true,wQ:true,bK:true,bQ:true};
  }

  toggleAI() { this.vsAI.update(v=>!v); this.newGame(); }

  click(r:number,c:number) {
    if(this.status()==='checkmate'||this.status()==='stalemate') return;
    if(this.thinking()) return;
    if(this.vsAI()&&this.turn()==='b') return;
    const sel=this.selected(), b=this.board();
    if(sel){
      if(this.isVM(r,c)){ this.exec(sel,[r,c]); return; }
      const p=b[r][c];
      if(p&&p[0]===this.turn()){ this.selected.set([r,c]); this.validMoves.set(legalMoves(b,r,c,this.ep,this.cr)); }
      else { this.selected.set(null); this.validMoves.set([]); }
    } else {
      const p=b[r][c];
      if(p&&p[0]===this.turn()){ this.selected.set([r,c]); this.validMoves.set(legalMoves(b,r,c,this.ep,this.cr)); }
    }
  }

  private exec(fr:Sq,to:Sq) {
    const b=this.board();
    const capturedPiece=b[to[0]][to[1]];
    const p=b[fr[0]][fr[1]]!;
    let epCap:Piece=null;
    if(p[1]==='P'&&this.ep&&to[0]===this.ep[0]&&to[1]===this.ep[1])
      epCap=b[p[0]==='w'?to[0]+1:to[0]-1][to[1]];

    const {b:nb,ep:ne,cr:nc}=doMove(b,fr,to,this.ep,this.cr);
    this.ep=ne; this.cr=nc;

    const cap=capturedPiece||epCap;
    if(cap){ const cc=cap[0] as 'w'|'b', cur=this.captured();
      this.captured.set(cc==='w'?{w:[...cur.w,cap],b:cur.b}:{w:cur.w,b:[...cur.b,cap]}); }

    this.board.set(nb); this.lastMove.set({fr,to});
    this.selected.set(null); this.validMoves.set([]);

    const nt:Color=this.turn()==='w'?'b':'w';
    this.turn.set(nt);
    const chk=inCheck(nb,nt), ms=allMoves(nb,nt,ne,nc);
    this.status.set(ms.length===0?(chk?'checkmate':'stalemate'):chk?'check':'playing');

    if(this.vsAI()&&nt==='b'&&this.status()==='playing'||this.status()==='check'){
      this.thinking.set(true);
      setTimeout(()=>this.aiMove(),250);
    }
  }

  private aiMove() {
    const m=bestMove(this.board(),'b',this.ep,this.cr,3);
    this.thinking.set(false);
    if(m) this.exec(m.fr,m.to);
  }
}
