import {
  Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, HostListener
} from '@angular/core';

// ── Constants ──────────────────────────────────────────────────────────────────
const CW = 800, CH = 420;
const GY = 350;           // ground surface y
const PX = 130;           // player fixed x
const GRAV = 0.65;
const JUMP_V = -15.5;
const ZONE_LEN = 3200;    // distance units per zone

// ── Zone definitions ───────────────────────────────────────────────────────────
interface ZoneDef {
  name: string; icon: string;
  skyA: string; skyB: string;
  groundTop: string; groundFill: string;
  fogColor: string; fogOpacity: number;
  obstacleTypes: string[];
  collectType: string; collectColor: string; collectPts: number;
}
const ZONES: ZoneDef[] = [
  { name: 'Countryside',   icon: '🌾',
    skyA: '#5BBCF8', skyB: '#C8EFA0',
    groundTop: '#6DC840', groundFill: '#4A8C22',
    fogColor: '#A8D870', fogOpacity: 0.18,
    obstacleTypes: ['fence','hay_bale','cow','sunflower'],
    collectType: 'cheese', collectColor: '#FFD040', collectPts: 100 },
  { name: 'The Alps',      icon: '🏔️',
    skyA: '#3858A8', skyB: '#B8CCE8',
    groundTop: '#DDEEFF', groundFill: '#A8BCD0',
    fogColor: '#E8F0FF', fogOpacity: 0.3,
    obstacleTypes: ['boulder','snowdrift','pine','ski_arch'],
    collectType: 'edelweiss', collectColor: '#FFFFFF', collectPts: 150 },
  { name: 'Lake Zürich',   icon: '⛵',
    skyA: '#1858C8', skyB: '#78C0F0',
    groundTop: '#1D6BAA', groundFill: '#0E3D78',
    fogColor: '#80C8E8', fogOpacity: 0.22,
    obstacleTypes: ['wave','pier_post','sail','duck'],
    collectType: 'fish', collectColor: '#60D0FF', collectPts: 120 },
  { name: 'Zürich City',   icon: '🏛️',
    skyA: '#5A6878', skyB: '#A8BCC8',
    groundTop: '#787878', groundFill: '#484848',
    fogColor: '#90A0B0', fogOpacity: 0.15,
    obstacleTypes: ['tram','bike','barrier','lamppost'],
    collectType: 'franc', collectColor: '#D4AF37', collectPts: 200 },
  { name: 'Swiss Forest',  icon: '🌲',
    skyA: '#1A4C20', skyB: '#4A8050',
    groundTop: '#2A6015', groundFill: '#16380A',
    fogColor: '#3A6830', fogOpacity: 0.25,
    obstacleTypes: ['log','mushroom','deer','branch'],
    collectType: 'berry', collectColor: '#D83060', collectPts: 80 },
];

// ── Types ──────────────────────────────────────────────────────────────────────
interface Runner {
  y: number; vy: number; jumpCount: number;
  ducking: boolean; duckHeld: boolean;
  animT: number; dead: boolean;
}
interface Obstacle {
  x: number; y: number; w: number; h: number;
  type: string; animT: number; vx: number;
  tall: boolean; // true = duck under; false = jump over
}
interface Collectible { x: number; y: number; taken: boolean; animT: number; }
interface BgEntity   { x: number; type: string; z: number; }  // z = parallax depth
interface Particle   { x: number; y: number; vx: number; vy: number; alpha: number; color: string; r: number; }
interface ZoneBanner { text: string; alpha: number; }
interface FloatText  { x: number; y: number; text: string; alpha: number; vy: number; }

// ── Component ──────────────────────────────────────────────────────────────────
@Component({
  selector: 'app-swiss-run',
  standalone: true, imports: [],
  templateUrl: './swiss-run.component.html',
  styleUrl:    './swiss-run.component.css'
})
export class SwissRunComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  state: 'start'|'playing'|'dead' = 'start';
  score = 0; best = 0; collectibles = 0;

  private ctx!: CanvasRenderingContext2D;
  private raf = 0;
  private keys = new Set<string>();
  private lastTs = 0;
  private jumpHeld = false;

  private runner!: Runner;
  private obstacles!: Obstacle[];
  private collectList!: Collectible[];
  private bgEntities!: BgEntity[];
  private particles!: Particle[];
  private floatTexts!: FloatText[];
  private zoneBanner: ZoneBanner = { text: '', alpha: 0 };

  private spd    = 5;
  private dist   = 0;
  private bgScroll = 0;
  private nextObs  = 200;
  private nextColl = 250;
  private zoneIdx  = 0;
  private prevZone = -1;
  private frameN   = 0;

  get zone(): ZoneDef { return ZONES[this.zoneIdx]; }

  @HostListener('window:keydown', ['$event'])
  onKD(e: KeyboardEvent) {
    this.keys.add(e.code);
    if (['Space','ArrowUp','ArrowDown','KeyW','KeyS'].includes(e.code)) e.preventDefault();
    if (this.state !== 'playing') {
      if (['Space','ArrowUp','KeyW','Enter'].includes(e.code)) this.startGame();
    }
  }
  @HostListener('window:keyup', ['$event'])
  onKU(e: KeyboardEvent) { this.keys.delete(e.code); }

  ngAfterViewInit() {
    const c = this.canvasRef.nativeElement;
    c.width = CW; c.height = CH;
    this.ctx = c.getContext('2d')!;
    this.raf = requestAnimationFrame(t => this.loop(t));
  }
  ngOnDestroy() { cancelAnimationFrame(this.raf); }

  startGame() {
    this.dist = this.score = this.collectibles = 0;
    this.spd = 5; this.bgScroll = 0;
    this.nextObs = 220; this.nextColl = 280;
    this.zoneIdx = 0; this.prevZone = -1; this.frameN = 0;
    this.runner = { y: GY - 56, vy: 0, jumpCount: 0, ducking: false, duckHeld: false, animT: 0, dead: false };
    this.obstacles = []; this.collectList = [];
    this.particles = []; this.floatTexts = [];
    this.zoneBanner = { text: '', alpha: 0 };
    this.bgEntities = this.buildBgEntities();
    this.state = 'playing';
    this.lastTs = performance.now();
    if (!this.raf) this.raf = requestAnimationFrame(t => this.loop(t));
  }

  private buildBgEntities(): BgEntity[] {
    const list: BgEntity[] = [];
    for (let x = 0; x < CW + 400; x += 120 + Math.random() * 80)
      list.push({ x, type: 'bg_' + this.zoneIdx, z: 0.25 });
    for (let x = 0; x < CW + 200; x += 200 + Math.random() * 120)
      list.push({ x, type: 'mid_' + this.zoneIdx, z: 0.55 });
    return list;
  }

  // ── Main loop ────────────────────────────────────────────────────────────────
  private loop(ts: number) {
    this.raf = requestAnimationFrame(t => this.loop(t));
    const dt = Math.min((ts - this.lastTs) / 16.67, 3);
    this.lastTs = ts;
    this.frameN++;
    if (this.state === 'playing') this.update(dt);
    this.draw();
  }

  // ── Update ───────────────────────────────────────────────────────────────────
  private update(dt: number) {
    const r = this.runner;

    // Zone index
    this.zoneIdx = Math.min(Math.floor(this.dist / ZONE_LEN), ZONES.length - 1);
    if (this.zoneIdx !== this.prevZone) {
      this.prevZone = this.zoneIdx;
      this.zoneBanner = { text: ZONES[this.zoneIdx].icon + '  ' + ZONES[this.zoneIdx].name, alpha: 1 };
      this.bgEntities = this.buildBgEntities();
    }
    if (this.zoneBanner.alpha > 0) this.zoneBanner.alpha -= 0.008 * dt;

    // Input — jump
    const wantJump = this.keys.has('Space') || this.keys.has('ArrowUp') || this.keys.has('KeyW');
    if (wantJump && !this.jumpHeld && r.jumpCount < 2 && !r.ducking) {
      r.vy = JUMP_V * (r.jumpCount === 1 ? 0.8 : 1);
      r.jumpCount++; this.jumpHeld = true;
    }
    if (!wantJump) this.jumpHeld = false;

    // Input — duck
    const wantDuck = this.keys.has('ArrowDown') || this.keys.has('KeyS');
    if (wantDuck && r.jumpCount === 0 && !r.duckHeld) { r.ducking = true; r.duckHeld = true; }
    if (!wantDuck) { r.ducking = false; r.duckHeld = false; }

    // Physics
    r.vy = Math.min(r.vy + GRAV * dt, 22);
    r.y += r.vy * dt;
    const groundY = GY - (r.ducking ? 34 : 56);
    if (r.y >= groundY) { r.y = groundY; r.vy = 0; r.jumpCount = 0; }
    r.animT += dt;

    // Distance + speed
    this.dist += this.spd * dt;
    this.score = Math.floor(this.dist / 5) + this.collectibles * 10;
    this.spd = 5 + Math.min(this.dist / 4000, 5);
    this.bgScroll = (this.bgScroll + this.spd * dt) % 1000;

    // Obstacle spawning
    this.nextObs -= this.spd * dt;
    if (this.nextObs <= 0) {
      this.spawnObstacle();
      this.nextObs = 240 + Math.random() * 260 - Math.min(this.dist / 500, 80);
    }
    for (const o of this.obstacles) { o.x -= this.spd * dt; o.animT += dt; }
    this.obstacles = this.obstacles.filter(o => o.x + o.w > -10);

    // Collectible spawning
    this.nextColl -= this.spd * dt;
    if (this.nextColl <= 0) {
      this.collectList.push({ x: CW + 30, y: GY - 80 - Math.random() * 110, taken: false, animT: 0 });
      this.nextColl = 200 + Math.random() * 180;
    }
    for (const c of this.collectList) { c.x -= this.spd * dt; c.animT += dt; }
    this.collectList = this.collectList.filter(c => c.x > -20);

    // Bg entities scroll
    for (const b of this.bgEntities) {
      b.x -= this.spd * b.z * dt;
      if (b.x < -200) b.x += CW + 400;
    }

    // Collisions — obstacles
    const ph = r.ducking ? 28 : 52, pw = 26;
    const py = r.y + (r.ducking ? 22 : 4);
    for (const o of this.obstacles) {
      if (rectOverlap(PX + 4, py, pw, ph, o.x + 4, o.y + 4, o.w - 8, o.h - 8)) {
        this.runner.dead = true;
        this.spawnDeathParticles(PX + 14, r.y + 24);
        this.state = 'dead';
        if (this.score > this.best) this.best = this.score;
        return;
      }
    }

    // Collisions — collectibles
    for (const c of this.collectList) {
      if (!c.taken && rectOverlap(PX + 4, py, pw, ph, c.x - 10, c.y - 10, 20, 20)) {
        c.taken = true;
        this.collectibles++;
        const pts = this.zone.collectPts;
        this.floatTexts.push({ x: c.x, y: c.y, text: '+' + pts, alpha: 1, vy: -1.5 });
      }
    }

    // Particles & float texts
    for (const p of this.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.25 * dt; p.alpha -= 0.025 * dt;
    }
    this.particles = this.particles.filter(p => p.alpha > 0);
    for (const f of this.floatTexts) { f.y += f.vy * dt; f.alpha -= 0.022 * dt; }
    this.floatTexts = this.floatTexts.filter(f => f.alpha > 0);
  }

  private spawnObstacle() {
    const types = this.zone.obstacleTypes;
    const type = types[Math.floor(Math.random() * types.length)];
    const specs: Record<string, { w: number; h: number; tall: boolean; y?: number }> = {
      fence:    { w: 28, h: 50, tall: false },
      hay_bale: { w: 48, h: 44, tall: false },
      cow:      { w: 68, h: 52, tall: false },
      sunflower:{ w: 30, h: 58, tall: false },
      boulder:  { w: 52, h: 46, tall: false },
      snowdrift:{ w: 64, h: 34, tall: false },
      pine:     { w: 44, h: 72, tall: false },
      ski_arch: { w: 60, h: 56, tall: true, y: GY - 80 },
      wave:     { w: 56, h: 28, tall: false },
      pier_post:{ w: 24, h: 56, tall: false },
      sail:     { w: 50, h: 68, tall: true, y: GY - 88 },
      duck:     { w: 32, h: 28, tall: false },
      tram:     { w: 80, h: 66, tall: false },
      bike:     { w: 42, h: 44, tall: false },
      barrier:  { w: 30, h: 36, tall: false },
      lamppost: { w: 20, h: 70, tall: false },
      log:      { w: 56, h: 32, tall: false },
      mushroom: { w: 36, h: 38, tall: false },
      deer:     { w: 52, h: 60, tall: false },
      branch:   { w: 64, h: 32, tall: true, y: GY - 76 },
    };
    const sp = specs[type] ?? { w: 40, h: 48, tall: false };
    const y = sp.y ?? (GY - sp.h);
    this.obstacles.push({ x: CW + 20, y, w: sp.w, h: sp.h, type, animT: 0, vx: 0, tall: sp.tall });
  }

  private spawnDeathParticles(x: number, y: number) {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      this.particles.push({ x, y, vx: Math.cos(a) * (3 + Math.random() * 4),
        vy: Math.sin(a) * (3 + Math.random() * 4) - 2, alpha: 1, color: '#FF6060', r: 4 + Math.random() * 4 });
    }
  }

  // ── Draw ─────────────────────────────────────────────────────────────────────
  private draw() {
    const ctx = this.ctx;
    if (this.state === 'start') { this.drawStart(ctx); return; }

    this.drawSky(ctx);
    this.drawBgLayers(ctx);
    this.drawGround(ctx);
    this.drawCollectibles(ctx);
    this.drawObstacles(ctx);
    this.drawRunner(ctx);
    this.drawParticles(ctx);
    this.drawFloatTexts(ctx);
    this.drawHUD(ctx);
    this.drawZoneBanner(ctx);
    if (this.state === 'dead') this.drawGameOver(ctx);
  }

  private drawSky(ctx: CanvasRenderingContext2D) {
    const z = this.zone, progress = (this.dist % ZONE_LEN) / ZONE_LEN;
    const nextZ = ZONES[(this.zoneIdx + 1) % ZONES.length];
    // lerp sky colours for smooth zone transitions
    const fade = progress > 0.85 ? (progress - 0.85) / 0.15 : 0;
    const skyA = lerpColor(z.skyA, nextZ.skyA, fade);
    const skyB = lerpColor(z.skyB, nextZ.skyB, fade);

    const g = ctx.createLinearGradient(0, 0, 0, CH);
    g.addColorStop(0, skyA); g.addColorStop(1, skyB);
    ctx.fillStyle = g; ctx.fillRect(0, 0, CW, CH);
  }

  private drawBgLayers(ctx: CanvasRenderingContext2D) {
    const zi = this.zoneIdx;
    // far layer (parallax 0.15)
    const farOff = -(this.dist * 0.15) % CW;
    for (let rep = 0; rep < 3; rep++) {
      const ox = farOff + rep * CW;
      this.drawFarLayer(ctx, ox, zi);
    }
    // mid layer (parallax 0.35)
    for (const b of this.bgEntities.filter(e => e.z < 0.4)) {
      this.drawBgEntity(ctx, b.x, b.type, zi, false);
    }
    for (const b of this.bgEntities.filter(e => e.z >= 0.4)) {
      this.drawBgEntity(ctx, b.x, b.type, zi, true);
    }
    // fog layer at horizon
    const fz = this.zone;
    ctx.fillStyle = hexAlpha(fz.fogColor, fz.fogOpacity);
    ctx.fillRect(0, GY - 120, CW, 80);
  }

  private drawFarLayer(ctx: CanvasRenderingContext2D, ox: number, zi: number) {
    ctx.save(); ctx.translate(ox, 0);
    switch (zi) {
      case 0: drawCountrysideFar(ctx); break;
      case 1: drawAlpsFar(ctx); break;
      case 2: drawLakeFar(ctx); break;
      case 3: drawCityFar(ctx); break;
      case 4: drawForestFar(ctx); break;
    }
    ctx.restore();
  }

  private drawBgEntity(ctx: CanvasRenderingContext2D, x: number, _type: string, zi: number, mid: boolean) {
    ctx.save(); ctx.translate(x, 0);
    if (!mid) {
      switch (zi) {
        case 0: drawCountrysideMid(ctx); break;
        case 1: drawAlpsMid(ctx); break;
        case 2: drawLakeMid(ctx); break;
        case 3: drawCityMid(ctx); break;
        case 4: drawForestMid(ctx); break;
      }
    } else {
      switch (zi) {
        case 0: drawCountrysideNear(ctx); break;
        case 1: drawAlpsNear(ctx); break;
        case 2: drawLakeNear(ctx); break;
        case 3: drawCityNear(ctx); break;
        case 4: drawForestNear(ctx); break;
      }
    }
    ctx.restore();
  }

  private drawGround(ctx: CanvasRenderingContext2D) {
    const z = this.zone;
    // ground fill
    ctx.fillStyle = z.groundFill;
    ctx.fillRect(0, GY, CW, CH - GY);
    // ground top stripe
    ctx.fillStyle = z.groundTop;
    ctx.fillRect(0, GY, CW, 10);
    // running path texture
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    const off = this.bgScroll % 60;
    for (let x = -off; x < CW; x += 60)
      ctx.fillRect(x, GY + 2, 30, 5);
    // shadow under player
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(PX + 14, GY + 6, 18, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawCollectibles(ctx: CanvasRenderingContext2D) {
    for (const c of this.collectList) {
      if (c.taken) continue;
      drawCollectible(ctx, c.x, c.y, this.zone.collectType, this.zone.collectColor, c.animT, this.frameN);
    }
  }

  private drawObstacles(ctx: CanvasRenderingContext2D) {
    for (const o of this.obstacles) {
      drawObstacle(ctx, o.x, o.y, o.type, o.animT, this.frameN);
    }
  }

  private drawRunner(ctx: CanvasRenderingContext2D) {
    const r = this.runner;
    if (r.dead) return;
    drawHiker(ctx, PX, r.y, r.ducking, r.animT, r.jumpCount > 0, this.spd);
  }

  private drawParticles(ctx: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      ctx.save(); ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  private drawFloatTexts(ctx: CanvasRenderingContext2D) {
    ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
    for (const f of this.floatTexts) {
      ctx.save(); ctx.globalAlpha = Math.max(0, f.alpha);
      ctx.fillStyle = this.zone.collectColor;
      ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
      ctx.strokeText(f.text, f.x, f.y); ctx.fillText(f.text, f.x, f.y);
      ctx.restore();
    }
    ctx.textAlign = 'left';
  }

  private drawHUD(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, CW, 34);
    ctx.font = 'bold 13px monospace'; ctx.fillStyle = '#fff';
    const km = (this.dist / 800).toFixed(1);
    ctx.fillText(`DIST: ${km} km`, 12, 22);
    ctx.fillText(`SCORE: ${this.score}`, 160, 22);
    ctx.fillText(`BEST: ${this.best}`, 320, 22);
    // collectibles
    const cz = this.zone;
    ctx.fillStyle = cz.collectColor;
    ctx.fillText(`${cz.icon} ${this.collectibles}`, 480, 22);
    // zone progress bar
    const pct = (this.dist % ZONE_LEN) / ZONE_LEN;
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(600, 10, 188, 14);
    ctx.fillStyle = hexAlpha(cz.collectColor, 0.8);
    ctx.fillRect(600, 10, 188 * pct, 14);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1;
    ctx.strokeRect(600, 10, 188, 14);
    ctx.fillStyle = '#fff'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
    ctx.fillText(cz.name, 694, 21);
    ctx.textAlign = 'left';
    // controls hint (fades after 5 secs)
    if (this.dist < 800) {
      ctx.fillStyle = `rgba(255,255,255,${Math.max(0, 1 - this.dist / 800)})`;
      ctx.font = '12px monospace'; ctx.textAlign = 'center';
      ctx.fillText('↑/Space = Jump (×2)   ↓/S = Duck', CW / 2, CH - 14);
      ctx.textAlign = 'left';
    }
  }

  private drawZoneBanner(ctx: CanvasRenderingContext2D) {
    if (this.zoneBanner.alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, this.zoneBanner.alpha * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(ctx, CW / 2 - 160, CH / 2 - 28, 320, 56, 12);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(this.zoneBanner.text, CW / 2, CH / 2 + 8);
    ctx.restore(); ctx.textAlign = 'left';
  }

  private drawStart(ctx: CanvasRenderingContext2D) {
    const g = ctx.createLinearGradient(0, 0, 0, CH);
    g.addColorStop(0, '#5BBCF8'); g.addColorStop(1, '#C8EFA0');
    ctx.fillStyle = g; ctx.fillRect(0, 0, CW, CH);
    drawCountrysideFar(ctx);
    drawCountrysideMid(ctx);
    ctx.fillStyle = '#6DC840'; ctx.fillRect(0, GY, CW, CH - GY);
    ctx.fillStyle = '#4A8C22'; ctx.fillRect(0, GY, CW, 10);

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    roundRect(ctx, CW / 2 - 220, CH / 2 - 130, 440, 260, 16); ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('🇨🇭 Swiss Runner', CW / 2, CH / 2 - 80);
    ctx.font = '15px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText('Journey through Switzerland\'s landscapes!', CW / 2, CH / 2 - 44);
    ctx.font = '13px monospace'; ctx.fillStyle = 'rgba(255,255,255,0.7)';
    const zones = ZONES.map(z => z.icon + ' ' + z.name).join('   ');
    ctx.fillText(zones, CW / 2, CH / 2 - 10);
    ctx.fillStyle = '#fff'; ctx.font = '13px monospace';
    ctx.fillText('↑ / Space — Jump (double jump!)    ↓ / S — Duck', CW / 2, CH / 2 + 28);
    const blink = Math.floor(Date.now() / 500) % 2 === 0;
    if (blink) {
      ctx.fillStyle = '#FFD040'; ctx.font = 'bold 17px sans-serif';
      ctx.fillText('Press SPACE to Start', CW / 2, CH / 2 + 80);
    }
    ctx.textAlign = 'left';
  }

  private drawGameOver(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = 'rgba(30,20,60,0.85)';
    roundRect(ctx, CW / 2 - 180, CH / 2 - 90, 360, 180, 14); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', CW / 2, CH / 2 - 38);
    ctx.font = '16px monospace';
    ctx.fillText(`Score: ${this.score}   Best: ${this.best}`, CW / 2, CH / 2 + 2);
    ctx.fillText(`Distance: ${(this.dist / 800).toFixed(1)} km`, CW / 2, CH / 2 + 28);
    const blink = Math.floor(Date.now() / 500) % 2 === 0;
    if (blink) { ctx.font = '14px monospace'; ctx.fillText('Press SPACE to try again', CW / 2, CH / 2 + 62); }
    ctx.textAlign = 'left';
  }

  // Touch / mobile controls
  onTouchJump()  { if (this.state !== 'playing') { this.startGame(); return; }
    if (!this.jumpHeld && this.runner.jumpCount < 2) { this.runner.vy = JUMP_V * (this.runner.jumpCount === 1 ? 0.8 : 1); this.runner.jumpCount++; this.jumpHeld = true; }
    setTimeout(() => this.jumpHeld = false, 100); }
  onTouchDuckStart() { this.keys.add('ArrowDown'); }
  onTouchDuckEnd()   { this.keys.delete('ArrowDown'); }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function rectOverlap(ax:number,ay:number,aw:number,ah:number,bx:number,by:number,bw:number,bh:number){
  return ax<bx+bw&&ax+aw>bx&&ay<by+bh&&ay+ah>by;
}
function lerpColor(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ar=(pa>>16)&0xff,ag=(pa>>8)&0xff,ab=pa&0xff;
  const br=(pb>>16)&0xff,bg=(pb>>8)&0xff,bb=pb&0xff;
  const r=Math.round(ar+(br-ar)*t), g=Math.round(ag+(bg-ag)*t), bl=Math.round(ab+(bb-ab)*t);
  return '#'+((r<<16)|(g<<8)|bl).toString(16).padStart(6,'0');
}
function hexAlpha(hex: string, a: number): string {
  const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}
function roundRect(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number){
  ctx.beginPath();
  ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.arcTo(x+w,y,x+w,y+r,r);
  ctx.lineTo(x+w,y+h-r);ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
  ctx.lineTo(x+r,y+h);ctx.arcTo(x,y+h,x,y+h-r,r);
  ctx.lineTo(x,y+r);ctx.arcTo(x,y,x+r,y,r);ctx.closePath();
}

// ── Background drawing ────────────────────────────────────────────────────────

// Zone 0: Countryside
function drawCountrysideFar(ctx: CanvasRenderingContext2D) {
  // rolling hills far
  ctx.fillStyle = '#A0D860';
  for (const [cx,cy,rx,ry] of [[100,270,160,70],[350,280,120,55],[580,265,180,80],[780,275,140,65]]) {
    ctx.beginPath(); ctx.ellipse(cx,cy,rx,ry,0,Math.PI,0); ctx.fill();
  }
  // farmhouse
  ctx.fillStyle = '#E8D090'; ctx.fillRect(430, 240, 60, 50);
  ctx.fillStyle = '#C04020';
  ctx.beginPath(); ctx.moveTo(425,240); ctx.lineTo(460,210); ctx.lineTo(495,240); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#604020'; ctx.fillRect(448,260,14,30);
}
function drawCountrysideMid(ctx: CanvasRenderingContext2D) {
  // hill mid
  ctx.fillStyle = '#78C840';
  ctx.beginPath(); ctx.ellipse(200,310,200,90,0,Math.PI,0); ctx.fill();
  ctx.beginPath(); ctx.ellipse(650,318,180,80,0,Math.PI,0); ctx.fill();
  // sunflowers
  for (const [fx,fy] of [[100,300],[140,295],[560,298],[600,302]]) {
    ctx.fillStyle='#20A020'; ctx.fillRect(fx-2,fy,4,32);
    ctx.fillStyle='#FFD020'; ctx.beginPath(); ctx.arc(fx,fy,9,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#A06010'; ctx.beginPath(); ctx.arc(fx,fy,5,0,Math.PI*2); ctx.fill();
  }
}
function drawCountrysideNear(ctx: CanvasRenderingContext2D) {
  // wooden fence section
  ctx.fillStyle = '#C09060';
  for (const fx of [0, 30, 60]) { ctx.fillRect(fx,305,6,40); }
  ctx.fillRect(0,310,66,6); ctx.fillRect(0,322,66,6);
  // cow in background
  ctx.fillStyle='#F0F0E0'; ctx.fillRect(200,290,48,32);
  ctx.fillStyle='#C08040'; ctx.fillRect(220,282,20,14);
  ctx.fillStyle='#F8F0D8'; ctx.fillRect(208,318,8,18); ctx.fillRect(232,318,8,18);
}

// Zone 1: Alps
function drawAlpsFar(ctx: CanvasRenderingContext2D) {
  // distant snowy peaks
  for (const [px,ph] of [[60,120],[200,180],[380,160],[520,200],[680,140],[760,110]]) {
    ctx.fillStyle='#B0C8E0';
    ctx.beginPath(); ctx.moveTo(px-80,GY-60); ctx.lineTo(px,GY-60-ph); ctx.lineTo(px+80,GY-60); ctx.closePath(); ctx.fill();
    ctx.fillStyle='#F0F4FF';
    ctx.beginPath(); ctx.moveTo(px-20,GY-60-ph+30); ctx.lineTo(px,GY-60-ph); ctx.lineTo(px+20,GY-60-ph+30); ctx.closePath(); ctx.fill();
  }
}
function drawAlpsMid(ctx: CanvasRenderingContext2D) {
  // pine trees silhouette
  ctx.fillStyle='#1A4020';
  for (const [tx] of [[50],[130],[210],[380],[460],[620],[700]]) {
    ctx.beginPath(); ctx.moveTo(tx,340); ctx.lineTo(tx-22,290); ctx.lineTo(tx+22,290); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(tx,295); ctx.lineTo(tx-16,255); ctx.lineTo(tx+16,255); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(tx,260); ctx.lineTo(tx-10,230); ctx.lineTo(tx+10,230); ctx.closePath(); ctx.fill();
    ctx.fillStyle='#2C1808'; ctx.fillRect(tx-4,340,8,10); ctx.fillStyle='#1A4020';
  }
  // chalet
  ctx.fillStyle='#D4A870'; ctx.fillRect(310,278,70,62);
  ctx.fillStyle='#6E3010';
  ctx.beginPath(); ctx.moveTo(300,278); ctx.lineTo(345,248); ctx.lineTo(390,278); ctx.closePath(); ctx.fill();
  ctx.fillStyle='#FFF8E8'; ctx.fillRect(318,295,14,14); ctx.fillRect(348,295,14,14);
  ctx.fillStyle='#6E3010'; ctx.fillRect(338,312,14,28);
}
function drawAlpsNear(ctx: CanvasRenderingContext2D) {
  // ski lift tower
  ctx.fillStyle='#888';
  ctx.fillRect(120,280,8,65); ctx.fillRect(116,278,16,8);
  ctx.fillRect(116,278,2,18); ctx.fillRect(130,278,2,18);
  // cable
  ctx.strokeStyle='#666'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(0,260); ctx.lineTo(128,280); ctx.stroke();
  // gondola
  ctx.fillStyle='#E84020'; ctx.fillRect(30,252,22,16); ctx.fillStyle='#FFF'; ctx.fillRect(33,255,16,8);
}

// Zone 2: Lake
function drawLakeFar(ctx: CanvasRenderingContext2D) {
  // distant mountains
  ctx.fillStyle='#6090C0';
  for (const [lx,lh] of [[0,80],[120,100],[280,120],[440,90],[600,110],[740,95]]) {
    ctx.beginPath(); ctx.moveTo(lx,GY-50); ctx.lineTo(lx+100,GY-50-lh); ctx.lineTo(lx+200,GY-50); ctx.closePath(); ctx.fill();
  }
  // lake surface (wide band)
  const lg = ctx.createLinearGradient(0,GY-110,0,GY);
  lg.addColorStop(0,'#2878D0'); lg.addColorStop(1,'#1050A0');
  ctx.fillStyle=lg; ctx.fillRect(0,GY-110,CW,110);
  // sparkle on water
  ctx.strokeStyle='rgba(255,255,255,0.3)'; ctx.lineWidth=1;
  for (let wx=20; wx<CW; wx+=40) {
    ctx.beginPath(); ctx.moveTo(wx,GY-80); ctx.lineTo(wx+12,GY-80); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(wx+4,GY-70); ctx.lineTo(wx+18,GY-70); ctx.stroke();
  }
}
function drawLakeMid(ctx: CanvasRenderingContext2D) {
  // sailboat
  ctx.fillStyle='#F8F0D8'; ctx.fillRect(140,GY-130,50,24);
  ctx.fillStyle='#C09060'; ctx.fillRect(158,GY-106,6,20);
  ctx.fillStyle='#FFFFFF';
  ctx.beginPath(); ctx.moveTo(161,GY-106); ctx.lineTo(175,GY-150); ctx.lineTo(161,GY-106); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(161,GY-106); ctx.lineTo(147,GY-145); ctx.lineTo(161,GY-106); ctx.closePath(); ctx.fill();
}
function drawLakeNear(ctx: CanvasRenderingContext2D) {
  // dock posts
  ctx.fillStyle='#A07840';
  ctx.fillRect(0,GY-20,14,25); ctx.fillRect(60,GY-22,14,27); ctx.fillRect(130,GY-18,14,23);
  // rope
  ctx.strokeStyle='#806030'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(7,GY-16); ctx.lineTo(67,GY-18); ctx.stroke();
  // duck
  ctx.fillStyle='#F8D820'; ctx.beginPath(); ctx.ellipse(340,GY-90,20,14,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#F89020'; ctx.beginPath(); ctx.ellipse(355,GY-96,12,10,0.3,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#000'; ctx.beginPath(); ctx.arc(360,GY-98,2,0,Math.PI*2); ctx.fill();
}

// Zone 3: Zürich City
function drawCityFar(ctx: CanvasRenderingContext2D) {
  // building silhouettes
  const blds = [[0,180,80],[90,160,60],[160,200,70],[240,140,50],[300,190,90],[400,150,60],[470,210,80],[560,160,65],[635,180,70],[710,140,55],[770,195,30]];
  ctx.fillStyle='#5C6878';
  for (const [bx,bh,bw] of blds) ctx.fillRect(bx, GY-bh-40, bw, bh+40);
  // windows
  ctx.fillStyle='rgba(255,240,180,0.4)';
  for (const [bx,bh,bw] of blds) {
    for (let wy=GY-bh-30; wy<GY-50; wy+=18)
      for (let wx=bx+6; wx<bx+bw-6; wx+=14)
        if (Math.random()>0.4) ctx.fillRect(wx,wy,8,10);
  }
  // Grossmünster towers (simplified)
  ctx.fillStyle='#708090'; ctx.fillRect(380,GY-230,22,200); ctx.fillRect(410,GY-230,22,200);
  ctx.fillStyle='#607080'; ctx.fillRect(378,GY-240,26,18); ctx.fillRect(408,GY-240,26,18);
}
function drawCityMid(ctx: CanvasRenderingContext2D) {
  // street lamps
  ctx.strokeStyle='#B0B0B0'; ctx.lineWidth=4;
  for (const lx of [80,240,400,560,720]) {
    ctx.beginPath(); ctx.moveTo(lx,GY); ctx.lineTo(lx,GY-80); ctx.lineTo(lx+20,GY-80); ctx.stroke();
    ctx.fillStyle='#FFFFC0'; ctx.beginPath(); ctx.arc(lx+20,GY-82,6,0,Math.PI*2); ctx.fill();
  }
  // tram line
  ctx.strokeStyle='#808080'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(0,GY-2); ctx.lineTo(CW,GY-2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0,GY-6); ctx.lineTo(CW,GY-6); ctx.stroke();
}
function drawCityNear(ctx: CanvasRenderingContext2D) {
  // cobblestone pattern
  ctx.fillStyle='rgba(0,0,0,0.06)';
  for (let cx=0; cx<CW; cx+=28) ctx.fillRect(cx,GY+2,14,8);
}

// Zone 4: Forest
function drawForestFar(ctx: CanvasRenderingContext2D) {
  // tree canopy backdrop
  ctx.fillStyle='#1A4018';
  ctx.beginPath(); ctx.moveTo(0,GY-80);
  for (let fx=0; fx<=CW; fx+=30) {
    const fy = GY-80 - Math.sin(fx*0.04)*40 - Math.cos(fx*0.07)*25;
    ctx.lineTo(fx,fy);
  }
  ctx.lineTo(CW,GY-40); ctx.lineTo(0,GY-40); ctx.closePath(); ctx.fill();
  // light rays
  ctx.fillStyle='rgba(180,220,120,0.06)';
  for (let rx=50; rx<CW; rx+=90) {
    ctx.beginPath(); ctx.moveTo(rx-10,0); ctx.lineTo(rx+10,0); ctx.lineTo(rx+35,GY); ctx.lineTo(rx+15,GY); ctx.closePath(); ctx.fill();
  }
}
function drawForestMid(ctx: CanvasRenderingContext2D) {
  // tree trunks mid
  ctx.fillStyle='#3A2010';
  for (const [tx] of [[20],[120],[280],[430],[580],[720]]) {
    ctx.fillRect(tx-10,GY-140,20,145);
    // foliage
    ctx.fillStyle='#205018';
    ctx.beginPath(); ctx.arc(tx,GY-150,38,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(tx-24,GY-130,28,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(tx+24,GY-125,25,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#3A2010';
  }
  // stream
  ctx.fillStyle='rgba(80,140,200,0.5)';
  ctx.beginPath(); ctx.moveTo(340,GY-5);
  for (let wx=340; wx<460; wx+=10) ctx.lineTo(wx,GY-5+Math.sin(wx*0.3)*3);
  ctx.lineTo(460,GY+8); ctx.lineTo(340,GY+8); ctx.closePath(); ctx.fill();
}
function drawForestNear(ctx: CanvasRenderingContext2D) {
  // undergrowth
  ctx.fillStyle='#1A5010';
  for (const [fx,fw] of [[0,40],[160,50],[360,35],[520,55],[680,42]]) {
    ctx.beginPath();
    ctx.moveTo(fx,GY); ctx.quadraticCurveTo(fx+fw/2,GY-30,fx+fw,GY); ctx.closePath(); ctx.fill();
  }
}

// ── Obstacle drawing ──────────────────────────────────────────────────────────
function drawObstacle(ctx: CanvasRenderingContext2D, x:number, y:number, type:string, t:number, frame:number) {
  switch (type) {
    // Countryside
    case 'fence':     drawFence(ctx,x,y); break;
    case 'hay_bale':  drawHayBale(ctx,x,y); break;
    case 'cow':       drawCow(ctx,x,y,frame); break;
    case 'sunflower': drawSunflower(ctx,x,y,t); break;
    // Alps
    case 'boulder':   drawBoulder(ctx,x,y); break;
    case 'snowdrift': drawSnowdrift(ctx,x,y); break;
    case 'pine':      drawPineTree(ctx,x,y); break;
    case 'ski_arch':  drawSkiArch(ctx,x,y); break;
    // Lake
    case 'wave':      drawWave(ctx,x,y,t); break;
    case 'pier_post': drawPierPost(ctx,x,y); break;
    case 'sail':      drawSail(ctx,x,y); break;
    case 'duck':      drawDuckObs(ctx,x,y,t); break;
    // City
    case 'tram':      drawTram(ctx,x,y,frame); break;
    case 'bike':      drawBike(ctx,x,y,frame); break;
    case 'barrier':   drawBarrier(ctx,x,y); break;
    case 'lamppost':  drawLamppostObs(ctx,x,y); break;
    // Forest
    case 'log':       drawLog(ctx,x,y); break;
    case 'mushroom':  drawMushroom(ctx,x,y); break;
    case 'deer':      drawDeer(ctx,x,y,t); break;
    case 'branch':    drawBranch(ctx,x,y); break;
  }
}
function drawFence(ctx:CanvasRenderingContext2D,x:number,y:number){
  ctx.fillStyle='#C09060';
  ctx.fillRect(x,y,6,50);ctx.fillRect(x+22,y,6,50);
  ctx.fillRect(x,y+10,28,6);ctx.fillRect(x,y+28,28,6);
}
function drawHayBale(ctx:CanvasRenderingContext2D,x:number,y:number){
  ctx.fillStyle='#D4A820';
  ctx.beginPath();ctx.ellipse(x+22,y+22,22,22,0,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#A07810';ctx.lineWidth=2;
  for(let i=0;i<3;i++){ctx.beginPath();ctx.arc(x+22,y+22,8+i*5,0,Math.PI*2);ctx.stroke();}
}
function drawCow(ctx:CanvasRenderingContext2D,x:number,y:number,f:number){
  const leg=Math.sin(f*0.15)*5;
  ctx.fillStyle='#F0ECD8';ctx.fillRect(x+8,y+16,52,30);
  ctx.fillStyle='#D8D4C0';ctx.fillRect(x+16,y+6,24,16);
  ctx.fillStyle='#1A1A18';ctx.fillRect(x+12,y+44+leg,10,10);ctx.fillRect(x+26,y+44-leg,10,10);
  ctx.fillRect(x+40,y+44+leg,10,10);ctx.fillRect(x+52,y+44-leg,10,10);
  ctx.fillStyle='#3A3028';ctx.fillRect(x+24,y+6,8,6);ctx.fillRect(x+30,y+6,8,6);
  ctx.fillStyle='#000';ctx.fillRect(x+34,y+10,4,4);
  ctx.fillStyle='#FF9090';ctx.fillRect(x+8,y+36,14,10);
  ctx.fillStyle='#604030';ctx.fillRect(x+14,y,4,8);ctx.fillRect(x+22,y-2,4,8);
}
function drawSunflower(ctx:CanvasRenderingContext2D,x:number,y:number,t:number){
  ctx.fillStyle='#2A8020';ctx.fillRect(x+12,y+20,6,40);
  const sway=Math.sin(t*0.05)*4;
  ctx.save();ctx.translate(x+15,y+20);ctx.rotate(sway*0.04);
  for(let i=0;i<10;i++){const a=i/10*Math.PI*2;ctx.fillStyle='#FFD020';ctx.beginPath();ctx.ellipse(Math.cos(a)*14,Math.sin(a)*14,7,4,a,0,Math.PI*2);ctx.fill();}
  ctx.fillStyle='#603010';ctx.beginPath();ctx.arc(0,0,10,0,Math.PI*2);ctx.fill();
  ctx.restore();
}
function drawBoulder(ctx:CanvasRenderingContext2D,x:number,y:number){
  ctx.fillStyle='#808888';
  ctx.beginPath();ctx.ellipse(x+26,y+26,26,22,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#A0A8A8';ctx.beginPath();ctx.ellipse(x+18,y+16,12,9,0.3,0,Math.PI*2);ctx.fill();
}
function drawSnowdrift(ctx:CanvasRenderingContext2D,x:number,y:number){
  ctx.fillStyle='#E8EEFF';
  ctx.beginPath();ctx.ellipse(x+32,y+24,32,16,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#F8FEFF';ctx.beginPath();ctx.ellipse(x+20,y+18,18,12,0,0,Math.PI*2);ctx.fill();
}
function drawPineTree(ctx:CanvasRenderingContext2D,x:number,y:number){
  ctx.fillStyle='#2C1808';ctx.fillRect(x+18,y+60,8,14);
  ctx.fillStyle='#1A4820';
  ctx.beginPath();ctx.moveTo(x+22,y);ctx.lineTo(x,y+48);ctx.lineTo(x+44,y+48);ctx.closePath();ctx.fill();
  ctx.beginPath();ctx.moveTo(x+22,y+28);ctx.lineTo(x+4,y+64);ctx.lineTo(x+40,y+64);ctx.closePath();ctx.fill();
  ctx.fillStyle='rgba(255,255,255,0.5)';ctx.beginPath();ctx.moveTo(x+22,y);ctx.lineTo(x+28,y+18);ctx.lineTo(x+22,y+12);ctx.closePath();ctx.fill();
}
function drawSkiArch(ctx:CanvasRenderingContext2D,x:number,y:number){
  ctx.fillStyle='#E03020';
  ctx.fillRect(x,y+30,8,28);ctx.fillRect(x+52,y+30,8,28);
  ctx.beginPath();ctx.arc(x+30,y+30,30,Math.PI,0);ctx.lineWidth=8;ctx.strokeStyle='#E03020';ctx.stroke();
  ctx.strokeStyle='#FFFFFF';ctx.lineWidth=3;
  for(let i=0;i<5;i++){ctx.beginPath();ctx.moveTo(x+4+i*13,y+58-i*5);ctx.lineTo(x+8+i*13,y+44-i*5);ctx.stroke();}
}
function drawWave(ctx:CanvasRenderingContext2D,x:number,y:number,t:number){
  ctx.fillStyle='rgba(40,120,200,0.85)';
  ctx.beginPath();ctx.moveTo(x,y+28);
  for(let wx=0;wx<=56;wx+=8)ctx.lineTo(x+wx,y+14+Math.sin((wx+t*0.3)*0.4)*8);
  ctx.lineTo(x+56,y+28);ctx.closePath();ctx.fill();
  ctx.strokeStyle='rgba(180,220,255,0.8)';ctx.lineWidth=2;
  ctx.beginPath();
  for(let wx=0;wx<=56;wx+=8)ctx.lineTo(x+wx,y+14+Math.sin((wx+t*0.3)*0.4)*8);
  ctx.stroke();
}
function drawPierPost(ctx:CanvasRenderingContext2D,x:number,y:number){
  ctx.fillStyle='#A07840';ctx.fillRect(x+8,y,8,56);
  ctx.strokeStyle='#806030';ctx.lineWidth=3;
  ctx.beginPath();ctx.moveTo(x+4,y+10);ctx.lineTo(x+20,y+10);ctx.stroke();
  ctx.beginPath();ctx.moveTo(x+4,y+25);ctx.lineTo(x+20,y+25);ctx.stroke();
}
function drawSail(ctx:CanvasRenderingContext2D,x:number,y:number){
  ctx.fillStyle='#C8A870';ctx.fillRect(x+10,y+56,30,12);
  ctx.fillStyle='#A07840';ctx.fillRect(x+22,y+8,4,50);
  ctx.fillStyle='#FFFFF0';
  ctx.beginPath();ctx.moveTo(x+24,y+8);ctx.lineTo(x+48,y+38);ctx.lineTo(x+24,y+56);ctx.closePath();ctx.fill();
  ctx.beginPath();ctx.moveTo(x+24,y+8);ctx.lineTo(x+4,y+38);ctx.lineTo(x+24,y+56);ctx.closePath();
  ctx.fillStyle='rgba(200,200,230,0.8)';ctx.fill();
}
function drawDuckObs(ctx:CanvasRenderingContext2D,x:number,y:number,t:number){
  const bob=Math.sin(t*0.1)*3;
  ctx.fillStyle='#F8D820';ctx.beginPath();ctx.ellipse(x+16,y+18+bob,16,12,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#F89020';ctx.beginPath();ctx.ellipse(x+28,y+12+bob,12,9,0.3,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#000';ctx.beginPath();ctx.arc(x+32,y+10+bob,2,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#F84020';ctx.fillRect(x+33,y+13+bob,7,4);
}
function drawTram(ctx:CanvasRenderingContext2D,x:number,y:number,f:number){
  ctx.fillStyle='#2060C0';ctx.fillRect(x,y+8,80,52);
  ctx.fillStyle='#1848A0';ctx.fillRect(x,y,80,12);
  ctx.fillStyle='#C8E0FF';
  for(let wx=x+6;wx<x+72;wx+=18){ctx.fillRect(wx,y+16,12,18);ctx.fillRect(wx,y+40,12,14);}
  ctx.fillStyle='#888';ctx.fillRect(x+8,y+60,16,8);ctx.fillRect(x+56,y+60,16,8);
  ctx.beginPath();ctx.arc(x+16,y+68,7,0,Math.PI*2);ctx.fillStyle='#333';ctx.fill();
  ctx.beginPath();ctx.arc(x+64,y+68,7,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#AAA';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x+40,y);ctx.lineTo(x+40,y-12);ctx.stroke();
  const spk=Math.sin(f*0.3)*2;ctx.fillStyle='rgba(255,255,200,0.6)';
  ctx.beginPath();ctx.arc(x+40,y-10+spk,4,0,Math.PI*2);ctx.fill();
}
function drawBike(ctx:CanvasRenderingContext2D,x:number,y:number,f:number){
  const spin=f*0.25;
  ctx.strokeStyle='#505050';ctx.lineWidth=3;
  ctx.beginPath();ctx.arc(x+10,y+32,14,0,Math.PI*2);ctx.stroke();
  ctx.beginPath();ctx.arc(x+32,y+32,14,0,Math.PI*2);ctx.stroke();
  ctx.beginPath();ctx.moveTo(x+10,y+32);ctx.lineTo(x+21,y+14);ctx.lineTo(x+32,y+32);ctx.stroke();
  ctx.beginPath();ctx.moveTo(x+21,y+14);ctx.lineTo(x+28,y+22);ctx.stroke();
  ctx.beginPath();ctx.moveTo(x+14,y+10);ctx.lineTo(x+26,y+10);ctx.stroke();
  // spinning spokes
  ctx.strokeStyle='rgba(80,80,80,0.5)';ctx.lineWidth=1.5;
  for(let i=0;i<4;i++){const a=spin+i*Math.PI/2;
    ctx.beginPath();ctx.moveTo(x+10+Math.cos(a)*14,y+32+Math.sin(a)*14);ctx.lineTo(x+10-Math.cos(a)*14,y+32-Math.sin(a)*14);ctx.stroke();
    ctx.beginPath();ctx.moveTo(x+32+Math.cos(a)*14,y+32+Math.sin(a)*14);ctx.lineTo(x+32-Math.cos(a)*14,y+32-Math.sin(a)*14);ctx.stroke();
  }
}
function drawBarrier(ctx:CanvasRenderingContext2D,x:number,y:number){
  ctx.fillStyle='#E02020';ctx.fillRect(x,y,8,36);ctx.fillRect(x+22,y,8,36);
  for(let i=0;i<5;i++){ctx.fillStyle=i%2?'#E02020':'#FFFFFF';ctx.fillRect(x,y+i*6,30,6);}
}
function drawLamppostObs(ctx:CanvasRenderingContext2D,x:number,y:number){
  ctx.fillStyle='#909090';ctx.fillRect(x+7,y,6,70);
  ctx.fillStyle='#B0B0B0';ctx.fillRect(x+7,y,20,6);
  ctx.fillStyle='rgba(255,255,180,0.8)';ctx.beginPath();ctx.arc(x+22,y+6,7,0,Math.PI*2);ctx.fill();
}
function drawLog(ctx:CanvasRenderingContext2D,x:number,y:number){
  ctx.fillStyle='#6E3E1A';
  ctx.beginPath();ctx.ellipse(x+28,y+16,28,16,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#8C5228';ctx.fillRect(x,y+8,56,16);
  ctx.fillStyle='#A06030';
  ctx.beginPath();ctx.ellipse(x+2,y+16,8,14,0,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.ellipse(x+54,y+16,8,14,0,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#6E3E1A';ctx.lineWidth=1;
  for(let i=0;i<4;i++){ctx.beginPath();ctx.arc(x+2,y+16,4+i*2,0,Math.PI*2);ctx.stroke();}
}
function drawMushroom(ctx:CanvasRenderingContext2D,x:number,y:number){
  ctx.fillStyle='#F0F0E8';ctx.fillRect(x+12,y+22,12,16);
  ctx.fillStyle='#E03020';
  ctx.beginPath();ctx.ellipse(x+18,y+20,18,16,0,Math.PI,0);ctx.fill();
  ctx.fillStyle='rgba(255,255,255,0.7)';
  for(const[dx,dy]of[[-6,8],[4,4],[-2,14]])ctx.beginPath(),ctx.arc(x+18+dx,y+20+dy,4,0,Math.PI*2),ctx.fill();
}
function drawDeer(ctx:CanvasRenderingContext2D,x:number,y:number,t:number){
  const leg=Math.sin(t*0.15)*6;
  ctx.fillStyle='#C47820';
  ctx.fillRect(x+12,y+18,28,28);
  ctx.beginPath();ctx.ellipse(x+40,y+12,14,12,0.2,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#D89040';ctx.fillRect(x+16,y+46+leg,8,14);ctx.fillRect(x+28,y+46-leg,8,14);
  // antlers
  ctx.strokeStyle='#8B4A10';ctx.lineWidth=3;
  ctx.beginPath();ctx.moveTo(x+36,y+4);ctx.lineTo(x+28,y-14);ctx.lineTo(x+22,y-22);ctx.moveTo(x+28,y-14);ctx.lineTo(x+34,y-20);ctx.stroke();
  ctx.beginPath();ctx.moveTo(x+44,y+4);ctx.lineTo(x+50,y-14);ctx.lineTo(x+56,y-22);ctx.moveTo(x+50,y-14);ctx.lineTo(x+44,y-20);ctx.stroke();
  ctx.fillStyle='#000';ctx.beginPath();ctx.arc(x+46,y+10,3,0,Math.PI*2);ctx.fill();
}
function drawBranch(ctx:CanvasRenderingContext2D,x:number,y:number){
  ctx.fillStyle='#5A3010';ctx.fillRect(x,y+10,64,14);
  ctx.fillStyle='#2A6010';
  for(const[lx,ly]of[[8,-8],[22,-14],[40,-10],[54,-16],[16,4],[36,2]]){
    ctx.beginPath();ctx.ellipse(x+lx,y+ly,12,7,lx*0.05,0,Math.PI*2);ctx.fill();
  }
}

// ── Collectible drawing ───────────────────────────────────────────────────────
function drawCollectible(ctx:CanvasRenderingContext2D,x:number,y:number,type:string,color:string,t:number,frame:number){
  const bob=Math.sin(t*0.12)*4;
  ctx.save();ctx.translate(x,y+bob);
  const spin=Math.abs(Math.cos(frame*0.06));
  switch(type){
    case 'cheese':
      ctx.fillStyle=color;ctx.save();ctx.scale(spin,1);
      ctx.beginPath();ctx.moveTo(-12,-8);ctx.lineTo(12,-8);ctx.lineTo(12,8);ctx.lineTo(-12,8);ctx.closePath();ctx.fill();
      ctx.fillStyle='#C09000';ctx.beginPath();ctx.arc(-4,-2,3,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(4,3,2.5,0,Math.PI*2);ctx.fill();
      ctx.restore();break;
    case 'edelweiss':
      for(let i=0;i<6;i++){const a=i/6*Math.PI*2;ctx.fillStyle='#FFFAEE';ctx.save();ctx.rotate(a);ctx.beginPath();ctx.ellipse(8,0,7,4,0,0,Math.PI*2);ctx.fill();ctx.restore();}
      ctx.fillStyle='#F0D820';ctx.beginPath();ctx.arc(0,0,5,0,Math.PI*2);ctx.fill();break;
    case 'fish':
      ctx.fillStyle=color;ctx.save();ctx.scale(spin,1);
      ctx.beginPath();ctx.ellipse(0,0,12,7,0,0,Math.PI*2);ctx.fill();
      ctx.beginPath();ctx.moveTo(-10,-6);ctx.lineTo(-16,0);ctx.lineTo(-10,6);ctx.closePath();ctx.fill();
      ctx.fillStyle='rgba(0,0,0,0.5)';ctx.beginPath();ctx.arc(7,0,2,0,Math.PI*2);ctx.fill();
      ctx.restore();break;
    case 'franc':
      ctx.fillStyle=color;ctx.save();ctx.scale(spin,1);
      ctx.beginPath();ctx.arc(0,0,11,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#A07800';ctx.beginPath();ctx.arc(0,0,7,0,Math.PI*2);ctx.fill();
      ctx.fillStyle=color;ctx.font='bold 9px monospace';ctx.textAlign='center';ctx.fillText('Fr',0,3);
      ctx.restore();break;
    case 'berry':
      ctx.fillStyle=color;ctx.beginPath();ctx.arc(0,0,9,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='rgba(255,255,255,0.35)';ctx.beginPath();ctx.arc(-3,-3,4,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#205010';ctx.fillRect(-1,-10,2,5);break;
  }
  ctx.restore();
}

// ── Hiker (player) ────────────────────────────────────────────────────────────
function drawHiker(ctx:CanvasRenderingContext2D,x:number,y:number,duck:boolean,t:number,jumping:boolean,spd:number){
  const run=!duck&&!jumping;
  const leg=run?Math.sin(t*0.28)*10:0;
  const arm=run?Math.sin(t*0.28+Math.PI)*9:0;

  ctx.save();ctx.translate(x+14,y+6);
  if(duck) ctx.scale(1,0.65);

  // backpack
  ctx.fillStyle='#E05020';ctx.fillRect(2,4,10,20);ctx.fillRect(4,2,6,4);

  // body
  ctx.fillStyle='#4080D0';ctx.fillRect(-10,4,22,24);

  // head
  ctx.fillStyle='#F8C870';ctx.beginPath();ctx.arc(0,-4,11,0,Math.PI*2);ctx.fill();
  // hat
  ctx.fillStyle='#C04020';ctx.fillRect(-10,-14,20,8);ctx.fillRect(-7,-20,14,8);

  // arms
  ctx.fillStyle='#F8C870';
  ctx.fillRect(-12,6+arm,6,18);ctx.fillRect(8,6-arm,6,18);
  // walking poles (optional, drawn as sticks)
  ctx.strokeStyle='#A0A0A0';ctx.lineWidth=2;
  if(run||jumping){ctx.beginPath();ctx.moveTo(-6,22+arm);ctx.lineTo(-18,42);ctx.stroke();}

  // legs
  ctx.fillStyle='#303080';
  ctx.fillRect(-10,28+leg,10,20);ctx.fillRect(2,28-leg,10,20);
  ctx.fillStyle='#404040';
  ctx.fillRect(-12,44+leg,12,8);ctx.fillRect(1,44-leg,12,8);

  ctx.restore();
}
