import {
  Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, HostListener
} from '@angular/core';

// ── Constants ─────────────────────────────────────────────────────────────────
const CW = 800, CH = 450;
const TILE = 32;
const GRAV = 0.55;
const JUMP_V = -13;
const MOVE_SPD = 3.8;
const WORLD_TILES = 200;
const WORLD_W = WORLD_TILES * TILE;

// ── Palette (NES-ish) ─────────────────────────────────────────────────────────
const C = {
  sky:    '#5C94FC', cloud: '#fff', cloudSh: '#e0e0e0',
  hill:   '#00A800', hillL: '#00D800', hillO: '#6B8CFF',
  ground: '#C84B0C', groundT: '#56A000', groundD: '#8B2500',
  brick:  '#C84B0C', brickL: '#E86030', brickD: '#8B2500',
  qBlock: '#FFA800', qBlockL: '#FFD070', qBlockD: '#A06000', qBlockQ: '#C07000',
  pipe:   '#00A800', pipeL: '#00D800', pipeD: '#005800',
  mario:  '#E40058', marioS: '#FFAD00', marioO: '#6B2200',
  goomba: '#A05000', goombaD: '#6B2200', goombaF: '#FFAD00',
  coin:   '#FFD700', coinSh: '#FFA800',
  flag:   '#00A800', flagP:  '#C0C0C0',
  hud:    '#000',
  star:   '#FFD700',
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface Rect { x:number; y:number; w:number; h:number; }
interface Entity extends Rect { vx:number; vy:number; onGround:boolean; }

interface Mario extends Entity {
  facing: 1|-1; state:'idle'|'run'|'jump'|'dead';
  animT:number; lives:number; big:boolean; invincible:number;
}
interface Goomba extends Rect {
  vx:number; vy:number; alive:boolean; squished:boolean; squishT:number; animT:number;
}
interface Coin extends Rect { taken:boolean; animT:number; }
interface Block extends Rect {
  type:'ground'|'brick'|'qblock'|'pipe'|'pipe-top';
  hit:boolean; hitT:number; used:boolean; hasCoin:boolean;
}
interface Particle {
  x:number; y:number; vx:number; vy:number;
  alpha:number; color:string; size:number; rot:number; rotV:number;
}
interface FloatingText { x:number; y:number; text:string; alpha:number; vy:number; }

// ── Level builder ─────────────────────────────────────────────────────────────
function buildLevel(): { blocks:Block[]; goombas:Goomba[]; coins:Coin[]; flagX:number } {
  const blocks: Block[] = [];
  const goombas: Goomba[] = [];
  const coins: Coin[] = [];

  const T = TILE;
  const GY = 13; // ground tile row (0-indexed from top, so y = GY*T)

  // ── Ground ────────────────────────────────────────────────────────────────
  for (let tx = 0; tx < WORLD_TILES; tx++) {
    // gap at 55-57
    if (tx >= 55 && tx <= 57) continue;
    // gap at 80-82
    if (tx >= 80 && tx <= 82) continue;
    blocks.push({ x:tx*T, y:GY*T, w:T, h:T*2, type:'ground', hit:false,hitT:0,used:false,hasCoin:false });
  }

  const addGround = (tx:number) => blocks.push({ x:tx*T, y:GY*T, w:T, h:T*2, type:'ground', hit:false,hitT:0,used:false,hasCoin:false });
  const brick = (tx:number, ty:number, hasCoin=false) =>
    blocks.push({ x:tx*T, y:ty*T, w:T, h:T, type:'brick', hit:false,hitT:0,used:false,hasCoin });
  const qblock = (tx:number, ty:number) =>
    blocks.push({ x:tx*T, y:ty*T, w:T, h:T, type:'qblock', hit:false,hitT:0,used:false,hasCoin:true });
  const pipe = (tx:number, height:number) => {
    for (let i = 1; i < height; i++)
      blocks.push({ x:tx*T, y:(GY-i)*T, w:T*2, h:T, type:'pipe', hit:false,hitT:0,used:false,hasCoin:false });
    blocks.push({ x:(tx-0)*T-4, y:(GY-height)*T, w:T*2+8, h:T, type:'pipe-top', hit:false,hitT:0,used:false,hasCoin:false });
  };

  const goomba = (tx:number) => goombas.push({ x:tx*T, y:(GY-1)*T, w:T, h:T, vx:-1.2, vy:0, alive:true, squished:false, squishT:0, animT:0 });
  const coin = (tx:number, ty:number) => coins.push({ x:tx*T+6, y:ty*T, w:T-12, h:T, taken:false, animT:0 });

  // ── Zone 1: Classic opener ────────────────────────────────────────────────
  qblock(5, 9); qblock(11, 9); brick(12, 9, true); qblock(13, 9); brick(14, 9); qblock(15, 9);
  brick(12, 6); brick(13, 6); brick(14, 6);
  pipe(17, 2); pipe(21, 3); pipe(28, 4);
  goomba(9); goomba(18); goomba(24); goomba(26);
  coin(6, 8); coin(7, 8); coin(8, 8);

  // ── Zone 2: Mid section ───────────────────────────────────────────────────
  brick(35, 9); qblock(36, 9, ); brick(37, 9); brick(38, 9, true);
  brick(35, 6); brick(36, 6); brick(37, 6); brick(38, 6);
  pipe(40, 3); pipe(45, 4); pipe(50, 2);
  goomba(33); goomba(38); goomba(43); goomba(48);
  coin(36, 8); coin(37, 8);

  // ── Gap zone: rows of bricks for bridging ─────────────────────────────────
  for (let i = 59; i <= 65; i++) { addGround(i); }
  brick(60, 10); brick(61, 10); qblock(62, 10); brick(63, 10);
  goomba(61); goomba(64);
  coin(62, 9);

  // ── Zone 3: Staircase + underground-feel ─────────────────────────────────
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j <= i; j++)
      blocks.push({ x:(68+i)*T, y:(GY-j)*T, w:T, h:T, type:'brick', hit:false,hitT:0,used:false,hasCoin:false });
  }
  for (let i = 84; i < 89; i++) addGround(i);
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5-i; j++)
      blocks.push({ x:(84+i)*T, y:(GY-j)*T, w:T, h:T, type:'brick', hit:false,hitT:0,used:false,hasCoin:false });
  }
  goomba(75); goomba(77); goomba(85); goomba(88);

  // ── Zone 4: Late section ──────────────────────────────────────────────────
  qblock(92, 9); qblock(95, 9); brick(96, 9, true); qblock(98, 9);
  pipe(100, 2); pipe(104, 3);
  goomba(93); goomba(101); goomba(105); goomba(108); goomba(110);
  coin(93, 8); coin(95, 8); coin(97, 8);

  // ── Approach to flag ──────────────────────────────────────────────────────
  for (let i = 0; i < 9; i++)
    for (let j = 0; j <= i; j++)
      blocks.push({ x:(115+i)*T, y:(GY-j)*T, w:T, h:T, type:'brick', hit:false,hitT:0,used:false,hasCoin:false });

  const flagX = 126 * T;
  return { blocks, goombas, coins, flagX };
}

// ── Component ─────────────────────────────────────────────────────────────────
@Component({
  selector: 'app-mario-game',
  standalone: true,
  imports: [],
  templateUrl: './mario-game.component.html',
  styleUrl: './mario-game.component.css'
})
export class MarioGameComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  state: 'start'|'playing'|'dead'|'win' = 'start';
  score  = 0;
  best   = 0;
  coinCount = 0;

  private ctx!: CanvasRenderingContext2D;
  private raf = 0;
  private keys = new Set<string>();
  private lastTs = 0;

  private mario!: Mario;
  private blocks!: Block[];
  private goombas!: Goomba[];
  private coins!: Coin[];
  private particles!: Particle[];
  private floatTexts!: FloatingText[];
  private camX = 0;
  private flagX = 0;
  private flagT = 0;        // winning animation timer
  private frameCount = 0;
  private deathTimer = 0;

  @HostListener('window:keydown', ['$event'])
  onKD(e: KeyboardEvent) {
    this.keys.add(e.code);
    if (['Space','ArrowUp','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
    if (this.state === 'start' || this.state === 'dead' || this.state === 'win') {
      if (['Space','ArrowUp','Enter'].includes(e.code)) this.startGame();
    }
  }
  @HostListener('window:keyup', ['$event'])
  onKU(e: KeyboardEvent) { this.keys.delete(e.code); }

  ngAfterViewInit() {
    const canvas = this.canvasRef.nativeElement;
    canvas.width = CW; canvas.height = CH;
    this.ctx = canvas.getContext('2d')!;
    this.raf = requestAnimationFrame(t => this.loop(t));
  }
  ngOnDestroy() { cancelAnimationFrame(this.raf); }

  startGame() {
    const { blocks, goombas, coins, flagX } = buildLevel();
    this.blocks    = blocks;
    this.goombas   = goombas;
    this.coins     = coins;
    this.flagX     = flagX;
    this.particles = [];
    this.floatTexts = [];
    this.camX      = 0;
    this.flagT     = 0;
    this.frameCount = 0;
    this.deathTimer = 0;
    this.score     = 0;
    this.coinCount = 0;

    const startY = 13 * TILE - 2 * TILE;
    this.mario = {
      x: 2*TILE, y: startY, w: 26, h: 32,
      vx: 0, vy: 0, onGround: false,
      facing: 1, state: 'idle', animT: 0,
      lives: 3, big: false, invincible: 0
    };
    this.state = 'playing';
  }

  private loop(ts: number) {
    this.raf = requestAnimationFrame(t => this.loop(t));
    const dt = Math.min((ts - this.lastTs) / 16.67, 3);
    this.lastTs = ts;
    this.frameCount++;

    if (this.state === 'playing') this.update(dt);
    this.draw();
  }

  // ── Update ────────────────────────────────────────────────────────────────
  private update(dt: number) {
    const m = this.mario;
    if (m.invincible > 0) m.invincible -= dt;

    // ── Input ─────────────────────────────────────────────────────────────
    if (m.state !== 'dead') {
      const left  = this.keys.has('ArrowLeft')  || this.keys.has('KeyA');
      const right = this.keys.has('ArrowRight') || this.keys.has('KeyD');
      const jump  = this.keys.has('ArrowUp')    || this.keys.has('KeyW') || this.keys.has('Space');
      const run   = this.keys.has('ShiftLeft')  || this.keys.has('ShiftRight');

      const spd = MOVE_SPD * (run ? 1.6 : 1);
      if (right) { m.vx = Math.min(m.vx + 0.6, spd); m.facing = 1; }
      else if (left) { m.vx = Math.max(m.vx - 0.6, -spd); m.facing = -1; }
      else { m.vx *= 0.78; if (Math.abs(m.vx) < 0.1) m.vx = 0; }

      if (jump && m.onGround) { m.vy = JUMP_V * (run ? 1.1 : 1); m.onGround = false; }

      m.state = !m.onGround ? 'jump' : m.vx !== 0 ? 'run' : 'idle';
    }

    // ── Physics ───────────────────────────────────────────────────────────
    m.vy = Math.min(m.vy + GRAV * dt, 14);
    m.x += m.vx * dt;
    m.y += m.vy * dt;

    // left boundary
    if (m.x < 0) { m.x = 0; m.vx = 0; }
    // right boundary (world end)
    if (m.x + m.w > WORLD_W) { m.x = WORLD_W - m.w; m.vx = 0; }

    // ── Block collisions ──────────────────────────────────────────────────
    m.onGround = false;
    for (const b of this.blocks) {
      if (b.type === 'pipe' && b.y > (13 * TILE - TILE)) continue; // skip sub-ground pipe bodies
      if (!overlap(m, b)) continue;
      const res = resolveRect(m, b);
      if (res === 'bottom') {
        m.vy = 0; m.onGround = true;
      } else if (res === 'top') {
        if (m.vy < 0) {
          m.vy = 2;
          this.hitBlock(b);
        }
      } else {
        m.vx = 0;
      }
    }

    // ── Fall into pit ─────────────────────────────────────────────────────
    if (m.y > CH + 80 && m.state !== 'dead') this.killMario();

    // ── Goombas ───────────────────────────────────────────────────────────
    for (const g of this.goombas) {
      if (!g.alive) { g.squishT -= dt; continue; }
      g.animT += dt;
      g.x += g.vx * dt;
      g.vy = Math.min(g.vy + GRAV * dt, 14);
      g.y += g.vy * dt;
      // block collisions for goomba
      for (const b of this.blocks) {
        if (!overlap(g, b)) continue;
        const res = resolveRect(g, b);
        if (res === 'bottom') { g.vy = 0; }
        else if (res === 'left' || res === 'right') { g.vx *= -1; }
      }
      // world bounds
      if (g.x < 0 || g.x + g.w > WORLD_W) g.vx *= -1;

      // mario vs goomba
      if (m.invincible <= 0 && m.state !== 'dead' && overlap(m, g)) {
        const mBot = m.y + m.h, gTop = g.y;
        if (m.vy > 0 && mBot < gTop + 12) {
          // stomp
          g.alive = false; g.squished = true; g.squishT = 30;
          m.vy = JUMP_V * 0.5;
          this.addScore(100, g.x + g.w/2, g.y);
        } else {
          this.killMario();
        }
      }
    }

    // ── Coins (floating, not block) ───────────────────────────────────────
    for (const c of this.coins) {
      if (c.taken) { c.animT -= dt; continue; }
      if (overlap(m, c)) {
        c.taken = true; c.animT = 20;
        this.coinCount++;
        this.addScore(200, c.x + c.w/2, c.y);
      }
    }

    // ── Flag ──────────────────────────────────────────────────────────────
    if (m.state !== 'dead' && m.x + m.w > this.flagX && m.x < this.flagX + 10) {
      this.state = 'win';
      this.flagT = 0;
      this.addScore(1000, this.flagX, 5 * TILE);
      if (this.score > this.best) this.best = this.score;
    }

    // ── Camera ────────────────────────────────────────────────────────────
    const targetCam = m.x - CW * 0.35;
    this.camX = Math.max(0, Math.min(targetCam, WORLD_W - CW));

    // ── Particles & float texts ───────────────────────────────────────────
    for (const p of this.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += 0.3 * dt;
      p.alpha -= 0.02 * dt;
      p.rot += p.rotV * dt;
    }
    this.particles = this.particles.filter(p => p.alpha > 0);

    for (const f of this.floatTexts) {
      f.y += f.vy * dt; f.alpha -= 0.025 * dt;
    }
    this.floatTexts = this.floatTexts.filter(f => f.alpha > 0);

    // ── Death sequence ────────────────────────────────────────────────────
    if (m.state === 'dead') {
      this.deathTimer += dt;
      if (this.deathTimer > 90) {
        m.lives--;
        if (m.lives <= 0) { this.state = 'dead'; }
        else { this.startGame(); }
      }
    }

    // ── Block hit animations ──────────────────────────────────────────────
    for (const b of this.blocks) { if (b.hitT > 0) b.hitT -= dt; }

    // ── Anim timers ───────────────────────────────────────────────────────
    m.animT += dt;
  }

  private hitBlock(b: Block) {
    if (b.type === 'brick') {
      if (b.used) return;
      if (b.hasCoin) {
        b.used = true;
        this.coinCount++; this.addScore(200, b.x + b.w/2, b.y);
        this.spawnCoinBurst(b.x + b.w/2, b.y);
      } else {
        // smash brick
        this.spawnBrickParticles(b.x + b.w/2, b.y + b.h/2);
        b.used = true; b.hitT = 0;
        // mark removed
        (b as any)._removed = true;
        this.addScore(50, b.x + b.w/2, b.y);
      }
      b.hitT = 8;
    } else if (b.type === 'qblock' && !b.used) {
      b.used = true; b.hit = true; b.hitT = 8;
      this.coinCount++; this.addScore(200, b.x + b.w/2, b.y);
      this.spawnCoinBurst(b.x + b.w/2, b.y);
    }
    this.blocks = this.blocks.filter(bl => !(bl as any)._removed);
  }

  private killMario() {
    const m = this.mario;
    if (m.state === 'dead') return;
    m.state = 'dead';
    m.vy = JUMP_V * 0.9;
    m.vx = 0;
    this.deathTimer = 0;
  }

  private addScore(pts: number, x: number, y: number) {
    this.score += pts;
    this.floatTexts.push({ x, y, text: '+' + pts, alpha: 1, vy: -1.2 });
  }

  private spawnCoinBurst(x: number, y: number) {
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI/2 + (i - 2.5) * 0.3;
      this.particles.push({ x, y, vx: Math.cos(a)*3, vy: Math.sin(a)*5 - 2,
        alpha: 1, color: C.coin, size: 5, rot: 0, rotV: 0.1 });
    }
  }

  private spawnBrickParticles(x: number, y: number) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.particles.push({ x, y, vx: Math.cos(a)*4, vy: Math.sin(a)*4 - 3,
        alpha: 1, color: C.brick, size: 6, rot: 0, rotV: 0.2 });
    }
  }

  // ── Draw ──────────────────────────────────────────────────────────────────
  private draw() {
    const ctx = this.ctx, cx = this.camX;
    ctx.clearRect(0, 0, CW, CH);

    if (this.state === 'start') { this.drawStart(); return; }

    // Sky
    ctx.fillStyle = C.sky;
    ctx.fillRect(0, 0, CW, CH);

    this.drawBg(cx);
    this.drawBlocks(ctx, cx);
    this.drawFlag(ctx, cx);
    this.drawCoins(ctx, cx);
    this.drawGoombas(ctx, cx);
    this.drawMario(ctx, cx);
    this.drawParticles(ctx, cx);
    this.drawFloatTexts(ctx, cx);
    this.drawHUD(ctx);

    if (this.state === 'dead')  this.drawOverlay('GAME OVER', `Best: ${this.best}`, '#c00');
    if (this.state === 'win')   this.drawOverlay('YOU WIN! 🎉', `Score: ${this.score}`, '#005800');
  }

  private drawBg(cx: number) {
    const ctx = this.ctx;
    // Hills (parallax 0.3)
    const px = cx * 0.3;
    ctx.fillStyle = C.hillO;
    const hills = [[100,380,80],[300,390,60],[600,385,70],[900,380,90],[1200,390,65],[1400,382,75]];
    for (const [hx, hy, hr] of hills) {
      const sx = hx - px;
      ctx.beginPath();
      ctx.ellipse(sx % CW, hy, hr, hr * 0.7, 0, Math.PI, 0);
      ctx.fill();
    }
    ctx.fillStyle = C.hill;
    const hills2 = [[200,385,50],[500,388,45],[800,383,55],[1100,386,60],[1300,389,40]];
    for (const [hx, hy, hr] of hills2) {
      const sx = hx - px * 0.7;
      ctx.beginPath();
      ctx.ellipse(sx % CW, hy, hr, hr * 0.65, 0, Math.PI, 0);
      ctx.fill();
    }
    // Clouds (parallax 0.15)
    ctx.fillStyle = C.cloud;
    const clouds = [[60,60,40],[250,80,30],[500,55,50],[750,75,35],[1000,60,45],[1250,80,30],[1500,65,40]];
    for (const [hx, hy, hr] of clouds) {
      const sx = ((hx - cx * 0.15) % (CW + 200) + CW + 200) % (CW + 200) - 100;
      drawCloud(ctx, sx, hy, hr);
    }
  }

  private drawBlocks(ctx: CanvasRenderingContext2D, cx: number) {
    for (const b of this.blocks) {
      const bx = b.x - cx;
      if (bx + b.w < -10 || bx > CW + 10) continue;
      const dy = b.hitT > 0 ? -Math.sin((b.hitT / 8) * Math.PI) * 5 : 0;

      if (b.type === 'ground') {
        drawGroundTile(ctx, bx, b.y + dy, b.w, b.h);
      } else if (b.type === 'brick') {
        if (!b.used) drawBrick(ctx, bx, b.y + dy);
      } else if (b.type === 'qblock') {
        drawQBlock(ctx, bx, b.y + dy, b.used);
      } else if (b.type === 'pipe') {
        drawPipeBody(ctx, bx, b.y + dy, b.w, b.h);
      } else if (b.type === 'pipe-top') {
        drawPipeTop(ctx, bx, b.y + dy, b.w);
      }
    }
  }

  private drawFlag(ctx: CanvasRenderingContext2D, cx: number) {
    const fx = this.flagX - cx;
    // pole
    ctx.fillStyle = C.flagP;
    ctx.fillRect(fx, 2 * TILE, 4, 11 * TILE);
    // ball on top
    ctx.fillStyle = C.flagP;
    ctx.beginPath(); ctx.arc(fx + 2, 2 * TILE, 7, 0, Math.PI * 2); ctx.fill();
    // flag
    ctx.fillStyle = C.flag;
    ctx.fillRect(fx + 4, 2 * TILE, 28, 20);
  }

  private drawCoins(ctx: CanvasRenderingContext2D, cx: number) {
    const t = this.frameCount;
    for (const c of this.coins) {
      if (c.taken) continue;
      const cx2 = c.x - cx;
      if (cx2 + c.w < -10 || cx2 > CW + 10) continue;
      drawCoin(ctx, cx2 + c.w/2, c.y + c.h/2, TILE * 0.45, t);
    }
  }

  private drawGoombas(ctx: CanvasRenderingContext2D, cx: number) {
    for (const g of this.goombas) {
      const gx = g.x - cx;
      if (gx + g.w < -10 || gx > CW + 10) continue;
      if (g.squished) {
        if (g.squishT > 0) drawGoombaSquished(ctx, gx, g.y);
        continue;
      }
      if (!g.alive) continue;
      drawGoomba(ctx, gx, g.y, g.animT);
    }
  }

  private drawMario(ctx: CanvasRenderingContext2D, cx: number) {
    const m = this.mario;
    if (m.state === 'dead' && m.y > CH + 20) return;
    if (m.invincible > 0 && Math.floor(m.invincible * 6) % 2 === 0) return;
    const mx = m.x - cx;
    drawMario(ctx, mx, m.y, m.facing, m.state, m.animT, m.big);
  }

  private drawParticles(ctx: CanvasRenderingContext2D, cx: number) {
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.translate(p.x - cx, p.y);
      ctx.rotate(p.rot);
      ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size);
      ctx.restore();
    }
  }

  private drawFloatTexts(ctx: CanvasRenderingContext2D, cx: number) {
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    for (const f of this.floatTexts) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, f.alpha);
      ctx.fillStyle = C.coin;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
      ctx.strokeText(f.text, f.x - cx, f.y);
      ctx.fillText(f.text, f.x - cx, f.y);
      ctx.restore();
    }
    ctx.textAlign = 'left';
  }

  private drawHUD(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, CW, 36);

    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = '#fff';
    // Score
    ctx.fillText('MARIO', 16, 14);
    ctx.fillText(String(this.score).padStart(6, '0'), 16, 30);
    // Coins
    drawCoin(ctx, 160, 14, 7, this.frameCount);
    ctx.fillText(`×${String(this.coinCount).padStart(2, '0')}`, 172, 19);
    // World
    ctx.fillText('WORLD', 310, 14);
    ctx.fillText('  1-1', 310, 30);
    // Lives
    ctx.fillText('♥ ×' + this.mario.lives, 480, 22);
    // Best
    ctx.fillText(`BEST: ${this.best}`, 630, 22);
  }

  private drawStart() {
    const ctx = this.ctx;
    ctx.fillStyle = C.sky; ctx.fillRect(0, 0, CW, CH);
    drawCloud(ctx, 120, 70, 45);
    drawCloud(ctx, 400, 90, 35);
    drawCloud(ctx, 650, 65, 50);

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(ctx, CW/2 - 200, CH/2 - 120, 400, 240, 16);
    ctx.fill();
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SUPER MARIO', CW/2, CH/2 - 70);
    ctx.font = '18px monospace';
    ctx.fillStyle = '#fff';
    ctx.fillText('Arrow Keys / WASD — Move', CW/2, CH/2 - 22);
    ctx.fillText('Space / ↑ / W — Jump', CW/2, CH/2 + 8);
    ctx.fillText('Hold Shift — Run', CW/2, CH/2 + 36);
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 20px monospace';
    const blink = Math.floor(Date.now() / 500) % 2 === 0;
    if (blink) ctx.fillText('Press SPACE to Start!', CW/2, CH/2 + 90);
    ctx.textAlign = 'left';
  }

  private drawOverlay(title: string, sub: string, bg: string) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = bg;
    roundRect(ctx, CW/2 - 180, CH/2 - 80, 360, 160, 14);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 34px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(title, CW/2, CH/2 - 20);
    ctx.font = '18px monospace';
    ctx.fillText(sub, CW/2, CH/2 + 20);
    const blink = Math.floor(Date.now() / 500) % 2 === 0;
    if (blink) { ctx.font = '15px monospace'; ctx.fillText('Press SPACE to play again', CW/2, CH/2 + 55); }
    ctx.textAlign = 'left';
  }

  // ── Touch controls ────────────────────────────────────────────────────────
  onTouchLeft(down: boolean)  { down ? this.keys.add('ArrowLeft')  : this.keys.delete('ArrowLeft'); }
  onTouchRight(down: boolean) { down ? this.keys.add('ArrowRight') : this.keys.delete('ArrowRight'); }
  onTouchJump(down: boolean)  { down ? this.keys.add('Space')      : this.keys.delete('Space'); }
  onTouchStart() { if (this.state !== 'playing') this.startGame(); }
}

// ── Collision helpers ─────────────────────────────────────────────────────────
function overlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}
function resolveRect(a: {x:number;y:number;w:number;h:number;vx:number;vy:number}, b: Rect): 'top'|'bottom'|'left'|'right' {
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (overlapX < overlapY) {
    if (a.x < b.x) { a.x -= overlapX; return 'right'; }
    else            { a.x += overlapX; return 'left'; }
  } else {
    if (a.y < b.y) { a.y -= overlapY; return 'bottom'; }
    else            { a.y += overlapY; return 'top'; }
  }
}

// ── Drawing helpers ───────────────────────────────────────────────────────────
function roundRect(ctx: CanvasRenderingContext2D, x:number,y:number,w:number,h:number,r:number) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.arcTo(x+w,y,x+w,y+r,r);
  ctx.lineTo(x+w,y+h-r); ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
  ctx.lineTo(x+r,y+h); ctx.arcTo(x,y+h,x,y+h-r,r);
  ctx.lineTo(x,y+r); ctx.arcTo(x,y,x+r,y,r);
  ctx.closePath();
}

function drawCloud(ctx: CanvasRenderingContext2D, x:number, y:number, r:number) {
  ctx.fillStyle = C.cloud;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(x+r*0.9, y+r*0.2, r*0.7, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(x-r*0.9, y+r*0.2, r*0.7, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(x, y+r*0.35, r*0.9, 0, Math.PI*2); ctx.fill();
}

function drawGroundTile(ctx: CanvasRenderingContext2D, x:number, y:number, w:number, h:number) {
  ctx.fillStyle = C.groundT;
  ctx.fillRect(x, y, w, TILE);
  ctx.fillStyle = C.ground;
  ctx.fillRect(x, y + TILE, w, h - TILE);
  // top highlight
  ctx.fillStyle = C.hillL;
  ctx.fillRect(x, y, w, 4);
  // grid lines
  ctx.fillStyle = C.groundD;
  for (let i = 0; i < Math.ceil(w / TILE); i++) {
    ctx.fillRect(x + i*TILE, y + TILE, 2, h - TILE);
  }
  ctx.fillRect(x, y + TILE * 1.5, w, 2);
}

function drawBrick(ctx: CanvasRenderingContext2D, x:number, y:number) {
  ctx.fillStyle = C.brick;
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = C.brickL;
  ctx.fillRect(x+1, y+1, TILE-2, 4);
  ctx.fillRect(x+1, y+1, 4, TILE-2);
  ctx.fillStyle = C.brickD;
  ctx.fillRect(x, y + TILE - 3, TILE, 3);
  ctx.fillRect(x + TILE - 3, y, 3, TILE);
  // mortar lines
  ctx.fillStyle = C.brickD;
  ctx.fillRect(x, y + TILE/2 - 1, TILE, 2);
  ctx.fillRect(x + TILE/2 - 1, y, 2, TILE/2 - 1);
}

function drawQBlock(ctx: CanvasRenderingContext2D, x:number, y:number, used:boolean) {
  ctx.fillStyle = used ? '#888' : C.qBlock;
  ctx.fillRect(x, y, TILE, TILE);
  if (!used) {
    ctx.fillStyle = C.qBlockL;
    ctx.fillRect(x+1, y+1, TILE-2, 5);
    ctx.fillRect(x+1, y+1, 5, TILE-2);
    ctx.fillStyle = C.qBlockD;
    ctx.fillRect(x, y+TILE-3, TILE, 3);
    ctx.fillRect(x+TILE-3, y, 3, TILE);
    // ?
    ctx.fillStyle = C.qBlockQ;
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('?', x + TILE/2, y + TILE - 7);
    ctx.textAlign = 'left';
  } else {
    ctx.fillStyle = '#555';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('?', x + TILE/2, y + TILE - 7);
    ctx.textAlign = 'left';
  }
}

function drawPipeBody(ctx: CanvasRenderingContext2D, x:number, y:number, w:number, h:number) {
  ctx.fillStyle = C.pipe;
  ctx.fillRect(x+2, y, w-4, h);
  ctx.fillStyle = C.pipeL;
  ctx.fillRect(x+4, y, 8, h);
  ctx.fillStyle = C.pipeD;
  ctx.fillRect(x+w-6, y, 4, h);
}

function drawPipeTop(ctx: CanvasRenderingContext2D, x:number, y:number, w:number) {
  ctx.fillStyle = C.pipe;
  ctx.fillRect(x, y, w, TILE);
  ctx.fillStyle = C.pipeL;
  ctx.fillRect(x+2, y+2, 10, TILE-4);
  ctx.fillStyle = C.pipeD;
  ctx.fillRect(x+w-8, y, 6, TILE);
}

function drawCoin(ctx: CanvasRenderingContext2D, x:number, y:number, r:number, t:number) {
  const scaleX = Math.abs(Math.cos(t * 0.08));
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scaleX, 1);
  ctx.fillStyle = C.coin;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = C.coinSh;
  ctx.beginPath(); ctx.arc(-r*0.2, -r*0.1, r*0.5, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}

function drawGoomba(ctx: CanvasRenderingContext2D, x:number, y:number, t:number) {
  const legOff = Math.sin(t * 0.2) * 4;
  // body
  ctx.fillStyle = C.goomba;
  ctx.fillRect(x+4, y+8, TILE-8, TILE-10);
  // head (round)
  ctx.beginPath(); ctx.arc(x+TILE/2, y+10, 13, 0, Math.PI*2); ctx.fill();
  // feet
  ctx.fillStyle = C.goombaD;
  ctx.fillRect(x+3, y+TILE-10+legOff, 10, 8);
  ctx.fillRect(x+TILE-13, y+TILE-10-legOff, 10, 8);
  // eyes (angry)
  ctx.fillStyle = '#fff';
  ctx.fillRect(x+7, y+4, 7, 6);
  ctx.fillRect(x+TILE-14, y+4, 7, 6);
  ctx.fillStyle = '#000';
  ctx.fillRect(x+11, y+6, 3, 3);
  ctx.fillRect(x+TILE-11, y+6, 3, 3);
  // brow
  ctx.fillStyle = C.goombaD;
  ctx.fillRect(x+6, y+3, 9, 3);
  ctx.fillRect(x+TILE-15, y+3, 9, 3);
}

function drawGoombaSquished(ctx: CanvasRenderingContext2D, x:number, y:number) {
  ctx.fillStyle = C.goomba;
  ctx.fillRect(x+2, y + TILE - 10, TILE - 4, 10);
  ctx.fillStyle = '#fff';
  ctx.fillRect(x+6, y + TILE - 9, 6, 5);
  ctx.fillRect(x+TILE-12, y + TILE - 9, 6, 5);
}

function drawMario(ctx: CanvasRenderingContext2D, x:number, y:number, facing:number, state:string, t:number, big:boolean) {
  ctx.save();
  ctx.translate(x + 13, y + 16);
  if (facing === -1) ctx.scale(-1, 1);

  const run = state === 'run';
  const jump = state === 'jump';
  const legSwing = run ? Math.sin(t * 0.35) * 6 : 0;

  // Hat
  ctx.fillStyle = C.mario;
  ctx.fillRect(-10, -16, 20, 6);
  ctx.fillRect(-8, -22, 14, 7);
  // Face
  ctx.fillStyle = C.marioS;
  ctx.fillRect(-8, -12, 16, 10);
  // Eyes
  ctx.fillStyle = '#000';
  ctx.fillRect(2, -10, 3, 3);
  // Mustache
  ctx.fillStyle = C.marioO;
  ctx.fillRect(-7, -4, 14, 3);
  ctx.fillRect(-5, -7, 4, 3);
  ctx.fillRect(3, -7, 4, 3);
  // Body
  ctx.fillStyle = C.mario;
  ctx.fillRect(-9, 0, 18, 12);
  // Overalls
  ctx.fillStyle = '#2040C0';
  ctx.fillRect(-7, 3, 14, 8);
  ctx.fillRect(-11, 0, 6, 8);
  ctx.fillRect(5, 0, 6, 8);
  // Buttons
  ctx.fillStyle = C.mario;
  ctx.fillRect(-3, 4, 3, 3);
  ctx.fillRect(1, 4, 3, 3);

  // Legs
  ctx.fillStyle = '#2040C0';
  if (jump) {
    ctx.fillRect(-9, 12, 8, 8); ctx.fillRect(1, 12, 8, 8);
  } else {
    ctx.fillRect(-9, 12, 8, 10 + legSwing); ctx.fillRect(1, 12, 8, 10 - legSwing);
  }
  // Shoes
  ctx.fillStyle = C.marioO;
  if (jump) {
    ctx.fillRect(-11, 18, 12, 5); ctx.fillRect(1, 18, 12, 5);
  } else {
    ctx.fillRect(-11, 20 + legSwing, 12, 5); ctx.fillRect(1, 20 - legSwing, 12, 5);
  }

  ctx.restore();
}
