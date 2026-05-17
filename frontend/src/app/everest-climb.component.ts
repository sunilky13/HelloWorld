import {
  Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, HostListener
} from '@angular/core';

const CW = 800, CH = 500, WORLD_H = 6000;
const GRAV = 0.55, JUMP_V = -13, MOVE_SPD = 3.5, CLIMB_SPD = 2.5;
const PLAYER_W = 20, PLAYER_H = 50;

interface Plat  { x: number; wy: number; w: number; h: number; type: 'rock'|'snow'|'ice'|'camp'; }
interface Ladder { x: number; wy: number; w: number; h: number; }
interface Wall   { x: number; wy: number; w: number; h: number; hpts: number[]; }
interface Spike  { x: number; wy: number; w: number; }
interface Camp   { x: number; wy: number; }

@Component({
  selector: 'app-everest-climb',
  standalone: true,
  imports: [],
  templateUrl: './everest-climb.component.html',
  styleUrl:    './everest-climb.component.css'
})
export class EverestClimbComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  state: 'start'|'playing'|'dead'|'win' = 'start';
  deathReason = '';
  lastLevel = 1;
  keys = new Set<string>();

  private ctx!: CanvasRenderingContext2D;
  private raf = 0;
  private lastTs = 0;

  // player state
  private px = 200; private pwy = 5900; private pvx = 0; private pvy = 0;
  private onGround = false; private onLadder = false; private onWall = false;
  private animT = 0; private facingR = true;
  private health = 100; private water = 100; private oxygen = 100;
  private drainTimer = 0;
  private invincible = 0;

  // world
  private plats: Plat[] = [];
  private ladders: Ladder[] = [];
  private walls: Wall[] = [];
  private spikes: Spike[] = [];
  private camps: Camp[] = [];
  private particles: {x:number;y:number;vx:number;vy:number;alpha:number;c:string}[] = [];

  private get cameraTop() {
    return Math.max(0, Math.min(this.pwy - CH * 0.65, WORLD_H - CH));
  }
  private sy(wy: number) { return wy - this.cameraTop; }

  get currentLevel() { return Math.min(20, Math.max(1, Math.floor((WORLD_H - this.pwy) / 300) + 1)); }

  @HostListener('window:keydown', ['$event'])
  onKD(e: KeyboardEvent) {
    this.keys.add(e.code);
    if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
    if (this.state === 'start' || this.state === 'dead') {
      if (['Space','Enter'].includes(e.code)) this.startGame();
    }
  }
  @HostListener('window:keyup', ['$event'])
  onKU(e: KeyboardEvent) { this.keys.delete(e.code); }

  ngAfterViewInit() {
    this.ctx = this.canvasRef.nativeElement.getContext('2d')!;
    this.drawStart();
  }
  ngOnDestroy() { cancelAnimationFrame(this.raf); }

  startGame() {
    cancelAnimationFrame(this.raf);
    this.px = 200; this.pwy = 5900; this.pvx = 0; this.pvy = 0;
    this.onGround = false; this.onLadder = false; this.onWall = false;
    this.health = 100; this.water = 100; this.oxygen = 100;
    this.drainTimer = 0; this.invincible = 0; this.animT = 0;
    this.particles = [];
    this.generateWorld();
    this.state = 'playing';
    this.lastTs = performance.now();
    this.raf = requestAnimationFrame(ts => this.loop(ts));
  }

  // ── World generation ─────────────────────────────────────────────────────

  private generateWorld() {
    this.plats = []; this.ladders = []; this.walls = []; this.spikes = []; this.camps = [];

    // Ground floor at base
    this.plats.push({ x:0, wy:5960, w:800, h:80, type:'rock' });

    // Zone helpers
    const spike = (x:number, wy:number) => this.spikes.push({ x, wy, w:30 });
    const ladder = (x:number, wy:number, h:number) => this.ladders.push({ x, wy, w:22, h });
    const wall = (x:number, wy:number, h:number) => {
      const hpts: number[] = [];
      for (let i = 70; i < h; i += 70) hpts.push(wy + i);
      this.walls.push({ x, wy, w:55, h, hpts });
    };
    const camp = (x:number, wy:number) => {
      this.camps.push({ x, wy });
      this.plats.push({ x:x-20, wy, w:180, h:18, type:'camp' });
    };
    const plat = (x:number, wy:number, w:number, type:'rock'|'snow'|'ice'='rock') =>
      this.plats.push({ x, wy, w, h:16, type });

    // ── Zone 0: Base approach (5200–5900) ──
    plat(50,  5800, 180); plat(300, 5720, 160); plat(550, 5660, 150);
    plat(100, 5580, 140); plat(450, 5500, 130); plat(620, 5440, 120);
    camp(300, 5360);
    ladder(340, 5360, 160); ladder(570, 5440, 140);
    spike(150, 5798); spike(480, 5718);

    // ── Zone 1: Lower slopes (4200–5200) ──
    plat(80,  5280, 130,'snow'); plat(300, 5200, 120,'snow'); plat(520, 5130, 110,'snow');
    plat(150, 5060, 120,'snow'); plat(400, 4990, 110,'snow'); plat(600, 4920,'snow' as any, 100 as any);
    plat(600, 4920, 100,'snow');
    plat(250, 4840, 110,'snow'); plat(480, 4780, 100,'snow');
    camp(150, 4700);
    ladder(180, 4700, 180); ladder(490, 4780, 160); wall(540, 5130, 210);
    spike(320, 5198); spike(540, 5128); spike(100, 5058); spike(420, 4988);

    // ── Zone 2: Camp II zone (3200–4200) ──
    plat(50,  4620, 110,'ice'); plat(280, 4540, 100,'ice'); plat(510, 4460, 95,'ice');
    plat(160, 4380, 100,'ice'); plat(390, 4300, 90,'ice'); plat(580, 4220,'ice' as any, 85 as any);
    plat(580, 4220, 85,'ice');
    plat(80,  4140, 95,'ice'); plat(320, 4060, 90,'ice');
    camp(430, 3980);
    ladder(100, 4140, 180); ladder(450, 4060, 170); wall(240, 4540, 250);
    spike(290, 4538); spike(520, 4458); spike(170, 4378); spike(400, 4298); spike(590, 4218);

    // ── Zone 3: Upper mountain (2000–3200) ──
    plat(100, 3900, 90,'ice'); plat(310, 3820, 85,'ice'); plat(530, 3750, 80,'ice');
    plat(180, 3670, 85,'ice'); plat(420, 3600, 80,'ice'); plat(600, 3530, 75,'ice');
    camp(200, 3450);
    plat(80,  3370, 80,'ice'); plat(350, 3290, 75,'ice'); plat(570, 3210,'ice' as any, 70 as any);
    plat(570, 3210, 70,'ice');
    plat(140, 3130, 80,'ice'); plat(380, 3060,'ice' as any, 75 as any);
    plat(380, 3060, 75,'ice');
    ladder(230, 3450, 190); ladder(590, 3210, 180); wall(470, 3750, 270); wall(90, 3370, 230);
    spike(320, 3818); spike(540, 3748); spike(190, 3668); spike(430, 3598); spike(610, 3528); spike(90, 3368);

    // ── Zone 4: Death zone (800–2000) ──
    plat(120, 2980, 75,'snow'); plat(340, 2900, 70,'snow'); plat(560, 2830, 65,'snow');
    plat(180, 2750, 70,'snow'); plat(400, 2680, 65,'snow'); plat(590, 2610,'snow' as any, 60 as any);
    plat(590, 2610, 60,'snow');
    camp(280, 2530);
    plat(100, 2450, 65,'snow'); plat(360, 2370, 60,'snow'); plat(570, 2300,'snow' as any, 55 as any);
    plat(570, 2300, 55,'snow');
    plat(160, 2220, 65,'snow'); plat(400, 2150,'snow' as any, 60 as any);
    plat(400, 2150, 60,'snow');
    ladder(300, 2530, 200); ladder(580, 2300, 190); ladder(180, 2220, 180);
    wall(510, 2830, 270); wall(320, 2450, 250);
    for (const [x,wy] of [[350,2898],[570,2828],[190,2748],[410,2678],[600,2608],[110,2448],[370,2368],[580,2298],[170,2218],[410,2148]]) spike(x,wy);

    // ── Zone 5: Summit push (0–800) ──
    plat(100, 2070, 60,'snow'); plat(330, 1990, 55,'snow'); plat(540, 1920,'snow' as any, 50 as any);
    plat(540, 1920, 50,'snow');
    camp(200, 1840);
    plat(80,  1760, 55,'snow'); plat(320, 1680, 50,'snow'); plat(530, 1610,'snow' as any, 45 as any);
    plat(530, 1610, 45,'snow');
    plat(150, 1530, 55,'snow'); plat(380, 1450,'snow' as any, 50 as any);
    plat(380, 1450, 50,'snow');
    plat(560, 1370, 45,'snow'); plat(120, 1290, 50,'snow'); plat(350, 1210,'snow' as any, 45 as any);
    plat(350, 1210, 45,'snow');
    plat(540, 1140, 45,'snow'); plat(160, 1060, 50,'snow'); plat(370, 980,'snow' as any, 45 as any);
    plat(370, 980, 45,'snow');
    plat(550, 910, 45,'snow'); plat(130, 830, 50,'snow'); plat(360, 760,'snow' as any, 45 as any);
    plat(360, 760, 45,'snow');
    plat(540, 690, 50,'snow'); plat(150, 620, 55,'snow');
    ladder(220, 1840, 190); ladder(550, 1610, 180); ladder(200, 1290, 170); ladder(370, 910, 160);
    wall(480, 1920, 230); wall(290, 1530, 220); wall(500, 1140, 210);
    for (const [x,wy] of [[340,1988],[550,1918],[330,1678],[540,1608],[160,1528],[390,1448],[570,1368],[130,1288],[360,1208],[550,1138],[170,1058],[380,978],[560,908],[140,828],[370,758],[550,688]]) spike(x,wy);

    // Summit platform
    this.plats.push({ x:280, wy:100, w:240, h:20, type:'snow' });
  }

  // ── Game loop ────────────────────────────────────────────────────────────

  private loop(ts: number) {
    const dt = Math.min((ts - this.lastTs) / 16.67, 3);
    this.lastTs = ts;
    this.update(dt);
    this.render();
    if (this.state === 'playing') this.raf = requestAnimationFrame(t => this.loop(t));
  }

  private update(dt: number) {
    const K = this.keys;
    this.animT += dt;
    if (this.invincible > 0) this.invincible -= dt;

    // Resource drain
    this.drainTimer += dt;
    if (this.drainTimer >= 10) {
      this.drainTimer -= 10;
      this.water  = Math.max(0, this.water  - 0.35);
      const oxyDrain = this.pwy < 3000 ? 0.7 : 0.18;
      this.oxygen = Math.max(0, this.oxygen - oxyDrain);
      this.health = Math.max(0, this.health - 0.08);
      if (this.water  <= 0) { this.die('Dehydrated — bring more water next time'); return; }
      if (this.oxygen <= 0) { this.die('Ran out of oxygen at high altitude');        return; }
      if (this.health <= 0) { this.die('Exhaustion claimed the climber');             return; }
    }

    // Campsite refill
    if (K.has('KeyE') || K.has('KeyF')) {
      for (const c of this.camps) {
        if (Math.abs(this.px - (c.x + 70)) < 100 && Math.abs(this.pwy + PLAYER_H - c.wy) < 80) {
          this.health = Math.min(100, this.health + 2 * dt);
          this.water  = Math.min(100, this.water  + 3 * dt);
          this.oxygen = Math.min(100, this.oxygen + 3 * dt);
          this.burst(c.x + 70, c.wy, '#fbbf24', 1);
        }
      }
    }

    // Horizontal movement
    if (!this.onWall) {
      if (K.has('ArrowLeft') || K.has('KeyA'))  { this.pvx = -MOVE_SPD; this.facingR = false; }
      else if (K.has('ArrowRight') || K.has('KeyD')) { this.pvx =  MOVE_SPD; this.facingR = true;  }
      else this.pvx = 0;
    } else this.pvx = 0;

    // Ladder logic
    const onAnyLadder = this.ladders.some(l =>
      this.px > l.x - 5 && this.px < l.x + l.w + 5 &&
      this.pwy + PLAYER_H > l.wy && this.pwy < l.wy + l.h);
    if (onAnyLadder && (K.has('ArrowUp') || K.has('KeyW'))) this.onLadder = true;
    if (!onAnyLadder) this.onLadder = false;
    if (this.onLadder && (K.has('Space'))) { this.onLadder = false; this.pvy = JUMP_V; }
    if (this.onLadder) {
      this.pvy = 0;
      if (K.has('ArrowUp')   || K.has('KeyW')) this.pwy -= CLIMB_SPD * dt * 16;
      if (K.has('ArrowDown') || K.has('KeyS')) this.pwy += CLIMB_SPD * dt * 16;
    }

    // Wall climbing
    if (!this.onWall) {
      for (const w of this.walls) {
        if ((K.has('ArrowUp') || K.has('KeyW')) &&
            this.px + 10 >= w.x && this.px - 10 <= w.x + w.w &&
            this.pwy + 10 >= w.wy && this.pwy + PLAYER_H <= w.wy + w.h + 30) {
          this.onWall = true; this.pvy = 0; break;
        }
      }
    }
    if (this.onWall) {
      this.pvx = 0; this.pvy = 0;
      if (K.has('ArrowUp')   || K.has('KeyW')) this.pwy -= CLIMB_SPD * dt * 14;
      if (K.has('ArrowDown') || K.has('KeyS')) this.pwy += CLIMB_SPD * dt * 14;
      if (K.has('Space')) { this.onWall = false; this.pvy = JUMP_V * 0.6; }
      const stillOnWall = this.walls.some(w =>
        this.px + 10 >= w.x && this.px - 10 <= w.x + w.w &&
        this.pwy + 10 >= w.wy && this.pwy + PLAYER_H <= w.wy + w.h + 30);
      if (!stillOnWall) this.onWall = false;
    }

    // Jump
    if (!this.onLadder && !this.onWall) {
      if ((K.has('Space') || K.has('ArrowUp') || K.has('KeyW')) && this.onGround) {
        this.pvy = JUMP_V; this.onGround = false;
      }
      // Gravity
      this.pvy = Math.min(this.pvy + GRAV * dt, 22);
      this.pwy += this.pvy * dt;
    }

    this.px += this.pvx * dt;
    this.px = Math.max(10, Math.min(CW - 10, this.px));

    // Platform collision
    this.onGround = false;
    const prevLandVy = this.pvy;
    for (const p of this.plats) {
      if (this.px + 8 > p.x && this.px - 8 < p.x + p.w) {
        const pBot = this.pwy + PLAYER_H;
        if (pBot >= p.wy && pBot <= p.wy + p.h + Math.abs(this.pvy) + 2 && this.pvy >= 0) {
          this.pwy = p.wy - PLAYER_H;
          if (prevLandVy > 16 && this.invincible <= 0) {
            this.health = Math.max(0, this.health - 20);
            if (this.health <= 0) { this.die('Fatal fall'); return; }
          }
          this.pvy = 0; this.onGround = true;
        }
      }
    }

    // Spike collision
    if (this.invincible <= 0) {
      for (const s of this.spikes) {
        const sy = s.wy;
        if (Math.abs(this.px - (s.x + 15)) < 20 && this.pwy + PLAYER_H > sy - 20 && this.pwy + PLAYER_H < sy + 5) {
          this.health = Math.max(0, this.health - 25);
          this.invincible = 1.5;
          this.pvy = JUMP_V * 0.6;
          this.burst(this.px, this.pwy + 30, '#ef4444', 8);
          if (this.health <= 0) { this.die('Impaled on an ice spike'); return; }
        }
      }
    }

    // Fall off world
    if (this.pwy > WORLD_H) { this.die('Fell off the mountain'); return; }

    // Particles
    for (const p of this.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.1 * dt; p.alpha -= 0.02 * dt; }
    this.particles = this.particles.filter(p => p.alpha > 0);

    // Win condition
    if (this.pwy < 150 && this.pwy + PLAYER_H > 100 && this.px > 280 && this.px < 520) {
      this.state = 'win';
    }
  }

  private die(reason: string) {
    this.lastLevel = this.currentLevel;
    this.deathReason = reason;
    this.state = 'dead';
    cancelAnimationFrame(this.raf);
  }

  private burst(x: number, y: number, c: string, n: number) {
    for (let i = 0; i < n; i++) this.particles.push({
      x, y, vx: (Math.random()-.5)*7, vy: (Math.random()-.5)*7-2,
      alpha: 1, c
    });
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  private render() {
    const c = this.ctx;
    this.drawBg(c);
    this.drawWorld(c);
    this.drawParticles(c);
    this.drawPlayer(c);
    this.drawFog(c);
    this.drawHUD(c);
    if (this.state === 'win') this.drawTrophy(c);
  }

  private drawStart() {
    const c = this.ctx;
    const sky = c.createLinearGradient(0,0,0,CH);
    sky.addColorStop(0,'#87CEEB'); sky.addColorStop(1,'#C9D6E3');
    c.fillStyle = sky; c.fillRect(0,0,CW,CH);
    c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(0,0,CW,CH);
  }

  private drawBg(c: CanvasRenderingContext2D) {
    const mid = this.cameraTop + CH / 2;
    const zone = Math.min(4, Math.floor((WORLD_H - mid) / 1200));
    const skies = [
      ['#87CEEB','#C9D6E3'], ['#A8C8E0','#D4E6F1'],
      ['#C5D8E8','#E8F0F8'], ['#D0E4F0','#EDF5FA'],
      ['#E8F2F8','#FFF9F0']
    ];
    const [s1,s2] = skies[Math.max(0,zone)];
    const sky = c.createLinearGradient(0,0,0,CH);
    sky.addColorStop(0,s1); sky.addColorStop(1,s2);
    c.fillStyle = sky; c.fillRect(0,0,CW,CH);

    // Mountain silhouettes in background
    c.fillStyle = zone >= 3 ? 'rgba(200,220,240,0.4)' : 'rgba(150,160,170,0.35)';
    const peaks = [[0,350],[100,220],[200,270],[320,190],[440,240],[560,180],[680,230],[800,260]];
    c.beginPath(); c.moveTo(0,CH);
    for (let i=0;i<peaks.length-1;i++) {
      const [x1,y1]=peaks[i], [x2,y2]=peaks[i+1];
      c.lineTo(x1,y1); c.lineTo((x1+x2)/2,y2);
    }
    c.lineTo(800,CH); c.closePath(); c.fill();
    if (zone >= 2) {
      c.fillStyle = 'rgba(255,255,255,0.5)';
      for (const [px,py] of peaks.slice(1,-1)) {
        c.beginPath(); c.moveTo(px-25,py+30); c.lineTo(px,py); c.lineTo(px+25,py+30); c.fill();
      }
    }
  }

  private drawWorld(c: CanvasRenderingContext2D) {
    const ct = this.cameraTop;
    const vis = (wy:number, h=20) => this.sy(wy) < CH+50 && this.sy(wy)+h > -50;

    // Platforms
    for (const p of this.plats) {
      if (!vis(p.wy, p.h+60)) continue;
      const sy = this.sy(p.wy);
      const cols = { rock:['#6B7280','#4B5563'], snow:['#E5E7EB','#D1D5DB'], ice:['#93C5FD','#60A5FA'], camp:['#A7F3D0','#6EE7B7'] };
      const [fill,stroke] = cols[p.type];
      c.fillStyle = fill; c.strokeStyle = stroke; c.lineWidth = 1.5;
      c.beginPath(); c.roundRect(p.x, sy, p.w, p.h, 3); c.fill(); c.stroke();
      if (p.type === 'snow') {
        c.fillStyle = '#fff';
        for (let bx = p.x+8; bx < p.x+p.w-8; bx += 18) {
          c.beginPath(); c.arc(bx, sy, 5, Math.PI, 0); c.fill();
        }
      }
      if (p.type === 'camp') {
        // Tent
        const tx = p.x + p.w/2;
        c.fillStyle = '#f97316';
        c.beginPath(); c.moveTo(tx,sy-30); c.lineTo(tx-22,sy); c.lineTo(tx+22,sy); c.closePath(); c.fill();
        c.fillStyle = '#ea580c';
        c.beginPath(); c.moveTo(tx,sy-30); c.lineTo(tx-22,sy); c.lineTo(tx,sy-10); c.closePath(); c.fill();
        c.strokeStyle='#fff'; c.lineWidth=1;
        c.beginPath(); c.moveTo(tx-8,sy); c.lineTo(tx-8,sy-16); c.stroke();
        c.fillStyle='rgba(255,150,50,0.5)'; c.beginPath(); c.arc(tx-4,sy-4,6,0,Math.PI*2); c.fill();
        // CAMP label
        c.fillStyle='#fff'; c.font='bold 10px sans-serif'; c.textAlign='center';
        c.fillText('CAMP',tx,sy-36);
      }
    }

    // Ladders
    for (const l of this.ladders) {
      if (!vis(l.wy, l.h)) continue;
      const sy = this.sy(l.wy);
      c.strokeStyle='#92400E'; c.lineWidth=3;
      c.beginPath(); c.moveTo(l.x+2, sy); c.lineTo(l.x+2, sy+l.h); c.stroke();
      c.beginPath(); c.moveTo(l.x+l.w-2, sy); c.lineTo(l.x+l.w-2, sy+l.h); c.stroke();
      c.strokeStyle='#B45309'; c.lineWidth=2;
      for (let ry=sy+20; ry<sy+l.h-10; ry+=25) {
        c.beginPath(); c.moveTo(l.x+2,ry); c.lineTo(l.x+l.w-2,ry); c.stroke();
      }
    }

    // Rock walls
    for (const w of this.walls) {
      if (!vis(w.wy, w.h)) continue;
      const sy = this.sy(w.wy);
      c.fillStyle='#57534E';
      c.beginPath(); c.roundRect(w.x, sy, w.w, w.h, 4); c.fill();
      c.strokeStyle='#44403C'; c.lineWidth=1;
      for (let i=0;i<5;i++) {
        c.beginPath(); c.moveTo(w.x+Math.random()*w.w,sy+i*w.h/5);
        c.lineTo(w.x+Math.random()*w.w,sy+(i+1)*w.h/5); c.stroke();
      }
      for (const hy of w.hpts) {
        const hsy = this.sy(hy);
        c.fillStyle='#ef4444'; c.strokeStyle='#fff'; c.lineWidth=1.5;
        c.beginPath(); c.arc(w.x+w.w/2, hsy, 7, 0, Math.PI*2); c.fill(); c.stroke();
        c.strokeStyle='#fff'; c.lineWidth=2;
        c.beginPath(); c.moveTo(w.x+w.w/2-4,hsy); c.lineTo(w.x+w.w/2+4,hsy);
        c.moveTo(w.x+w.w/2,hsy-4); c.lineTo(w.x+w.w/2,hsy+4); c.stroke();
      }
      if (this.onWall) {
        const nearest = w.hpts.reduce((a,b) => Math.abs(a-this.pwy) < Math.abs(b-this.pwy) ? a : b, w.hpts[0]);
        if (nearest) {
          c.strokeStyle='rgba(74,222,128,0.8)'; c.lineWidth=2; c.setLineDash([4,4]);
          c.beginPath(); c.moveTo(this.px, this.sy(this.pwy+20));
          c.lineTo(w.x+w.w/2, this.sy(nearest)); c.stroke();
          c.setLineDash([]);
        }
      }
    }

    // Spikes
    for (const s of this.spikes) {
      if (!vis(s.wy, 30)) continue;
      const sy = this.sy(s.wy);
      for (let i=0;i<3;i++) {
        c.fillStyle='#BAE6FD'; c.strokeStyle='#7DD3FC'; c.lineWidth=1;
        c.beginPath();
        c.moveTo(s.x+i*12, sy); c.lineTo(s.x+6+i*12, sy-22); c.lineTo(s.x+12+i*12, sy);
        c.closePath(); c.fill(); c.stroke();
        c.fillStyle='rgba(255,255,255,0.5)';
        c.beginPath(); c.moveTo(s.x+6+i*12,sy-20); c.lineTo(s.x+8+i*12,sy-10); c.lineTo(s.x+6+i*12,sy-6); c.closePath(); c.fill();
      }
    }

    // Summit marker
    const sumSY = this.sy(80);
    if (sumSY > -50 && sumSY < CH+50) {
      c.fillStyle='rgba(255,200,0,0.3)'; c.beginPath(); c.arc(400,sumSY,40,0,Math.PI*2); c.fill();
      c.fillStyle='#F59E0B'; c.font='bold 14px sans-serif'; c.textAlign='center';
      c.fillText('⛰️ SUMMIT',400,sumSY-50);
    }
  }

  private drawPlayer(c: CanvasRenderingContext2D) {
    const cx = this.px, cy = this.sy(this.pwy);
    const t = this.animT;
    const walking = Math.abs(this.pvx) > 0.1 || this.onLadder || this.onWall;
    const ls = walking ? Math.sin(t*.35)*12 : 0;
    const as = walking ? Math.sin(t*.35)*10 : -4;
    const flash = this.invincible > 0 && Math.floor(this.animT*4)%2 === 0;
    if (flash) return;

    c.save(); c.lineCap='round'; c.lineJoin='round';

    // Shadow
    c.fillStyle='rgba(0,0,0,0.12)';
    c.beginPath(); c.ellipse(cx, cy+PLAYER_H+2, 10, 3, 0, 0, Math.PI*2); c.fill();

    // Head
    c.beginPath(); c.arc(cx, cy+9, 9, 0, Math.PI*2);
    c.fillStyle='#fde68a'; c.fill(); c.strokeStyle='#92400e'; c.lineWidth=1.2; c.stroke();

    // Goggles
    c.fillStyle='#fed7aa'; c.fillRect(cx-8, cy+6, 16, 6);
    c.fillStyle='#f97316'; c.beginPath(); c.ellipse(cx-3,cy+9,5,4,0,0,Math.PI*2); c.fill();
    c.fillStyle='#f97316'; c.beginPath(); c.ellipse(cx+3,cy+9,5,4,0,0,Math.PI*2); c.fill();

    // Helmet
    c.fillStyle='#1e3a5f';
    c.beginPath(); c.arc(cx, cy+3, 10, Math.PI, 0); c.fill();
    c.beginPath(); c.roundRect(cx-11, cy+2, 22, 5, 2); c.fill();

    // Jacket (dark blue)
    c.fillStyle='#1e40af';
    c.beginPath(); c.roundRect(cx-8, cy+18, 16, 15, 3); c.fill();

    // Backpack
    c.fillStyle='#374151';
    c.beginPath(); c.roundRect(cx + (this.facingR?-14:-2), cy+18, 10, 16, 2); c.fill();
    c.fillStyle='#06b6d4';
    c.fillRect(cx + (this.facingR?-11:-1), cy+18, 4, 5);

    // Body
    c.strokeStyle='#1e40af'; c.lineWidth=2.5;
    c.beginPath(); c.moveTo(cx,cy+33); c.lineTo(cx,cy+38); c.stroke();

    // Arms
    c.strokeStyle='#fde68a'; c.lineWidth=2.5;
    c.beginPath();
    c.moveTo(cx,cy+22); c.lineTo(cx-10+as, cy+32);
    c.moveTo(cx,cy+22); c.lineTo(cx+10-as, cy+32);
    c.stroke();
    c.fillStyle='#e5e7eb';
    c.beginPath(); c.arc(cx-10+as, cy+32, 3, 0, Math.PI*2); c.fill();
    c.beginPath(); c.arc(cx+10-as, cy+32, 3, 0, Math.PI*2); c.fill();

    // Legs
    c.strokeStyle='#1e3a5f'; c.lineWidth=3;
    c.beginPath();
    c.moveTo(cx,cy+38); c.lineTo(cx-8+ls, cy+50);
    c.moveTo(cx,cy+38); c.lineTo(cx+8-ls, cy+50);
    c.stroke();
    // Boots
    c.fillStyle='#292524';
    c.beginPath(); c.ellipse(cx-8+ls,cy+51,7,4,0,0,Math.PI*2); c.fill();
    c.beginPath(); c.ellipse(cx+8-ls,cy+51,7,4,0,0,Math.PI*2); c.fill();

    // Harness when on wall
    if (this.onWall) {
      c.strokeStyle='#4ade80'; c.lineWidth=2;
      c.beginPath(); c.moveTo(cx-8,cy+22); c.lineTo(cx+8,cy+22);
      c.moveTo(cx,cy+22); c.lineTo(cx,cy+33); c.stroke();
    }

    c.restore();
  }

  private drawParticles(c: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      c.save(); c.globalAlpha = Math.max(0, p.alpha);
      c.fillStyle = p.c; c.beginPath(); c.arc(p.x, p.y, 4, 0, Math.PI*2); c.fill();
      c.restore();
    }
  }

  private drawFog(c: CanvasRenderingContext2D) {
    if (this.pwy >= 3500) return;
    const fogOpacity = Math.min(0.52, (3500 - this.pwy) / 3500 * 0.55);
    c.fillStyle = `rgba(220,235,248,${fogOpacity})`;
    c.fillRect(0, 0, CW, CH);
    // Wisps
    const wt = this.animT * 0.005;
    c.fillStyle = `rgba(255,255,255,${fogOpacity*0.4})`;
    for (let i=0;i<5;i++) {
      const wx = ((i*180 + wt*60) % (CW+200)) - 100;
      const wy = 80 + i*60 + Math.sin(wt+i)*30;
      c.beginPath(); c.ellipse(wx, wy, 120, 30, 0, 0, Math.PI*2); c.fill();
    }
  }

  private drawHUD(c: CanvasRenderingContext2D) {
    // Resource panel
    c.fillStyle='rgba(0,0,0,0.5)'; c.beginPath(); c.roundRect(10,10,210,82,8); c.fill();

    const bar = (label:string, val:number, y:number, col:string) => {
      c.fillStyle='rgba(255,255,255,0.7)'; c.font='10px sans-serif'; c.textAlign='left';
      c.fillText(label, 18, y-2);
      c.fillStyle='rgba(0,0,0,0.4)'; c.beginPath(); c.roundRect(60,y-9,148,11,4); c.fill();
      c.fillStyle=col; c.beginPath(); c.roundRect(60,y-9,148*(val/100),11,4); c.fill();
    };
    bar('❤ HP',  this.health, 30, '#ef4444');
    bar('💧 H₂O', this.water,  50, '#60a5fa');
    bar('🫁 O₂',  this.oxygen, 70, '#34d399');

    // Level + altitude
    c.fillStyle='rgba(0,0,0,0.5)'; c.beginPath(); c.roundRect(CW-160,10,150,44,8); c.fill();
    c.fillStyle='#fff'; c.font='bold 13px sans-serif'; c.textAlign='left';
    c.fillText(`Level ${this.currentLevel} / 20`, CW-148, 29);
    const alt = Math.round((WORLD_H - this.pwy) / WORLD_H * 8849);
    c.font='11px sans-serif'; c.fillStyle='rgba(255,255,255,0.8)';
    c.fillText(`Alt: ${alt}m`, CW-148, 47);

    // Campsite hint
    const nearCamp = this.camps.some(camp =>
      Math.abs(this.px - (camp.x+70)) < 100 &&
      Math.abs(this.pwy + PLAYER_H - camp.wy) < 80);
    if (nearCamp) {
      c.fillStyle='rgba(0,0,0,0.6)'; c.beginPath(); c.roundRect(CW/2-80, CH-42, 160, 30, 8); c.fill();
      c.fillStyle='#fbbf24'; c.font='bold 12px sans-serif'; c.textAlign='center';
      c.fillText('Press E to refill resources', CW/2, CH-22);
    }
  }

  private drawTrophy(c: CanvasRenderingContext2D) {
    const tx = CW/2, ty = CH/2 - 30;
    c.fillStyle='rgba(0,0,0,0.7)'; c.fillRect(0,0,CW,CH);

    c.save(); c.translate(tx, ty);

    // Glow
    c.shadowColor='#F59E0B'; c.shadowBlur=40;

    // Cup body
    const cup = c.createLinearGradient(-45,0,45,0);
    cup.addColorStop(0,'#F59E0B'); cup.addColorStop(0.5,'#FBBF24'); cup.addColorStop(1,'#D97706');
    c.fillStyle=cup;
    c.beginPath(); c.moveTo(-45,-60); c.lineTo(-50,10); c.quadraticCurveTo(-45,30,-5,35);
    c.lineTo(5,35); c.quadraticCurveTo(45,30,50,10); c.lineTo(45,-60); c.closePath(); c.fill();

    // Cup top rim
    c.fillStyle='#FBBF24';
    c.beginPath(); c.ellipse(0,-60,50,12,0,0,Math.PI*2); c.fill();

    // Handles
    c.strokeStyle='#F59E0B'; c.lineWidth=8; c.fillStyle='rgba(0,0,0,0)';
    c.beginPath(); c.arc(-58,-20,20,0.4*Math.PI,1.6*Math.PI,true); c.stroke();
    c.beginPath(); c.arc(58,-20,20,-0.4*Math.PI,0.6*Math.PI,true); c.stroke();

    // Stem
    c.fillStyle='#D97706';
    c.beginPath(); c.roundRect(-12,35,24,25,3); c.fill();

    // Base
    c.fillStyle=cup;
    c.beginPath(); c.roundRect(-40,60,80,18,4); c.fill();
    c.strokeStyle='#D97706'; c.lineWidth=2; c.stroke();

    // Star
    c.fillStyle='#fff'; c.shadowBlur=8; c.shadowColor='#fff';
    c.font='bold 22px sans-serif'; c.textAlign='center'; c.fillText('★',0,-15);

    c.shadowBlur=0;
    c.fillStyle='#fff'; c.font='bold 18px sans-serif';
    c.fillText('SUMMIT REACHED!',0,110);
    c.font='14px sans-serif'; c.fillStyle='rgba(255,255,255,0.85)';
    c.fillText('You conquered Everest!',0,133);

    c.restore();
  }
}
