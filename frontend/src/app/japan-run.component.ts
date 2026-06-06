import {
  Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, HostListener
} from '@angular/core';

const CW = 800, CH = 450;
const BASE_SPD = 5;
const BOOST_SPD = 6;
const TOTAL_KM = 1000;
const BOOST_DURATION = 180;
const BOOST_COOLDOWN = 360;
const PUNCH_RANGE = 120;
const BOSS_PUNCHES = 3;
const PS = 3; // art-pixel size: 1 "pixel" = 3×3 screen pixels

type Phase = 'start' | 'run' | 'boss' | 'win' | 'lose';
type BossState = 'idle' | 'attack' | 'stagger' | 'dead';
type Biome = 'tokyo' | 'fuji' | 'kyoto' | 'countryside' | 'osaka' | 'finish';

const BIOMES: { name: Biome; label: string; km: [number, number]; hillAmp: number; skyTop: string; skyBot: string }[] = [
  { name: 'tokyo',       label: '🏙️ Tokyo',         km: [0, 180],    hillAmp: 8,  skyTop: '#080818', skyBot: '#18082a' },
  { name: 'fuji',        label: '🗻 Mt. Fuji',       km: [180, 380],  hillAmp: 70, skyTop: '#060e18', skyBot: '#0e1828' },
  { name: 'kyoto',       label: '⛩️ Kyoto',          km: [380, 550],  hillAmp: 25, skyTop: '#18060e', skyBot: '#28101a' },
  { name: 'countryside', label: '🌾 Countryside',    km: [550, 720],  hillAmp: 40, skyTop: '#060e06', skyBot: '#0e1a0e' },
  { name: 'osaka',       label: '🏯 Osaka',          km: [720, 900],  hillAmp: 12, skyTop: '#180606', skyBot: '#280c0c' },
  { name: 'finish',      label: '🎌 Final Showdown', km: [900, 1000], hillAmp: 5,  skyTop: '#1a0000', skyBot: '#3a0000' },
];

interface Particle {
  x: number; y: number; vx: number; vy: number; alpha: number; c: string; r: number; life: number;
}

@Component({
  selector: 'app-japan-run',
  standalone: true,
  imports: [],
  templateUrl: './japan-run.component.html',
  styleUrl: './japan-run.component.css'
})
export class JapanRunComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  phase: Phase = 'start';
  km = 0;
  keys = new Set<string>();

  private ctx!: CanvasRenderingContext2D;
  private raf = 0;
  private lastTs = 0;
  private animT = 0;

  // Deku
  private dekuX = 200;
  private dekuY = CH - 120;
  private dekuGY = CH - 120;
  private dekuVy = 0;
  private dekuAir = false;
  private dekuJumpWas = false;
  private dekuJumps = 0;
  private boostFrames = 0;
  private boostCooldown = 0;
  private dekuSpd = BASE_SPD;

  // Shigaraki
  private shigX = 380;
  private shigY = CH - 120;
  private shigGY = CH - 120;
  private shigSpd = BASE_SPD;

  // Boss fight
  bossState: BossState = 'idle';
  bossHits = 0;
  private bossTimer = 0;
  private bossAttackCooldown = 0;
  private playerHP = 3;
  private punchWas = false;
  private playerHitTimer = 0;

  // World
  private worldX = 0;
  private bgOff = 0;
  private mgOff = 0;
  private terrain: { x: number; y: number }[] = [];
  private terrainWX = 0;
  private particles: Particle[] = [];
  private touchJump = false;
  private touchPunch = false;
  private touchBoost = false;

  get currentBiome(): typeof BIOMES[0] {
    return BIOMES.find(b => this.km >= b.km[0] && this.km < b.km[1]) ?? BIOMES[BIOMES.length - 1];
  }
  get boosting(): boolean { return this.boostFrames > 0; }
  get boostReady(): boolean { return this.boostCooldown <= 0; }

  @HostListener('window:keydown', ['$event'])
  onKD(e: KeyboardEvent) {
    this.keys.add(e.code);
    if (['Space', 'ArrowUp', 'KeyW'].includes(e.code) && this.phase === 'run') e.preventDefault();
    if (this.phase === 'start' && ['Space', 'Enter'].includes(e.code)) this.startGame();
    if ((this.phase === 'win' || this.phase === 'lose') && ['Space', 'Enter'].includes(e.code)) this.resetGame();
  }
  @HostListener('window:keyup', ['$event'])
  onKU(e: KeyboardEvent) { this.keys.delete(e.code); }

  ngAfterViewInit() {
    this.ctx = this.canvasRef.nativeElement.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    this.buildTerrain(0);
    this.drawFrame();
  }
  ngOnDestroy() { cancelAnimationFrame(this.raf); }

  pressJump()  { this.touchJump  = true;  }
  relJump()    { this.touchJump  = false; }
  pressBoost() { this.touchBoost = true;  }
  relBoost()   { this.touchBoost = false; }
  pressPunch() { this.touchPunch = true;  }
  relPunch()   { this.touchPunch = false; }

  startGame() {
    cancelAnimationFrame(this.raf);
    this.phase = 'run';
    this.km = 0; this.worldX = 0; this.animT = 0; this.bgOff = 0; this.mgOff = 0;
    this.dekuX = 200; this.dekuY = CH - 120; this.dekuVy = 0; this.dekuAir = false;
    this.dekuJumps = 0; this.dekuJumpWas = false;
    this.boostFrames = 0; this.boostCooldown = 0; this.dekuSpd = BASE_SPD;
    this.shigX = 380; this.shigY = CH - 120; this.shigSpd = BASE_SPD;
    this.bossState = 'idle'; this.bossHits = 0; this.bossTimer = 0;
    this.bossAttackCooldown = 120; this.playerHP = 3; this.punchWas = false; this.playerHitTimer = 0;
    this.particles = [];
    this.terrain = []; this.terrainWX = 0;
    this.buildTerrain(0);
    this.lastTs = performance.now();
    this.raf = requestAnimationFrame(ts => this.loop(ts));
  }

  resetGame() { this.phase = 'start'; cancelAnimationFrame(this.raf); this.drawFrame(); }

  // ── Terrain ───────────────────────────────────────────────────────────────

  private buildTerrain(startWX: number) {
    const count = Math.ceil((CW + 300) / 4) + 4;
    for (let i = 0; i < count; i++) {
      const wx = startWX + i * 4;
      this.terrain.push({ x: wx - startWX, y: this.terrainY(wx) });
    }
    this.terrainWX = startWX + (count - 1) * 4;
  }

  private terrainY(wx: number): number {
    const kmX = wx / (1000000 / TOTAL_KM);
    const biome = BIOMES.find(b => kmX >= b.km[0] && kmX < b.km[1]) ?? BIOMES[BIOMES.length - 1];
    const amp = biome.hillAmp;
    return (CH - 90) - amp * Math.sin(wx / 800) - 15 * Math.sin(wx / 190 + 1.2) - 5 * Math.sin(wx / 60 + 0.7);
  }

  private scrollTerrain(spd: number) {
    for (const p of this.terrain) p.x -= spd;
    while (this.terrain.length > 0 && this.terrain[0].x < -50) this.terrain.shift();
    while (this.terrainWX < this.worldX + CW + 300) {
      this.terrainWX += 4;
      this.terrain.push({ x: this.terrainWX - this.worldX, y: this.terrainY(this.terrainWX) });
    }
  }

  private getGroundAt(screenX: number): number {
    const idx = this.terrain.findIndex(p => p.x >= screenX);
    if (idx <= 0) return CH - 100;
    const a = this.terrain[idx - 1], b = this.terrain[idx];
    const t = (screenX - a.x) / (b.x - a.x);
    return a.y + (b.y - a.y) * t;
  }

  // ── Game loop ─────────────────────────────────────────────────────────────

  private loop(ts: number) {
    const dt = Math.min((ts - this.lastTs) / 16.67, 3);
    this.lastTs = ts;
    if (this.phase === 'run') this.updateRun(dt);
    else if (this.phase === 'boss') this.updateBoss(dt);
    this.drawFrame();
    if (this.phase === 'run' || this.phase === 'boss')
      this.raf = requestAnimationFrame(t => this.loop(t));
  }

  // ── Run phase ─────────────────────────────────────────────────────────────

  private updateRun(dt: number) {
    this.animT += dt;

    const wantBoost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchBoost;
    if (wantBoost && this.boostCooldown <= 0 && this.boostFrames <= 0) {
      this.boostFrames = BOOST_DURATION;
      this.boostCooldown = BOOST_COOLDOWN;
    }
    if (this.boostFrames > 0) { this.boostFrames -= dt; this.dekuSpd = BOOST_SPD; }
    else { this.dekuSpd = BASE_SPD; }
    if (this.boostCooldown > 0) this.boostCooldown -= dt;

    const scroll = this.dekuSpd;
    this.scrollTerrain(scroll);
    this.worldX += scroll;
    this.bgOff += scroll * 0.12;
    this.mgOff += scroll * 0.35;

    this.dekuGY = this.getGroundAt(this.dekuX);
    this.shigGY  = this.getGroundAt(this.shigX);

    const wantJump = this.keys.has('Space') || this.keys.has('ArrowUp') || this.keys.has('KeyW') || this.touchJump;
    const justJump = wantJump && !this.dekuJumpWas;
    if (justJump && this.dekuJumps < 2) { this.dekuVy = -13; this.dekuAir = true; this.dekuJumps++; }
    this.dekuJumpWas = wantJump;

    if (this.dekuAir) {
      this.dekuVy += 0.65 * dt;
      this.dekuY += this.dekuVy * dt;
      if (this.dekuY >= this.dekuGY) { this.dekuY = this.dekuGY; this.dekuVy = 0; this.dekuAir = false; this.dekuJumps = 0; }
    } else { this.dekuY = this.dekuGY; }

    const gap = this.shigX - this.dekuX;
    const targetGap = this.boosting ? 80 : 180;
    this.shigX += (targetGap - gap) * 0.02 * dt + (this.shigSpd - this.dekuSpd) * dt * 0.5;
    this.shigX = Math.max(this.dekuX + 40, Math.min(CW - 60, this.shigX));
    this.shigY  = this.shigGY;

    if (this.boosting && Math.random() < 0.5) {
      this.particles.push({
        x: this.dekuX + (Math.random() - 0.5) * 30,
        y: this.dekuY - 50 + (Math.random() - 0.5) * 40,
        vx: -3 + (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 4,
        alpha: 1, c: Math.random() > 0.4 ? '#00e5ff' : '#4ade80', r: 2 + Math.random() * 3, life: 1
      });
    }

    const wantPunch = this.keys.has('KeyZ') || this.keys.has('ControlLeft') || this.touchPunch;
    const justPunch = wantPunch && !this.punchWas;
    this.punchWas = wantPunch;
    if (justPunch && this.boosting && (this.shigX - this.dekuX) < PUNCH_RANGE) {
      this.spawnPunchEffect(this.shigX - 20, this.shigY - 40);
      this.shigX += 60;
    }

    for (const p of this.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.1 * dt; p.alpha -= 0.03 * dt;
    }
    this.particles = this.particles.filter(p => p.alpha > 0);

    this.km = Math.min(TOTAL_KM, this.worldX / (1000000 / TOTAL_KM));
    if (this.km >= TOTAL_KM) { this.phase = 'boss'; this.shigX = CW - 140; this.dekuX = 140; }
  }

  // ── Boss phase ────────────────────────────────────────────────────────────

  private updateBoss(dt: number) {
    this.animT += dt;
    if (this.playerHitTimer > 0) this.playerHitTimer -= dt;

    const wantPunch = this.keys.has('KeyZ') || this.keys.has('ControlLeft') || this.touchPunch;
    const justPunch = wantPunch && !this.punchWas;
    this.punchWas = wantPunch;

    if (this.bossState === 'idle') {
      this.bossAttackCooldown -= dt;
      if (justPunch && Math.abs(this.shigX - this.dekuX - 60) < 120) {
        this.bossHits++;
        this.bossState = 'stagger';
        this.bossTimer = 60;
        this.spawnPunchEffect(this.shigX - 10, this.shigY - 50);
        if (this.bossHits >= BOSS_PUNCHES) { this.bossState = 'dead'; this.phase = 'win'; }
      }
      if (this.bossAttackCooldown <= 0) {
        this.bossState = 'attack'; this.bossTimer = 40;
        this.bossAttackCooldown = 150 + Math.random() * 100;
      }
    } else if (this.bossState === 'attack') {
      this.bossTimer -= dt;
      if (this.bossTimer <= 20 && this.playerHitTimer <= 0 && Math.abs(this.shigX - this.dekuX - 60) < 130) {
        this.playerHP--; this.playerHitTimer = 80;
        this.spawnHitEffect(this.dekuX, this.dekuY - 40);
        if (this.playerHP <= 0) this.phase = 'lose';
      }
      if (this.bossTimer <= 0) this.bossState = 'idle';
    } else if (this.bossState === 'stagger') {
      this.bossTimer -= dt;
      if (this.bossTimer <= 0) this.bossState = 'idle';
    }

    const targetX = this.dekuX + 140;
    this.shigX += (targetX - this.shigX) * 0.04 * dt;

    for (const p of this.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.1 * dt; p.alpha -= 0.03 * dt;
    }
    this.particles = this.particles.filter(p => p.alpha > 0);
  }

  private spawnPunchEffect(x: number, y: number) {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      this.particles.push({
        x, y, vx: Math.cos(a) * (4 + Math.random() * 5),
        vy: Math.sin(a) * (4 + Math.random() * 5),
        alpha: 1, c: i % 3 === 0 ? '#ffffff' : i % 3 === 1 ? '#4ade80' : '#00e5ff',
        r: 3 + Math.random() * 4, life: 1
      });
    }
  }

  private spawnHitEffect(x: number, y: number) {
    for (let i = 0; i < 10; i++) {
      this.particles.push({
        x, y, vx: (Math.random() - 0.5) * 9, vy: (Math.random() - 0.5) * 9 - 2,
        alpha: 1, c: i % 2 === 0 ? '#f87171' : '#7c3aed', r: 3 + Math.random() * 4, life: 1
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDERING
  // ═══════════════════════════════════════════════════════════════════════════

  private drawFrame() {
    const c = this.ctx;
    c.imageSmoothingEnabled = false;
    if (this.phase === 'start') { this.drawStart(c); return; }
    if (this.phase === 'win')   { this.drawEndScreen(c, true);  return; }
    if (this.phase === 'lose')  { this.drawEndScreen(c, false); return; }

    this.drawDestroyedCity(c);
    this.drawStoneBricks(c);
    this.drawParticles(c);
    this.drawShigarakiSprite(c, this.shigX, this.shigY, this.phase === 'boss');
    this.drawDekuSprite(c, this.dekuX, this.dekuY);
    this.drawHUD(c);
  }

  // ── Destroyed city background ─────────────────────────────────────────────

  private drawDestroyedCity(c: CanvasRenderingContext2D) {
    const biome = this.currentBiome;

    // Sky gradient
    const sky = c.createLinearGradient(0, 0, 0, CH);
    sky.addColorStop(0, biome.skyTop);
    sky.addColorStop(1, biome.skyBot);
    c.fillStyle = sky; c.fillRect(0, 0, CW, CH);

    // Animated clouds (very dark storm clouds)
    this.drawStormClouds(c, biome.skyTop);

    // Far building layer (slowest scroll)
    const bOff = -(this.bgOff % (CW * 3));
    this.drawBuildingLayer(c, bOff,      '#111120', '#0a0a18', 90,  260, 45, 90);
    this.drawBuildingLayer(c, bOff + CW, '#111120', '#0a0a18', 90,  260, 45, 90);
    this.drawBuildingLayer(c, bOff + CW * 2, '#111120', '#0a0a18', 90, 260, 45, 90);

    // Mid building layer
    const mOff = -(this.mgOff % (CW * 2));
    this.drawBuildingLayer(c, mOff,      '#1a1a30', '#141428', 70,  200, 35, 70);
    this.drawBuildingLayer(c, mOff + CW, '#1a1a30', '#141428', 70,  200, 35, 70);

    // Near rubble
    this.drawRubbleLayer(c, -(this.mgOff * 1.6 % (CW * 2)));
  }

  private drawStormClouds(c: CanvasRenderingContext2D, baseColor: string) {
    const offX = -(this.bgOff * 0.04 % CW);
    const clouds = [
      { x: 0,   y: 18, w: 180, h: 50 },
      { x: 220, y: 8,  w: 220, h: 60 },
      { x: 480, y: 22, w: 160, h: 44 },
      { x: 680, y: 12, w: 200, h: 55 },
    ];
    for (const cl of clouds) {
      const cx = (cl.x + offX + CW * 2) % (CW + cl.w) - cl.w / 2;
      c.fillStyle = '#1a1a2e';
      // Pixel-art blocky clouds
      c.fillRect(cx + cl.w * 0.15, cl.y,           cl.w * 0.7, cl.h * 0.6);
      c.fillRect(cx,               cl.y + cl.h * 0.3, cl.w,    cl.h * 0.7);
      c.fillRect(cx + cl.w * 0.05, cl.y + cl.h * 0.1, cl.w * 0.9, cl.h * 0.8);
      c.fillStyle = '#0e0e1e';
      c.fillRect(cx,               cl.y + cl.h * 0.5, cl.w,    cl.h * 0.5);
    }
  }

  private drawBuildingLayer(
    c: CanvasRenderingContext2D, offX: number,
    fillCol: string, darkCol: string,
    minH: number, maxH: number, minW: number, maxW: number
  ) {
    let bx = offX;
    let seed = 0;
    while (bx < CW + maxW) {
      const s  = Math.abs(Math.sin(seed * 1.7 + 3.1));
      const s2 = Math.abs(Math.sin(seed * 2.3 + 1.4));
      const w  = minW + s * (maxW - minW);
      const h  = minH + s2 * (maxH - minH);
      const groundY = CH - 85;

      // Main building body
      c.fillStyle = fillCol;
      c.fillRect(Math.round(bx), groundY - h, Math.round(w), h);

      // Broken/jagged top (pixel art chunks)
      c.fillStyle = darkCol;
      for (let tx = bx; tx < bx + w; tx += 8) {
        const crumbleH = Math.round(Math.abs(Math.sin(tx * 0.4 + seed)) * 28);
        c.fillRect(Math.round(tx), groundY - h - crumbleH, 8, crumbleH + 4);
      }

      // Windows (dark grid, some lit amber)
      for (let wy = groundY - h + 6; wy < groundY - 12; wy += 14) {
        for (let wx = bx + 4; wx < bx + w - 4; wx += 10) {
          const lit = Math.abs(Math.sin(wx * 0.5 + wy * 0.3 + seed)) > 0.75;
          c.fillStyle = lit ? 'rgba(255,180,60,0.18)' : 'rgba(0,0,0,0.5)';
          c.fillRect(Math.round(wx), wy, 6, 9);
        }
      }

      bx += w + 4 + s * 20;
      seed++;
    }
  }

  private drawRubbleLayer(c: CanvasRenderingContext2D, offX: number) {
    const groundY = CH - 85;
    c.fillStyle = '#151520';
    // Concrete chunks
    for (let i = 0; i < 12; i++) {
      const rx = ((offX + i * 90 + Math.sin(i * 1.3) * 30) % (CW + 100) + CW + 100) % (CW + 100) - 50;
      const rw = 20 + (i % 3) * 18;
      const rh = 10 + (i % 4) * 8;
      c.fillRect(Math.round(rx), groundY - rh, rw, rh);
    }
    // Broken metal beams (diagonal-ish, drawn as thin rects)
    c.fillStyle = '#1e1e30';
    for (let i = 0; i < 6; i++) {
      const rx = ((offX * 1.2 + i * 140) % (CW + 120) + CW + 120) % (CW + 120) - 60;
      c.save();
      c.translate(rx, groundY - 5);
      c.rotate(-0.2 + (i % 3) * 0.15);
      c.fillRect(0, 0, 70, 5);
      c.restore();
    }
  }

  // ── Stone brick ground ────────────────────────────────────────────────────

  private drawStoneBricks(c: CanvasRenderingContext2D) {
    if (this.terrain.length < 2) return;

    // Terrain fill
    c.fillStyle = '#101010';
    c.beginPath();
    c.moveTo(this.terrain[0].x, CH);
    for (const p of this.terrain) c.lineTo(p.x, p.y);
    c.lineTo(this.terrain[this.terrain.length - 1].x, CH);
    c.closePath(); c.fill();

    // Stone brick tiles
    const BW = 46, BH = 18;
    const scrollX = Math.floor(this.worldX * 0.5) % (BW * 2);
    const groundTopApprox = this.dekuGY;

    for (let row = 0; row <= Math.ceil((CH - groundTopApprox) / BH) + 2; row++) {
      const rowOff = row % 2 === 0 ? -scrollX : (-scrollX + BW);
      for (let col = -1; col <= Math.ceil(CW / BW) + 1; col++) {
        const bx = Math.round(col * BW - ((rowOff % (BW * 2)) + BW * 2) % (BW * 2));
        const by = Math.round(groundTopApprox + row * BH);
        if (by > CH) continue;
        c.fillStyle = '#252530';
        c.fillRect(bx + 1, by + 1, BW - 2, BH - 2);
        c.fillStyle = '#2e2e3a'; // highlight edge
        c.fillRect(bx + 1, by + 1, BW - 2, 2);
        c.fillStyle = '#18181e'; // shadow edge
        c.fillRect(bx + 1, by + BH - 3, BW - 2, 2);
      }
    }

    // Surface edge line
    c.strokeStyle = '#3a3a50'; c.lineWidth = 2;
    c.beginPath();
    c.moveTo(this.terrain[0].x, this.terrain[0].y);
    for (const p of this.terrain) c.lineTo(p.x, p.y);
    c.stroke();

    // Cracks
    c.strokeStyle = '#0a0a10'; c.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const crx = ((this.worldX * 0.3 + i * 130) % CW + CW) % CW;
      const cry = groundTopApprox + 6 + (i % 3) * 12;
      c.beginPath();
      c.moveTo(crx, cry);
      c.lineTo(crx + 12, cry + 7);
      c.lineTo(crx + 7,  cry + 16);
      c.stroke();
    }
  }

  // ── Particles ────────────────────────────────────────────────────────────

  private drawParticles(c: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      c.save();
      c.globalAlpha = Math.max(0, p.alpha);
      c.shadowColor = p.c; c.shadowBlur = 10;
      c.fillStyle = p.c;
      // Pixel-art square particles
      const sz = Math.ceil(p.r);
      c.fillRect(Math.round(p.x - sz / 2), Math.round(p.y - sz / 2), sz, sz);
      c.restore();
    }
  }

  // ── Two-pass sprite renderer (outlines then fills) ───────────────────────

  private renderSprite(
    c: CanvasRenderingContext2D,
    draws: [number, number, number, number, string][],
    bx: number, by: number, ps: number, flipW = 0
  ) {
    c.fillStyle = '#000';
    for (const [col, row, w, h] of draws) {
      const dc = flipW ? flipW - col - w : col;
      c.fillRect(bx + dc * ps - 1, by + row * ps - 1, w * ps + 2, h * ps + 2);
    }
    for (const [col, row, w, h, color] of draws) {
      const dc = flipW ? flipW - col - w : col;
      c.fillStyle = color;
      c.fillRect(bx + dc * ps, by + row * ps, w * ps, h * ps);
    }
  }

  // ── Deku pixel-art sprite ─────────────────────────────────────────────────

  private drawDekuSprite(c: CanvasRenderingContext2D, x: number, y: number) {
    const ps = PS;
    // Sprite 20 art-px wide; shoes bottom at row 35 → by = y - 35*ps
    const bx = Math.round(x - 10 * ps);
    const by = Math.round(y - 35 * ps);
    const draws: [number, number, number, number, string][] = [];
    const r = (col: number, row: number, w: number, h: number, color: string) => draws.push([col, row, w, h, color]);

    const runF = Math.floor(this.animT * 0.16) % 4; // 4-frame cycle
    const lSwing = [2, 1, -2, -1][runF];             // left-leg forward offset
    const hitFlash = this.playerHitTimer > 0 && Math.floor(this.playerHitTimer / 5) % 2 === 0;

    // ── HAIR ──
    // Far spiky tips
    r(5,  -4, 2, 3, '#1b5e20');
    r(9,  -4, 2, 3, '#2e7d32');
    r(13, -4, 2, 3, '#1b5e20');
    r(3,  -3, 3, 2, '#1b5e20');
    r(15, -3, 2, 2, '#1b5e20');
    // Main hair mass
    r(1,  -2, 18, 1, '#1b5e20');
    r(0,  -1, 20, 4, '#1b5e20');
    r(2,  -1, 16, 4, '#2e7d32');
    r(5,  -1,  2, 2, '#4caf50');  // highlight streaks
    r(10, -1,  3, 2, '#388e3c');
    r(15,  0,  2, 1, '#4caf50');
    // Side hair hanging past face
    r(0,   3,  3, 5, '#1b5e20');
    r(17,  3,  3, 5, '#1b5e20');
    r(1,   4,  2, 3, '#2e7d32');
    r(17,  4,  2, 3, '#2e7d32');

    // ── FACE ──
    r(2,   3, 16,  9, '#fde68a');  // skin
    r(3,  11,  14, 1, '#d4a020');  // chin line
    // Side shadows
    r(2,   3,  1,  8, '#e0c050');
    r(17,  3,  1,  8, '#e0c050');

    // Eyebrows (dark green — Deku's stern brow)
    r(3,  4,  5, 1, '#1b5e20');
    r(12, 4,  5, 1, '#1b5e20');

    // LEFT EYE (5×5 art-px, large anime style)
    r(3,  5,  5, 6, '#ffffff');    // whites
    r(4,  6,  3, 4, '#1565c0');    // iris blue
    r(5,  7,  1, 2, '#0a2a70');    // pupil
    r(3,  5,  2, 1, '#c0daff');    // top shine
    r(3,  5,  1, 2, '#ddeeff');    // left shine
    r(3, 10,  5, 1, '#111111');    // lower lash
    r(3,  4,  5, 2, '#111111');    // upper lash / lid

    // RIGHT EYE
    r(12, 5,  5, 6, '#ffffff');
    r(13, 6,  3, 4, '#1565c0');
    r(14, 7,  1, 2, '#0a2a70');
    r(12, 5,  2, 1, '#c0daff');
    r(12, 5,  1, 2, '#ddeeff');
    r(12,10,  5, 1, '#111111');
    r(12, 4,  5, 2, '#111111');

    // Nose
    r(9,  10, 2, 1, '#d0a020');
    // Freckles (Deku's iconic 3-dot cheek freckles)
    r(3,  10, 1, 1, '#e09838'); r(5,  10, 1, 1, '#e09838'); r(7,  10, 1, 1, '#e09838');
    r(13, 10, 1, 1, '#e09838'); r(15, 10, 1, 1, '#e09838'); r(17, 10, 1, 1, '#e09838');

    // ── NECK ──
    r(7,  12, 5, 2, '#fde68a');

    // ── TORSO (green hero suit) ──
    r(3,  14, 14, 10, '#2e7d32');
    r(3,  14,  1,  9, '#1b5e20');   // left shade
    r(16, 14,  1,  9, '#1b5e20');   // right shade
    r(3,  23, 14,  1, '#0f2010');   // belt top
    // White reinforcement cross (One For All symbol)
    r(9,  15,  2,  8, '#f8f8f8');   // vertical
    r(5,  19,  10, 2, '#f8f8f8');   // horizontal
    // Belt
    r(3,  23, 14,  2, '#111a11');
    r(8,  23,  4,  2, '#888800');   // buckle

    // ── LEFT ARM (back, bent slightly back) ──
    r(-4, 14,  5,  8, '#2e7d32');
    r(-4, 21,  5,  2, '#d4c898');   // bandage wrap
    r(-4, 22,  5,  1, '#b8a870');
    r(-4, 23,  5,  1, '#d4c898');
    // Left fist (white glove)
    r(-5, 24,  7,  4, '#e8e8e0');
    r(-5, 27,  7,  1, '#c8c8b8');

    // ── RIGHT ARM (front, extended) ──
    r(19, 13,  5,  8, '#2e7d32');
    r(19, 20,  5,  2, '#d4c898');
    r(19, 21,  5,  1, '#b8a870');
    r(19, 22,  5,  1, '#d4c898');
    // Right fist (reaching forward)
    r(19, 23,  7,  4, '#e8e8e0');
    r(19, 26,  7,  1, '#c8c8b8');

    // ── LEGS ──
    r(5,  25, 9,  2, '#1b5e20');    // hip connector

    // Left thigh + shin (swing forward)
    r(3  + lSwing, 27, 5, 5, '#1b5e20');
    r(4  + lSwing, 31, 4, 3, '#145214');
    // Left shoe
    r(2  + lSwing, 33, 6, 1, '#c62828');
    r(1  + lSwing, 34, 7, 1, '#8b0000');

    // Right thigh + shin (swing back)
    r(12 - lSwing, 27, 5, 5, '#1b5e20');
    r(12 - lSwing, 31, 4, 3, '#145214');
    // Right shoe
    r(11 - lSwing, 33, 6, 1, '#c62828');
    r(10 - lSwing, 34, 7, 1, '#8b0000');

    // ── RENDER ──
    if (hitFlash) { c.save(); c.globalAlpha = 0.25; }

    // Green lightning aura BEFORE rendering sprite (behind character)
    if (this.boosting) {
      c.save();
      c.strokeStyle = '#00e5ff'; c.lineWidth = 2; c.shadowColor = '#00e5ff'; c.shadowBlur = 14;
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2 + this.animT * 0.3;
        const dist = 28 + Math.random() * 20;
        const sx = x + Math.cos(angle) * 18, sy = y - 50 + Math.sin(angle) * 28;
        const ex = sx + Math.cos(angle) * dist, ey = sy + Math.sin(angle) * dist;
        const mx = (sx + ex) / 2 + (Math.random() - 0.5) * 18;
        const my = (sy + ey) / 2 + (Math.random() - 0.5) * 18;
        c.beginPath(); c.moveTo(sx, sy); c.lineTo(mx, my); c.lineTo(ex, ey); c.stroke();
      }
      c.restore();
    }

    this.renderSprite(c, draws, bx, by, ps);

    // Speed lines behind Deku when boosting
    if (this.boosting) {
      c.save(); c.strokeStyle = 'rgba(0,229,255,0.6)'; c.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const ly = by + (8 + i * 9) * ps;
        const len = 30 + Math.random() * 55;
        c.beginPath(); c.moveTo(bx - 4, ly); c.lineTo(bx - 4 - len, ly); c.stroke();
      }
      c.restore();
    }

    if (hitFlash) c.restore();
  }

  // ── Shigaraki pixel-art sprite ────────────────────────────────────────────

  private drawShigarakiSprite(c: CanvasRenderingContext2D, x: number, y: number, flipLeft = false) {
    const ps = PS;
    // Sprite 20 art-px wide; anchor = feet (x, y); shoes bottom at row 36 → by = y - 36*ps
    const bx = Math.round(x - 10 * ps);
    const by = Math.round(y - 36 * ps);
    const SW = 20; // sprite width for flip calculation
    const draws: [number, number, number, number, string][] = [];
    const r = (col: number, row: number, w: number, h: number, color: string) => draws.push([col, row, w, h, color]);

    const stagger = this.bossState === 'stagger';
    const attack  = this.bossState === 'attack';
    const runF    = Math.floor(this.animT * 0.15) % 4;
    const lSwing  = [2, 1, -2, -1][runF];

    // ── HAIR (white/silver, wild spiky) ──
    // Multiple spike clusters going in different directions
    r(2,  -5, 3, 4, '#90a4ae');    // far-left spike
    r(6,  -5, 2, 3, '#b0bec5');    // left-center spike
    r(9,  -6, 3, 4, '#cfd8dc');    // top center spike (tallest)
    r(13, -5, 3, 3, '#b0bec5');    // right-center spike
    r(17, -4, 2, 3, '#90a4ae');    // far-right spike
    r(0,  -3, 4, 2, '#78909c');    // left drape spike
    r(16, -3, 4, 2, '#78909c');    // right drape spike
    // Main hair mass
    r(0,  -2, 20, 1, '#90a4ae');
    r(0,  -1, 20, 4, '#b0bec5');
    r(2,  -1, 16, 4, '#cfd8dc');
    r(6,   0,  8, 2, '#eceff1');   // bright highlight center
    r(10,  1,  4, 1, '#ffffff');   // brightest highlight
    // Side drapes past face
    r(0,   3,  3, 6, '#90a4ae');
    r(17,  3,  3, 6, '#90a4ae');
    r(1,   4,  2, 4, '#78909c');
    r(17,  4,  2, 4, '#78909c');

    // ── FACE (pale ashen skin) ──
    r(2,   3, 16,  9, '#d7ccc8');
    r(2,   3,  1,  8, '#bcaaa4');   // left shadow
    r(17,  3,  1,  8, '#bcaaa4');   // right shadow
    r(3,  11, 14,  1, '#a09090');   // chin

    // No eyebrows (villain aesthetic — heavy orbital ridge instead)
    r(3,  4,  5, 2, '#b0a0a0');
    r(12, 4,  5, 2, '#b0a0a0');

    // LEFT EYE (red sinister, squinting)
    r(3,  5,  5, 6, '#ffffff');
    r(4,  6,  3, 4, '#b71c1c');    // red iris
    r(5,  7,  1, 2, '#7f0000');    // dark pupil
    r(3,  5,  1, 1, '#ff8888');    // evil top shine
    r(3, 10,  5, 1, '#111111');
    r(3,  4,  5, 2, '#111111');    // heavy brow

    // RIGHT EYE
    r(12, 5,  5, 6, '#ffffff');
    r(13, 6,  3, 4, '#b71c1c');
    r(14, 7,  1, 2, '#7f0000');
    r(12, 5,  1, 1, '#ff8888');
    r(12,10,  5, 1, '#111111');
    r(12, 4,  5, 2, '#111111');

    // Scar lines under eyes (Shigaraki's markings from the quirk)
    r(3,  10, 1, 2, '#9c7878'); r(5,  10, 1, 2, '#9c7878'); r(7,  10, 1, 2, '#9c7878');
    r(13, 10, 1, 2, '#9c7878'); r(15, 10, 1, 2, '#9c7878'); r(17, 10, 1, 2, '#9c7878');
    // Nose
    r(9,  10, 2, 1, '#b09090');

    // ── NECK ──
    r(7,  12, 6, 2, '#d7ccc8');

    // ── DARK NAVY COAT ──
    r(2,  14, 16, 11, '#1a237e');
    r(2,  14,  1, 10, '#111870');   // left shadow
    r(17, 14,  1, 10, '#111870');   // right shadow
    // Hood/collar detail
    r(6,  14,  8,  3, '#283593');
    r(8,  14,  4,  5, '#1a237e');
    // Coat centre seam
    r(9,  16,  2,  8, '#0d1570');
    // Coat bottom (tattered edge — jagged)
    r(2,  24,  2,  2, '#0d1b6e');
    r(5,  25,  3,  1, '#0d1b6e');
    r(9,  24,  2,  2, '#0d1b6e');
    r(13, 25,  3,  1, '#0d1b6e');
    r(16, 24,  2,  2, '#0d1b6e');

    // ── ARMS ──
    // Back arm (left of sprite)
    r(-5, 14,  6,  9, '#1a237e');
    r(-5, 21,  6,  1, '#141060');
    // Back hand (decayed dark)
    r(-6, 22,  8,  5, '#0d0d0d');
    r(-6, 22,  8,  1, '#7c3aed');   // decay glow stripe

    // Front arm (raised if attacking)
    const frontRow = attack ? 10 : 14;
    r(19, frontRow, 6, 10 + (14 - frontRow), '#1a237e');
    r(19, frontRow + 9, 6, 1, '#141060');
    // Front hand
    r(19, frontRow + 10, 8, 5, '#0d0d0d');
    r(19, frontRow + 10, 8, 1, '#7c3aed');

    // ── LEGS ──
    r(6,  26,  8,  2, '#111870');   // hip

    // Left leg
    r(3  + lSwing, 28, 5, 5, '#141870');
    r(4  + lSwing, 32, 4, 3, '#0e1060');
    r(3  + lSwing, 34, 6, 1, '#0a0a20');
    r(2  + lSwing, 35, 7, 1, '#060610');

    // Right leg
    r(12 - lSwing, 28, 5, 5, '#141870');
    r(12 - lSwing, 32, 4, 3, '#0e1060');
    r(11 - lSwing, 34, 6, 1, '#0a0a20');
    r(10 - lSwing, 35, 7, 1, '#060610');

    // ── RENDER ──
    if (stagger) { c.save(); c.globalAlpha = 0.6; }

    // Purple decay aura (drawn before sprite so it appears behind)
    c.save(); c.globalAlpha = 0.28; c.shadowColor = '#7c3aed'; c.shadowBlur = 18;
    c.fillStyle = '#7c3aed';
    const backHX  = flipLeft ? bx + 19 * ps : bx - 6 * ps;
    const frontHX = flipLeft ? bx - 6 * ps  : bx + 19 * ps;
    const frontHY = by + (frontRow + 10) * ps;
    c.fillRect(backHX,  by + 22 * ps, 8 * ps, 5 * ps);
    c.fillRect(frontHX, frontHY,      8 * ps, 5 * ps);
    c.restore();

    // Attack charge glow
    if (attack) {
      c.save(); c.globalAlpha = 0.45; c.shadowColor = '#7c3aed'; c.shadowBlur = 30;
      c.fillStyle = '#7c3aed';
      const ahx = flipLeft ? bx - 6 * ps : bx + 19 * ps;
      c.beginPath(); c.arc(ahx + 4 * ps, frontHY - 4, 22, 0, Math.PI * 2); c.fill();
      c.restore();
    }

    this.renderSprite(c, draws, bx, by, ps, flipLeft ? SW : 0);

    // Stagger X effect
    if (stagger) {
      c.restore();
      c.save(); c.strokeStyle = '#4ade80'; c.lineWidth = 3; c.globalAlpha = 0.9;
      c.beginPath(); c.moveTo(x - 30, y - 80); c.lineTo(x + 25, y - 20); c.stroke();
      c.beginPath(); c.moveTo(x + 25, y - 80); c.lineTo(x - 30, y - 20); c.stroke();
      c.restore();
    }
  }

  // ── HUD ───────────────────────────────────────────────────────────────────

  private drawHUD(c: CanvasRenderingContext2D) {
    if (this.phase === 'run') this.drawRunHUD(c);
    else if (this.phase === 'boss') this.drawBossHUD(c);
  }

  private drawRunHUD(c: CanvasRenderingContext2D) {
    // ── Deku panel (top-left) ──
    c.fillStyle = 'rgba(0,0,0,0.82)';
    c.fillRect(6, 6, 220, 64);
    c.strokeStyle = '#4ade80'; c.lineWidth = 2;
    c.strokeRect(6, 6, 220, 64);

    // Portrait background
    c.fillStyle = '#1b5e20'; c.fillRect(10, 10, 48, 56);
    this.drawDekuPortrait(c, 10, 10);

    // Name
    c.fillStyle = '#fde68a'; c.font = 'bold 11px monospace'; c.textAlign = 'left';
    c.fillText('IZUKU MIDORIYA', 64, 24);

    // HP bar
    c.fillStyle = '#111'; c.fillRect(64, 28, 155, 12);
    const hpFill = (this.playerHP / 3) * 155;
    const hpGrad = c.createLinearGradient(64, 0, 219, 0);
    hpGrad.addColorStop(0, '#4ade80'); hpGrad.addColorStop(1, '#22c55e');
    c.fillStyle = hpGrad; c.fillRect(64, 28, hpFill, 12);
    c.strokeStyle = '#4ade80'; c.lineWidth = 1; c.strokeRect(64, 28, 155, 12);

    // Lives
    c.fillStyle = '#fff'; c.font = 'bold 12px monospace';
    c.fillText(`✕ ${String(this.playerHP).padStart(2, '0')}`, 64, 56);

    // Boost %
    const boostPct = this.boosting
      ? Math.ceil((this.boostFrames / BOOST_DURATION) * 100)
      : this.boostReady ? 100
      : Math.ceil((1 - this.boostCooldown / BOOST_COOLDOWN) * 100);
    c.fillStyle = this.boosting ? '#00e5ff' : this.boostReady ? '#4ade80' : '#888';
    c.shadowColor = this.boosting ? '#00e5ff' : 'transparent'; c.shadowBlur = this.boosting ? 10 : 0;
    c.fillText(`⚡ ${boostPct}%`, 110, 56);
    c.shadowBlur = 0;

    // ── Distance bar (top-center) ──
    const bw = 280, bh = 20, bx2 = CW / 2 - bw / 2, by2 = 8;
    c.fillStyle = 'rgba(0,0,0,0.75)'; c.fillRect(bx2, by2, bw, bh);
    const prog = c.createLinearGradient(bx2, 0, bx2 + bw, 0);
    prog.addColorStop(0, '#4ade80'); prog.addColorStop(1, '#22c55e');
    c.fillStyle = prog;
    c.fillRect(bx2, by2, Math.max(0, (this.km / TOTAL_KM) * bw), bh);
    c.strokeStyle = '#4ade80'; c.lineWidth = 1; c.strokeRect(bx2, by2, bw, bh);
    c.fillStyle = '#fff'; c.font = 'bold 11px monospace'; c.textAlign = 'center';
    c.fillText(`${this.km.toFixed(1)} / ${TOTAL_KM} km`, CW / 2, by2 + 14);

    // ── Shigaraki panel (top-right) ──
    c.fillStyle = 'rgba(0,0,0,0.82)'; c.fillRect(CW - 226, 6, 220, 64);
    c.strokeStyle = '#c62828'; c.lineWidth = 2; c.strokeRect(CW - 226, 6, 220, 64);
    this.drawShigarakiPortrait(c, CW - 58, 10);

    c.fillStyle = '#fde68a'; c.font = 'bold 11px monospace'; c.textAlign = 'right';
    c.fillText('TOMURA SHIGARAKI', CW - 64, 24);

    const shigHPBar = 220 - 64 - 10;
    c.fillStyle = '#111'; c.fillRect(CW - 226 + 10, 28, shigHPBar, 12);
    const shigFill = ((this.shigX - this.dekuX) < PUNCH_RANGE && this.boosting) ? shigHPBar * 0.6 : shigHPBar;
    const shigGrad = c.createLinearGradient(CW - 216, 0, CW - 216 + shigHPBar, 0);
    shigGrad.addColorStop(0, '#ef4444'); shigGrad.addColorStop(1, '#b91c1c');
    c.fillStyle = shigGrad; c.fillRect(CW - 216, 28, shigFill, 12);
    c.strokeStyle = '#c62828'; c.lineWidth = 1; c.strokeRect(CW - 216, 28, shigHPBar, 12);

    // Biome label
    c.fillStyle = 'rgba(0,0,0,0.7)'; c.fillRect(CW / 2 - 80, 32, 160, 22);
    c.fillStyle = '#ccc'; c.font = 'bold 11px monospace'; c.textAlign = 'center';
    c.fillText(this.currentBiome.label, CW / 2, 47);

    // Controls hint
    c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(6, CH - 28, 340, 22);
    c.fillStyle = '#777'; c.font = '10px monospace'; c.textAlign = 'left';
    c.fillText('SPACE: jump  SHIFT: boost  Z: punch (during boost)', 10, CH - 12);
  }

  private drawBossHUD(c: CanvasRenderingContext2D) {
    // Deku panel
    c.fillStyle = 'rgba(0,0,0,0.85)'; c.fillRect(6, 6, 220, 64);
    c.strokeStyle = '#4ade80'; c.lineWidth = 2; c.strokeRect(6, 6, 220, 64);
    this.drawDekuPortrait(c, 10, 10);
    c.fillStyle = '#fde68a'; c.font = 'bold 11px monospace'; c.textAlign = 'left';
    c.fillText('IZUKU MIDORIYA', 64, 24);

    c.fillStyle = '#111'; c.fillRect(64, 28, 155, 12);
    const hpGrad = c.createLinearGradient(64, 0, 219, 0);
    hpGrad.addColorStop(0, '#4ade80'); hpGrad.addColorStop(1, '#22c55e');
    c.fillStyle = hpGrad; c.fillRect(64, 28, (this.playerHP / 3) * 155, 12);
    c.strokeStyle = '#4ade80'; c.lineWidth = 1; c.strokeRect(64, 28, 155, 12);
    for (let i = 0; i < 3; i++) {
      c.fillStyle = i < this.playerHP ? '#4ade80' : '#374151';
      c.fillRect(64 + i * 18, 44, 14, 14);
      c.strokeStyle = '#4ade80'; c.strokeRect(64 + i * 18, 44, 14, 14);
    }
    c.fillStyle = '#fff'; c.font = 'bold 11px monospace';
    c.fillText('✕ ' + String(this.playerHP).padStart(2,'0'), 126, 56);

    // Shigaraki panel
    c.fillStyle = 'rgba(0,0,0,0.85)'; c.fillRect(CW - 226, 6, 220, 64);
    c.strokeStyle = '#c62828'; c.lineWidth = 2; c.strokeRect(CW - 226, 6, 220, 64);
    this.drawShigarakiPortrait(c, CW - 58, 10);
    c.fillStyle = '#fde68a'; c.font = 'bold 11px monospace'; c.textAlign = 'right';
    c.fillText('TOMURA SHIGARAKI', CW - 64, 24);

    const bossW = 155;
    c.fillStyle = '#111'; c.fillRect(CW - 216, 28, bossW, 12);
    const bossGrad = c.createLinearGradient(CW - 216, 0, CW - 216 + bossW, 0);
    bossGrad.addColorStop(0, '#ef4444'); bossGrad.addColorStop(1, '#b91c1c');
    c.fillStyle = bossGrad; c.fillRect(CW - 216, 28, bossW * ((BOSS_PUNCHES - this.bossHits) / BOSS_PUNCHES), 12);
    c.strokeStyle = '#c62828'; c.lineWidth = 1; c.strokeRect(CW - 216, 28, bossW, 12);
    for (let i = 0; i < BOSS_PUNCHES; i++) {
      c.fillStyle = i < (BOSS_PUNCHES - this.bossHits) ? '#ef4444' : '#374151';
      c.fillRect(CW - 216 + i * 18, 44, 14, 14);
      c.strokeStyle = '#c62828'; c.strokeRect(CW - 216 + i * 18, 44, 14, 14);
    }

    // Boss instruction
    c.fillStyle = 'rgba(0,0,0,0.75)'; c.fillRect(CW / 2 - 160, CH - 36, 320, 28);
    c.strokeStyle = '#4ade80'; c.lineWidth = 1; c.strokeRect(CW / 2 - 160, CH - 36, 320, 28);
    c.fillStyle = '#4ade80'; c.font = 'bold 13px monospace'; c.textAlign = 'center';
    c.fillText('[ Z ] PUNCH  ·  Land 3 hits to win!', CW / 2, CH - 17);

    // Attack warning flash
    if (this.bossState === 'attack') {
      c.fillStyle = 'rgba(124,58,237,0.28)'; c.fillRect(0, 0, CW, CH);
      c.shadowColor = '#7c3aed'; c.shadowBlur = 30;
      c.fillStyle = '#ffffff'; c.font = 'bold 28px monospace'; c.textAlign = 'center';
      c.fillText('DECAY ATTACK!', CW / 2, CH / 2 - 10);
      c.shadowBlur = 0;
    }

    // Stagger hit confirm
    if (this.bossState === 'stagger') {
      c.shadowColor = '#4ade80'; c.shadowBlur = 20;
      c.fillStyle = '#4ade80'; c.font = 'bold 24px monospace'; c.textAlign = 'center';
      c.fillText('HIT!', CW / 2, CH / 2 - 10);
      c.shadowBlur = 0;
    }
  }

  // ── Character portrait thumbnails ─────────────────────────────────────────

  private drawDekuPortrait(c: CanvasRenderingContext2D, px: number, py: number) {
    const p = 2; // portrait pixel size
    const r = (col: number, row: number, w: number, h: number, color: string) => {
      c.fillStyle = color; c.fillRect(px + col * p, py + row * p, w * p, h * p);
    };
    // Hair
    r(2,  0, 16,  3, '#1b5e20');
    r(4,  2, 12,  4, '#2e7d32');
    // Face
    r(4,  6, 12,  8, '#fde68a');
    // Eyes
    r(5,  7,  3,  4, '#ffffff'); r(6,  8,  1,  2, '#1565c0');
    r(12, 7,  3,  4, '#ffffff'); r(13, 8,  1,  2, '#1565c0');
    // Suit
    r(3, 14, 14,  8, '#2e7d32');
    r(9, 15,  2,  6, '#ffffff'); r(5, 18,  10, 2, '#ffffff');
  }

  private drawShigarakiPortrait(c: CanvasRenderingContext2D, px: number, py: number) {
    const p = 2;
    const r = (col: number, row: number, w: number, h: number, color: string) => {
      c.fillStyle = color; c.fillRect(px + col * p, py + row * p, w * p, h * p);
    };
    // Hair
    r(1,  0, 18,  3, '#b0bec5');
    r(3,  2, 14,  4, '#cfd8dc');
    // Face
    r(3,  6, 14,  8, '#c5b8b0');
    // Eyes
    r(4,  7,  3,  4, '#ffffff'); r(5,  8,  1,  2, '#b71c1c');
    r(13, 7,  3,  4, '#ffffff'); r(14, 8,  1,  2, '#b71c1c');
    // Coat
    r(2, 14, 16,  8, '#1a237e');
  }

  // ── Title / End screens ───────────────────────────────────────────────────

  private drawStart(c: CanvasRenderingContext2D) {
    // Dark sky
    const sky = c.createLinearGradient(0, 0, 0, CH);
    sky.addColorStop(0, '#060610'); sky.addColorStop(1, '#0e0e20');
    c.fillStyle = sky; c.fillRect(0, 0, CW, CH);

    // Background silhouette buildings
    this.drawBuildingLayer(c, 0,   '#0e0e1e', '#080814', 80, 240, 40, 80);
    this.drawBuildingLayer(c, 200, '#0e0e1e', '#080814', 80, 240, 40, 80);

    // Ground bricks (static)
    const BW = 46, BH = 18;
    for (let row = 0; row <= 3; row++) {
      for (let col = -1; col <= Math.ceil(CW / BW) + 1; col++) {
        const bxp = col * BW + (row % 2) * (BW / 2);
        const byp = CH - 80 + row * BH;
        c.fillStyle = '#252530'; c.fillRect(bxp + 1, byp + 1, BW - 2, BH - 2);
        c.fillStyle = '#2e2e3a'; c.fillRect(bxp + 1, byp + 1, BW - 2, 2);
      }
    }

    // Characters on the start screen
    this.drawDekuSprite(c, 250, CH - 80);
    this.drawShigarakiSprite(c, 550, CH - 80);

    // Title panel
    c.fillStyle = 'rgba(0,0,0,0.85)';
    c.fillRect(CW / 2 - 270, 30, 540, 200);
    c.strokeStyle = '#4ade80'; c.lineWidth = 3;
    c.strokeRect(CW / 2 - 270, 30, 540, 200);

    c.shadowColor = '#4ade80'; c.shadowBlur = 25;
    c.fillStyle = '#4ade80'; c.font = 'bold 38px monospace'; c.textAlign = 'center';
    c.fillText('DEKU: JAPAN RUN', CW / 2, 90);
    c.shadowBlur = 0;

    c.fillStyle = '#b0bec5'; c.font = '13px monospace';
    c.fillText('Chase Shigaraki across 1000 km of Japan!', CW / 2, 125);

    c.fillStyle = '#fde68a'; c.font = '12px monospace';
    c.fillText('SPACE: jump  |  SHIFT: speed boost  |  Z: punch', CW / 2, 155);
    c.fillText('Reach 1000 km  →  Boss Fight  →  Land 3 punches!', CW / 2, 178);

    const blink = Math.floor(Date.now() / 500) % 2 === 0;
    if (blink) {
      c.shadowColor = '#4ade80'; c.shadowBlur = 12;
      c.fillStyle = '#4ade80'; c.font = 'bold 16px monospace';
      c.fillText('▶  PRESS  SPACE  TO  START', CW / 2, 215);
      c.shadowBlur = 0;
    }
  }

  private drawEndScreen(c: CanvasRenderingContext2D, win: boolean) {
    const sky = c.createLinearGradient(0, 0, 0, CH);
    sky.addColorStop(0, win ? '#061206' : '#120006');
    sky.addColorStop(1, win ? '#0a200a' : '#200010');
    c.fillStyle = sky; c.fillRect(0, 0, CW, CH);
    this.drawBuildingLayer(c, 0, '#0e0e1e', '#080814', 80, 240, 40, 80);

    c.fillStyle = 'rgba(0,0,0,0.88)';
    c.fillRect(CW / 2 - 240, CH / 2 - 100, 480, 200);
    c.strokeStyle = win ? '#4ade80' : '#7c3aed'; c.lineWidth = 3;
    c.strokeRect(CW / 2 - 240, CH / 2 - 100, 480, 200);

    c.shadowColor = win ? '#4ade80' : '#f87171'; c.shadowBlur = 30;
    c.fillStyle = win ? '#4ade80' : '#f87171'; c.font = 'bold 42px monospace'; c.textAlign = 'center';
    c.fillText(win ? 'PLUS ULTRA!' : 'KNOCKED OUT', CW / 2, CH / 2 - 40);
    c.shadowBlur = 0;

    c.fillStyle = '#ffffff'; c.font = '18px monospace';
    c.fillText(win ? 'Shigaraki has been defeated!' : 'Decay was too powerful...', CW / 2, CH / 2 + 5);
    c.fillStyle = '#b0bec5'; c.font = '13px monospace';
    c.fillText(win ? 'You ran 1000 km across Japan!' : 'Train harder and try again!', CW / 2, CH / 2 + 35);

    const blink = Math.floor(Date.now() / 550) % 2 === 0;
    if (blink) {
      c.fillStyle = win ? '#4ade80' : '#f87171'; c.font = 'bold 14px monospace';
      c.fillText('SPACE  /  ENTER  to play again', CW / 2, CH / 2 + 78);
    }
  }
}
