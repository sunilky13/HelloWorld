import {
  Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, HostListener
} from '@angular/core';

// ─── Constants ───────────────────────────────────────────────────────────────
const G       = 0.55;
const JUMP_V  = -12;
const SPD     = 4;
const W       = 800;
const H       = 420;
const GROUND  = 370;
const WORLD_W = 4200;

// ─── Types ───────────────────────────────────────────────────────────────────
interface Rect  { x: number; y: number; w: number; h: number; }
interface Phys extends Rect { vx: number; vy: number; onGround: boolean; }

interface Player extends Phys {
  facing: 1|-1; hearts: number; invincible: number;
  animT: number; state: 'idle'|'run'|'jump'; dead: boolean; jumpCount: number;
}
interface Zombie extends Phys {
  facing: 1|-1; alive: boolean; animT: number;
}
interface Boss extends Phys {
  facing: 1|-1; health: number; maxHealth: number;
  state: 'walk'|'attack'|'hurt'|'dead'; stateTimer: number;
  animT: number; invincible: number;
}
interface Acorn extends Phys { rot: number; alive: boolean; }
interface Particle {
  x: number; y: number; vx: number; vy: number;
  alpha: number; color: string; r: number;
}

// ─── Level platforms ─────────────────────────────────────────────────────────
const PLATFORMS: Rect[] = [
  // Ground (one continuous strip)
  { x: 0,      y: GROUND, w: WORLD_W, h: 60 },
  // Floating platforms — increasing difficulty
  { x: 220,    y: 290, w: 130, h: 18 },
  { x: 430,    y: 230, w: 110, h: 18 },
  { x: 620,    y: 270, w: 100, h: 18 },
  { x: 810,    y: 200, w: 90,  h: 18 },
  { x: 980,    y: 250, w: 120, h: 18 },
  { x: 1160,   y: 300, w: 100, h: 18 },
  { x: 1320,   y: 230, w: 90,  h: 18 },
  { x: 1480,   y: 180, w: 130, h: 18 },
  { x: 1660,   y: 260, w: 110, h: 18 },
  { x: 1850,   y: 215, w: 90,  h: 18 },
  { x: 2020,   y: 280, w: 120, h: 18 },
  { x: 2210,   y: 240, w: 100, h: 18 },
  { x: 2380,   y: 300, w: 90,  h: 18 },
  // Boss arena raised platforms
  { x: 2700,   y: 290, w: 140, h: 18 },
  { x: 2920,   y: 240, w: 100, h: 18 },
  { x: 3100,   y: 290, w: 120, h: 18 },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function hits(a: Rect, b: Rect): boolean {
  return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y;
}

function resolve(e: Phys, p: Rect): boolean {
  if (!hits(e, p)) return false;
  const oL = e.x+e.w - p.x, oR = p.x+p.w - e.x;
  const oT = e.y+e.h - p.y, oB = p.y+p.h - e.y;
  const m  = Math.min(oL, oR, oT, oB);
  if (m === oT && e.vy >= 0)       { e.y = p.y - e.h;   e.vy = 0; }
  else if (m === oB && e.vy <= 0)  { e.y = p.y + p.h;   e.vy = 0; }
  else if (m === oL)               { e.x = p.x - e.w;   e.vx = 0; }
  else if (m === oR)               { e.x = p.x + p.w;   e.vx = 0; }
  return true;
}

function platformCollide(e: Phys): void {
  e.onGround = false;
  for (const p of PLATFORMS) {
    if (resolve(e, p) && e.vy === 0) e.onGround = true;
  }
}

// ─── Component ───────────────────────────────────────────────────────────────
@Component({
  selector: 'app-stickman-game',
  standalone: true,
  imports: [],
  templateUrl: './stickman-game.component.html',
  styleUrl: './stickman-game.component.css'
})
export class StickmanGameComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  gameState: 'start'|'playing'|'dead'|'win' = 'start';
  score = 0;

  private ctx!: CanvasRenderingContext2D;
  private raf = 0;
  private keys = new Set<string>();
  private touchLeft  = false;
  private touchRight = false;
  private touchJump  = false;
  private jumpHeld   = false;
  private lastTs     = 0;
  private camX       = 0;

  private player!: Player;
  private zombies!: Zombie[];
  private boss!: Boss;
  private acorns!: Acorn[];
  private particles!: Particle[];

  @HostListener('window:keydown', ['$event'])
  onKD(e: KeyboardEvent) {
    this.keys.add(e.code);
    if (this.gameState === 'playing' &&
        ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) {
      e.preventDefault();
    }
  }
  @HostListener('window:keyup', ['$event'])
  onKU(e: KeyboardEvent) { this.keys.delete(e.code); }

  ngAfterViewInit() {
    this.ctx = this.canvasRef.nativeElement.getContext('2d')!;
    this.drawBg();
  }
  ngOnDestroy() { cancelAnimationFrame(this.raf); }

  startGame() {
    cancelAnimationFrame(this.raf);
    this.score  = 0;
    this.camX   = 0;
    this.acorns = [];
    this.particles = [];

    this.player = {
      x: 80, y: 300, w: 24, h: 44,
      vx: 0, vy: 0, onGround: false,
      facing: 1, hearts: 3, invincible: 0,
      animT: 0, state: 'idle', dead: false, jumpCount: 0
    };

    // Zombies scattered across the level
    const zCoords = [
      [340,GROUND-40],[680,GROUND-40],[1020,GROUND-40],
      [1280,GROUND-40],[1650,GROUND-40],[1980,GROUND-40],[2180,GROUND-40],
      [450, 230-40],[1000, 250-40],[1490, 180-40]
    ];
    this.zombies = zCoords.map(([x,y]) => ({
      x, y, w: 22, h: 40, vx: -1.2, vy: 0,
      onGround: false, facing: -1 as -1, alive: true, animT: 0
    }));

    this.boss = {
      x: 3300, y: GROUND-130, w: 100, h: 130,
      vx: 0, vy: 0, onGround: false,
      facing: -1, health: 5, maxHealth: 5,
      state: 'walk', stateTimer: 90,
      animT: 0, invincible: 0
    };

    this.gameState = 'playing';
    this.lastTs = performance.now();
    this.raf = requestAnimationFrame(ts => this.loop(ts));
  }

  // Touch control handlers
  pressLeft(on: boolean)  { this.touchLeft  = on; }
  pressRight(on: boolean) { this.touchRight = on; }
  pressJump()             { this.touchJump  = true; }
  releaseJump()           { this.touchJump  = false; }

  // ─── Game loop ─────────────────────────────────────────────────────────────
  private loop(ts: number) {
    const dt = Math.min((ts - this.lastTs) / 16.67, 3);
    this.lastTs = ts;
    this.update(dt);
    this.render();
    if (this.gameState === 'playing') this.raf = requestAnimationFrame(t => this.loop(t));
  }

  private update(dt: number) {
    this.updatePlayer(dt);
    this.updateZombies(dt);
    this.updateBoss(dt);
    this.updateAcorns(dt);
    this.updateParticles(dt);
    this.camX += (this.player.x - W/3 - this.camX) * 0.1;
    this.camX  = Math.max(0, Math.min(this.camX, WORLD_W - W));
  }

  private updatePlayer(dt: number) {
    const p = this.player;
    if (p.dead) { p.vy += G*dt; p.y += p.vy*dt; return; }

    const left  = this.keys.has('ArrowLeft')  || this.keys.has('KeyA') || this.touchLeft;
    const right = this.keys.has('ArrowRight') || this.keys.has('KeyD') || this.touchRight;
    const jump  = this.keys.has('ArrowUp') || this.keys.has('KeyW') ||
                  this.keys.has('Space')   || this.touchJump;

    p.vx = left ? -SPD : right ? SPD : 0;
    if (left)  p.facing = -1;
    if (right) p.facing =  1;

    if (jump && !this.jumpHeld && p.jumpCount < 2) {
      p.vy = JUMP_V; p.jumpCount++; this.jumpHeld = true;
    }
    if (!jump) this.jumpHeld = false;

    p.vy = Math.min(p.vy + G*dt, 16);
    p.x += p.vx*dt;
    p.y += p.vy*dt;
    p.x  = Math.max(0, p.x);

    platformCollide(p);
    if (p.onGround) p.jumpCount = 0;

    // Fall pit
    if (p.y > H+60) { this.takeDamage(); return; }

    // State & animation
    p.state = p.onGround ? (Math.abs(p.vx) > 0.1 ? 'run' : 'idle') : 'jump';
    if (p.state === 'run') p.animT += dt;
    if (p.invincible > 0) p.invincible -= dt;

    // Enemy collision
    if (p.invincible > 0) return;

    for (const z of this.zombies) {
      if (!z.alive || !hits(p, z)) continue;
      if (p.vy > 0 && p.y+p.h < z.y+z.h*0.55) {
        this.stompZombie(z); p.vy = JUMP_V*0.65;
      } else { this.takeDamage(); }
    }

    if (this.boss.health > 0 && hits(p, this.boss)) {
      if (p.vy > 0 && p.y+p.h < this.boss.y+this.boss.h*0.38 && this.boss.invincible <= 0) {
        this.boss.health--;
        this.boss.invincible = 60;
        this.boss.state = 'hurt';
        this.boss.stateTimer = 35;
        p.vy = JUMP_V*0.75;
        this.score += 250;
        this.burst(this.boss.x+50, this.boss.y+20, '#f97316', 10);
        if (this.boss.health <= 0) {
          this.boss.state = 'dead';
          this.score += 1000;
          setTimeout(() => { this.gameState = 'win'; }, 1800);
        }
      } else if (this.boss.state !== 'dead' && this.boss.state !== 'hurt') {
        this.takeDamage();
      }
    }
  }

  private takeDamage() {
    const p = this.player;
    p.hearts--;
    p.invincible = 100;
    p.vy = -7; p.vx = -p.facing*4;
    this.burst(p.x+p.w/2, p.y+10, '#ef4444', 8);
    if (p.hearts <= 0) {
      p.dead = true;
      setTimeout(() => { this.gameState = 'dead'; }, 900);
    } else if (p.y > H) {
      p.x = Math.max(50, this.camX + 80); p.y = 200; p.vy = 0;
    }
  }

  private stompZombie(z: Zombie) {
    z.alive = false;
    this.score += 100;
    this.burst(z.x+z.w/2, z.y+5, '#86efac', 10);
  }

  private updateZombies(dt: number) {
    for (const z of this.zombies) {
      if (!z.alive) continue;
      z.vy = Math.min(z.vy + G*dt, 16);
      z.x += z.vx*dt; z.y += z.vy*dt;
      platformCollide(z);

      const p = this.player;
      const dx = p.x - z.x;
      if (Math.abs(dx) < 450) { z.vx = Math.sign(dx)*1.3; z.facing = Math.sign(dx) as 1|-1; }
      if (z.y > H+80) z.alive = false;
      z.animT += dt;
    }
  }

  private updateBoss(dt: number) {
    const b = this.boss;
    if (b.state === 'dead') { b.vy += G*dt; b.y += b.vy*dt; return; }
    if (b.health <= 0) return;
    if (b.invincible > 0) b.invincible -= dt;

    const dist = Math.abs(this.player.x - b.x);
    if (dist > 1000) return;

    b.stateTimer -= dt;

    if (b.state === 'walk') {
      b.vx = b.facing * 2.2;
      if (b.stateTimer <= 0) {
        b.facing = (this.player.x > b.x ? 1 : -1);
        if (dist < 350) { b.state = 'attack'; b.stateTimer = 70; b.vx = 0; }
        else b.stateTimer = 80;
      }
    } else if (b.state === 'attack') {
      b.vx = 0;
      if (Math.ceil(b.stateTimer) === 69) this.throwAcorn();
      if (b.stateTimer <= 0) { b.state = 'walk'; b.stateTimer = 100; }
    } else if (b.state === 'hurt') {
      b.vx = 0;
      if (b.stateTimer <= 0) { b.state = 'walk'; b.stateTimer = 80; }
    }

    b.vy = Math.min(b.vy + G*dt, 16);
    b.x += b.vx*dt; b.y += b.vy*dt;
    b.x  = Math.max(2560, Math.min(WORLD_W - b.w - 50, b.x));
    platformCollide(b);
    b.animT += dt;
  }

  private throwAcorn() {
    const b = this.boss, p = this.player;
    const dx = p.x+p.w/2 - (b.x+b.w/2);
    const dy = p.y       - (b.y+b.h*0.3);
    const d  = Math.sqrt(dx*dx+dy*dy) || 1;
    this.acorns.push({
      x: b.x+b.w/2-6, y: b.y+b.h*0.28,
      w: 14, h: 14,
      vx: dx/d*7, vy: dy/d*7-1.5,
      rot: 0, alive: true, onGround: false
    });
  }

  private updateAcorns(dt: number) {
    const p = this.player;
    for (const a of this.acorns) {
      if (!a.alive) continue;
      a.vy += G*0.25*dt;
      a.x  += a.vx*dt; a.y += a.vy*dt;
      a.rot += 0.18*dt;
      if (a.y > H+50 || a.x < 0 || a.x > WORLD_W) { a.alive = false; continue; }
      for (const pl of PLATFORMS) { if (hits(a,pl)) { a.alive=false; this.burst(a.x,a.y,'#92400e',5); break; } }
      if (a.alive && p.invincible <= 0 && hits(a,p)) { a.alive=false; this.takeDamage(); }
    }
    this.acorns = this.acorns.filter(a=>a.alive);
  }

  private updateParticles(dt: number) {
    for (const p of this.particles) {
      p.x += p.vx*dt; p.y += p.vy*dt;
      p.vy += 0.2*dt; p.alpha -= 0.025*dt;
    }
    this.particles = this.particles.filter(p=>p.alpha>0);
  }

  private burst(x: number, y: number, color: string, n: number) {
    for (let i=0;i<n;i++) this.particles.push({
      x, y,
      vx: (Math.random()-.5)*8, vy: (Math.random()-.5)*8-2,
      alpha: 1, color, r: 3+Math.random()*4
    });
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  private render() {
    const c = this.ctx, cam = this.camX;

    // Sky
    const sky = c.createLinearGradient(0,0,0,H);
    sky.addColorStop(0,'#0f2344'); sky.addColorStop(1,'#2a5298');
    c.fillStyle = sky; c.fillRect(0,0,W,H);

    this.drawBgLayers(cam);

    c.save(); c.translate(-cam, 0);

    // Platforms
    for (const pl of PLATFORMS) {
      if (pl.x+pl.w < cam-10 || pl.x > cam+W+10) continue;
      if (pl.h > 30) {
        c.fillStyle='#2d5016'; c.fillRect(pl.x,pl.y,pl.w,pl.h);
        c.fillStyle='#3d7a1c'; c.fillRect(pl.x,pl.y,pl.w,9);
      } else {
        c.fillStyle='#7c4a1e'; c.fillRect(pl.x,pl.y,pl.w,pl.h);
        c.fillStyle='#4a8a2a'; c.fillRect(pl.x,pl.y,pl.w,6);
      }
    }

    // Particles
    for (const p of this.particles) {
      c.save(); c.globalAlpha=p.alpha; c.fillStyle=p.color;
      c.beginPath(); c.arc(p.x,p.y,p.r,0,Math.PI*2); c.fill(); c.restore();
    }

    // Entities
    for (const z of this.zombies) if (z.alive && z.x+z.w>cam-10 && z.x<cam+W+10) this.drawZombie(z);
    if (this.boss.health>=0) this.drawBoss(this.boss);
    for (const a of this.acorns) this.drawAcorn(a);
    this.drawPlayer(this.player);

    c.restore();
    this.drawHUD();
  }

  drawBg() {
    const c = this.ctx;
    const sky = c.createLinearGradient(0,0,0,H);
    sky.addColorStop(0,'#0f2344'); sky.addColorStop(1,'#2a5298');
    c.fillStyle=sky; c.fillRect(0,0,W,H);
  }

  private drawBgLayers(cam: number) {
    const c = this.ctx;
    // Far mountains
    c.fillStyle='#1a3055';
    const o1 = cam*0.15;
    for (let i=0;i<10;i++) {
      const mx = i*220-(o1%220);
      c.beginPath(); c.moveTo(mx,H); c.lineTo(mx+100,150); c.lineTo(mx+220,H); c.fill();
    }
    // Trees
    c.fillStyle='#16391a';
    const o2 = cam*0.35;
    for (let i=0;i<16;i++) {
      const tx = i*140-(o2%140);
      c.beginPath(); c.moveTo(tx,GROUND); c.lineTo(tx+30,GROUND-80); c.lineTo(tx+60,GROUND); c.fill();
    }
  }

  private drawPlayer(p: Player) {
    const c = this.ctx;
    if (p.invincible>0 && Math.floor(p.invincible/4)%2===0) return;
    const cx=p.x+p.w/2, cy=p.y;
    const t=p.animT, f=p.facing;
    const ls=p.state==='run'?Math.sin(t*.4)*13:0;
    const as=p.state==='run'?Math.sin(t*.4)*10:0;
    const bob=p.state==='run'?Math.abs(Math.sin(t*.4))*2:0;

    c.save(); c.lineCap='round';

    // Cape
    c.beginPath();
    c.moveTo(cx-f*2, cy+bob+17);
    c.quadraticCurveTo(cx-f*16, cy+bob+24, cx-f*12, cy+bob+34);
    c.strokeStyle='#dc2626'; c.lineWidth=2.5; c.stroke();

    // Head
    c.beginPath(); c.arc(cx, cy+8, 8.5, 0, Math.PI*2);
    c.fillStyle='#fde68a'; c.fill();
    c.strokeStyle='#000'; c.lineWidth=1.5; c.stroke();

    // Face
    c.fillStyle='#1e293b';
    c.beginPath(); c.arc(cx+f*3.5, cy+7, 1.8, 0, Math.PI*2); c.fill();
    c.beginPath(); c.arc(cx+f*1, cy+11, 3, 0.1, Math.PI-0.1); c.strokeStyle='#92400e'; c.lineWidth=1.2; c.stroke();

    // Body
    const bT=cy+17+bob, bB=cy+34+bob;
    c.strokeStyle='#fff'; c.lineWidth=2.8;
    c.beginPath(); c.moveTo(cx,bT); c.lineTo(cx,bB); c.stroke();

    // Arms
    c.beginPath();
    c.moveTo(cx,bT+5); c.lineTo(cx-11+as, bT+15);
    c.moveTo(cx,bT+5); c.lineTo(cx+11-as, bT+15);
    c.stroke();

    // Legs
    c.beginPath();
    c.moveTo(cx,bB); c.lineTo(cx-9+ls, bB+11);
    c.moveTo(cx,bB); c.lineTo(cx+9-ls, bB+11);
    c.stroke();

    c.restore();
  }

  private drawZombie(z: Zombie) {
    const c = this.ctx;
    const cx=z.x+z.w/2, cy=z.y, t=z.animT, f=z.facing;
    const wb=Math.sin(t*.12)*6;

    c.save(); c.lineCap='round';

    // Head (rotten green)
    c.save(); c.translate(cx, cy+8); c.rotate(wb*0.04);
    c.beginPath(); c.arc(0,0,8.5,0,Math.PI*2);
    c.fillStyle='#6ee7b7'; c.fill();
    c.strokeStyle='#065f46'; c.lineWidth=1.5; c.stroke();
    // X eyes
    c.strokeStyle='#dc2626'; c.lineWidth=1.8;
    [-3.5,3.5].forEach(ex=>{
      c.beginPath();
      c.moveTo(ex-2,-2); c.lineTo(ex+2,2);
      c.moveTo(ex+2,-2); c.lineTo(ex-2,2);
      c.stroke();
    });
    // Drool
    c.strokeStyle='#059669'; c.lineWidth=1.2;
    c.beginPath(); c.moveTo(f*2,5); c.lineTo(f*3,10); c.stroke();
    c.restore();

    const bT=cy+17, bB=cy+33;
    c.strokeStyle='#4ade80'; c.lineWidth=2.5;
    c.beginPath(); c.moveTo(cx,bT); c.lineTo(cx,bB); c.stroke();

    // Outstretched zombie arms
    c.beginPath();
    c.moveTo(cx,bT+5); c.lineTo(cx+f*15, bT+3+Math.sin(t*.08)*4);
    c.moveTo(cx,bT+5); c.lineTo(cx-f*7, bT+9);
    c.stroke();

    // Shambling legs
    const lOff=Math.sin(t*.18)*7;
    c.beginPath();
    c.moveTo(cx,bB); c.lineTo(cx-7+lOff,bB+10);
    c.moveTo(cx,bB); c.lineTo(cx+7-lOff,bB+10);
    c.stroke();

    c.restore();
  }

  private drawBoss(b: Boss) {
    const c = this.ctx;
    if (b.y > H+250) return;
    if (b.invincible>0 && Math.floor(b.invincible/3)%2===0) return;

    const cx=b.x+b.w/2, cy=b.y, f=b.facing, t=b.animT;
    const tailBob=Math.sin(t*.09)*10;
    const armBob=b.state==='attack'?Math.sin(t*.25)*14:Math.sin(t*.07)*5;

    c.save();

    // Bushy tail
    c.fillStyle='#92400e';
    c.beginPath();
    c.moveTo(cx-f*28, cy+65);
    c.bezierCurveTo(cx-f*72,cy+45+tailBob, cx-f*80,cy-5+tailBob, cx-f*35,cy+8+tailBob);
    c.bezierCurveTo(cx-f*65,cy+0+tailBob,  cx-f*60,cy+55,        cx-f*24,cy+70);
    c.closePath(); c.fill();
    // Tail highlight
    c.fillStyle='#b45309';
    c.beginPath();
    c.moveTo(cx-f*30,cy+62);
    c.bezierCurveTo(cx-f*65,cy+40+tailBob, cx-f*70,cy+0+tailBob, cx-f*30,cy+12+tailBob);
    c.bezierCurveTo(cx-f*55,cy+5+tailBob,  cx-f*50,cy+50,        cx-f*22,cy+67);
    c.fill();

    // Body
    c.fillStyle='#92400e';
    c.beginPath(); c.ellipse(cx,cy+72,40,52,0,0,Math.PI*2); c.fill();

    // Belly
    c.fillStyle='#d97706';
    c.beginPath(); c.ellipse(cx,cy+78,24,36,0,0,Math.PI*2); c.fill();

    // Head
    c.fillStyle='#92400e';
    c.beginPath(); c.ellipse(cx+f*9,cy+22,30,27,f*0.15,0,Math.PI*2); c.fill();

    // Ears
    [[-6,-22,8],[16,-20,24]].forEach(([ex,ey,fx])=>{
      c.fillStyle='#92400e';
      c.beginPath(); c.moveTo(cx+f*ex,cy+4); c.lineTo(cx+f*fx,cy+ey); c.lineTo(cx+f*(ex+10),cy+6); c.closePath(); c.fill();
      c.fillStyle='#fca5a5';
      c.beginPath(); c.moveTo(cx+f*ex,cy+4); c.lineTo(cx+f*(fx-2),cy+ey+4); c.lineTo(cx+f*(ex+7),cy+6); c.closePath(); c.fill();
    });

    // Eyes
    c.fillStyle='#000';
    c.beginPath(); c.arc(cx+f*16,cy+19,5.5,0,Math.PI*2); c.fill();
    c.fillStyle='#dc2626';
    c.beginPath(); c.arc(cx+f*17,cy+18,2.5,0,Math.PI*2); c.fill();

    // Angry brow
    c.strokeStyle='#000'; c.lineWidth=2.8;
    c.beginPath(); c.moveTo(cx+f*10,cy+12); c.lineTo(cx+f*23,cy+9); c.stroke();

    // Nose
    c.fillStyle='#7c2d12';
    c.beginPath(); c.arc(cx+f*22,cy+24,3.5,0,Math.PI*2); c.fill();

    // Cheek pouches
    c.fillStyle='#b45309';
    c.beginPath(); c.ellipse(cx+f*26,cy+32,11,8,0,0,Math.PI*2); c.fill();

    // Arms
    c.lineCap='round'; c.lineWidth=13; c.strokeStyle='#92400e';
    c.beginPath();
    c.moveTo(cx-32,cy+50); c.lineTo(cx-48,cy+72+armBob); c.stroke();
    c.beginPath();
    c.moveTo(cx+32,cy+50); c.lineTo(cx+48,cy+68-armBob); c.stroke();

    // Hands/claws
    c.lineWidth=2; c.strokeStyle='#78350f';
    [[cx-48,cy+72+armBob],[cx+48,cy+68-armBob]].forEach(([hx,hy])=>{
      for (let i=-1;i<=1;i++) {
        c.beginPath(); c.moveTo(hx,hy); c.lineTo(hx+i*5, hy+8); c.stroke();
      }
    });

    // Legs
    c.lineWidth=15; c.strokeStyle='#92400e';
    c.beginPath(); c.moveTo(cx-22,cy+115); c.lineTo(cx-30,cy+b.h-4); c.stroke();
    c.beginPath(); c.moveTo(cx+22,cy+115); c.lineTo(cx+30,cy+b.h-4); c.stroke();

    // Health phases tint
    if (b.health <= 2) {
      c.fillStyle='rgba(220,38,38,0.18)';
      c.beginPath(); c.ellipse(cx,cy+60,50,70,0,0,Math.PI*2); c.fill();
    }

    c.restore();
  }

  private drawAcorn(a: Acorn) {
    const c = this.ctx;
    c.save(); c.translate(a.x+a.w/2, a.y+a.h/2); c.rotate(a.rot);
    c.fillStyle='#78350f';
    c.beginPath(); c.ellipse(0,-2,7,5,0,0,Math.PI*2); c.fill();
    c.fillStyle='#d97706';
    c.beginPath(); c.ellipse(0,4,6,7,0,0,Math.PI*2); c.fill();
    c.strokeStyle='#78350f'; c.lineWidth=1.5;
    c.beginPath(); c.moveTo(0,-7); c.lineTo(1,-12); c.stroke();
    c.restore();
  }

  private drawHUD() {
    const c = this.ctx, p = this.player;

    // Hearts
    c.font='20px serif';
    for (let i=0;i<3;i++) c.fillText(i<p.hearts?'❤️':'🖤', 14+i*30, 32);

    // Score
    c.fillStyle='#fff'; c.font='bold 15px sans-serif'; c.textAlign='right';
    c.fillText(`Score: ${this.score}`, W-14, 28); c.textAlign='left';

    // Boss health bar
    const b=this.boss;
    if (b.health>0 && Math.abs(this.player.x-b.x)<1200) {
      const bw=220, bh=16, bx=(W-bw)/2, by=10;
      c.fillStyle='rgba(0,0,0,0.55)'; c.fillRect(bx-2,by-2,bw+4,bh+4);
      const ratio=b.health/b.maxHealth;
      const barColor=ratio>0.6?'#22c55e':ratio>0.3?'#f59e0b':'#ef4444';
      c.fillStyle=barColor; c.fillRect(bx,by,bw*ratio,bh);
      c.strokeStyle='#fff'; c.lineWidth=1; c.strokeRect(bx,by,bw,bh);
      c.fillStyle='#fff'; c.font='bold 11px sans-serif'; c.textAlign='center';
      c.fillText('👑 Giant Squirrel Boss', W/2, by+bh+14);
      c.textAlign='left';
    }

    // Progress bar
    const prog=Math.min(this.player.x/(WORLD_W-200),1);
    c.fillStyle='rgba(0,0,0,0.4)'; c.fillRect(14,H-18,W-28,7);
    c.fillStyle='#4ade80';         c.fillRect(14,H-18,(W-28)*prog,7);
    c.font='13px serif'; c.fillText('🏁',W-28,H-9);
  }
}
