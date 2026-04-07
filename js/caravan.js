// Caravan - caravans, guards, and wave spawning

import { Vec2, CONST, clamp, randRange, randInt } from './utils.js';

// Caravan types
export const CaravanType = {
  DONKEY: 'donkey',
  WAGON: 'wagon',
  ROYAL: 'royal',
};

const CARAVAN_DEFS = {
  [CaravanType.DONKEY]: {
    speed: CONST.DONKEY_SPEED,
    radius: 14,
    lootMin: 10,
    lootMax: 25,
    guardCount: 1,
    hp: 30,
    label: 'Осёл',
  },
  [CaravanType.WAGON]: {
    speed: CONST.WAGON_SPEED,
    radius: 18,
    lootMin: 30,
    lootMax: 60,
    guardCount: 2,
    hp: 60,
    label: 'Телега',
  },
  [CaravanType.ROYAL]: {
    speed: CONST.ROYAL_SPEED,
    radius: 22,
    lootMin: 80,
    lootMax: 150,
    guardCount: 3,
    hp: 100,
    label: 'Карета',
  },
};

// Guard AI states
const GuardState = {
  PATROL: 'patrol',
  CHASE: 'chase',
  RETURN: 'return',
};

// Pixel-art sprites

const GUARD_PALETTE = {
  'H': '#34495e', // helmet
  'h': '#2c3e50', // helmet dark
  'F': '#d4a574', // face
  'E': '#1a1a1a', // eyes
  'A': '#7f8c8d', // armor
  'a': '#636e72', // armor dark
  'P': '#4a4a5a', // pants
  'p': '#3a3a4a', // pants dark
  'S': '#5a4a3a', // shoes
  'W': '#bdc3c7', // weapon (sword)
};

const GUARD_SPRITE = [
  ' .HHH. ',
  ' hhhhh ',
  ' .FEF. ',
  ' AAAAA ',
  ' aAAAa ',
  ' .AAA. ',
  ' .PPP. ',
  ' pP.Pp ',
  ' SS.SS ',
];

const GUARD_WALK_1 = [
  ' .HHH. ',
  ' hhhhh ',
  ' .FEF. ',
  'WAAAAA ',
  ' aAAAa ',
  ' .AAA. ',
  ' .PPP. ',
  ' pP..P ',
  ' SS..S ',
];

const GUARD_WALK_2 = [
  ' .HHH. ',
  ' hhhhh ',
  ' .FEF. ',
  ' AAAAAW',
  ' aAAAa ',
  ' .AAA. ',
  ' .PPP. ',
  ' P..Pp ',
  ' S..SS ',
];

// Caravan sprites - viewed from the side
const DONKEY_PALETTE = {
  'B': '#8B7355', // body
  'b': '#6B5335', // body dark
  'H': '#7B6345', // head
  'E': '#1a1a1a', // eye
  'L': '#5a4a3a', // legs
  'T': '#4a3a2a', // tail
  'S': '#a08060', // saddle/pack
  's': '#806040', // saddle dark
};

const DONKEY_SPRITE = [
  ' ..SS.. ',
  ' .SssS. ',
  'H.BBBB.',
  'HE.BBB.',
  '..bBBb..',
  '..L..L..',
  '..L..L..',
];

const WAGON_PALETTE = {
  'W': '#8B6914', // wood
  'w': '#6B4914', // wood dark
  'C': '#a08050', // canvas top
  'c': '#806030', // canvas dark
  'R': '#4a3a2a', // wheels
  'r': '#3a2a1a', // wheel dark
  'A': '#5a4a3a', // axle
};

const WAGON_SPRITE = [
  ' .CCC. ',
  ' cCCCc ',
  ' CCCCC ',
  ' WWWWW ',
  ' wWWWw ',
  'R.AAA.R',
  'rR...Rr',
];

const ROYAL_PALETTE = {
  'G': '#ffd700', // gold trim
  'R': '#8b0000', // royal red
  'r': '#6b0000', // royal dark
  'W': '#f0e0c0', // white
  'w': '#d0c0a0', // white dark
  'D': '#4a3a2a', // wheels
  'd': '#3a2a1a', // wheel dark
  'A': '#5a4a3a', // axle
  'C': '#c0a040', // crown ornament
};

const ROYAL_SPRITE = [
  ' ..C.. ',
  ' .GGG. ',
  ' GRRG. ',
  ' RRRRR ',
  ' rRWRr ',
  ' WWWWW ',
  'D.AAA.D',
  'dD...Dd',
];


export class Guard {
  constructor(x, y, caravan) {
    this.pos = new Vec2(x, y);
    this.vel = new Vec2(0, 0);
    this.radius = CONST.GUARD_RADIUS;
    this.caravan = caravan;

    // Stats
    this.maxHp = 40;
    this.hp = this.maxHp;
    this.damage = 8;
    this.speed = CONST.GUARD_SPEED;
    this.detectionRange = CONST.GUARD_DETECTION_RANGE;
    this.chaseRange = CONST.GUARD_CHASE_RANGE;
    this.attackRange = CONST.GUARD_ATTACK_RANGE;
    this.attackCooldown = CONST.GUARD_ATTACK_COOLDOWN;
    this.attackTimer = 0;

    // AI
    this.state = GuardState.PATROL;
    this.patrolOffset = new Vec2(
      (Math.random() - 0.5) * 40,
      (Math.random() - 0.5) * 40
    );
    this.alive = true;

    // Animation
    this.animTimer = 0;
    this.animFrame = 0;
    this.facing = new Vec2(1, 0);
    this.walkFrames = [GUARD_WALK_1, GUARD_WALK_2];
  }

  update(dt, playerPos) {
    if (!this.alive) return;

    // Attack cooldown
    if (this.attackTimer > 0) {
      this.attackTimer -= dt;
    }

    const distToPlayer = this.pos.dist(playerPos);
    const caravanPos = this.caravan.alive ? this.caravan.pos : this.pos;
    const distToCaravan = this.pos.dist(caravanPos);

    // State transitions
    switch (this.state) {
      case GuardState.PATROL:
        if (distToPlayer < this.detectionRange) {
          this.state = GuardState.CHASE;
        }
        break;
      case GuardState.CHASE:
        if (distToPlayer > this.chaseRange || distToCaravan > this.chaseRange * 1.5) {
          this.state = GuardState.RETURN;
        }
        break;
      case GuardState.RETURN:
        if (distToPlayer < this.detectionRange * 0.8) {
          this.state = GuardState.CHASE;
        } else if (distToCaravan < 30) {
          this.state = GuardState.PATROL;
        }
        break;
    }

    // Movement based on state
    let targetPos;
    switch (this.state) {
      case GuardState.PATROL:
        targetPos = caravanPos.add(this.patrolOffset);
        break;
      case GuardState.CHASE:
        targetPos = playerPos;
        break;
      case GuardState.RETURN:
        targetPos = caravanPos;
        break;
    }

    const toTarget = targetPos.sub(this.pos);
    const distToTarget = toTarget.len();

    if (distToTarget > 3) {
      const dir = toTarget.normalize();
      this.vel = dir.mul(this.speed);
      this.facing = dir;
    } else {
      this.vel = new Vec2(0, 0);
    }

    this.pos = this.pos.add(this.vel.mul(dt));

    // Animation
    this.animTimer += dt;
    if (this.vel.lenSq() > 10) {
      this.animFrame = Math.floor(this.animTimer / 0.2) % this.walkFrames.length;
    } else {
      this.animFrame = -1; // idle
    }
  }

  canAttack(playerPos) {
    if (!this.alive || this.attackTimer > 0) return false;
    return this.pos.dist(playerPos) < this.attackRange + CONST.PLAYER_RADIUS;
  }

  attack() {
    this.attackTimer = this.attackCooldown;
    return this.damage;
  }

  takeDamage(amount) {
    if (!this.alive) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
  }

  render(renderer) {
    if (!this.alive) return;

    const flipH = this.facing.x < -0.1;
    let sprite;
    if (this.animFrame >= 0) {
      sprite = this.walkFrames[this.animFrame];
    } else {
      sprite = GUARD_SPRITE;
    }

    const drawSprite = flipH ? sprite.map(row => row.split('').reverse().join('')) : sprite;
    renderer.pixelSprite(this.pos.x, this.pos.y, drawSprite, GUARD_PALETTE, 2);

    // Health bar when damaged
    if (this.hp < this.maxHp) {
      const barW = 20;
      const barH = 3;
      renderer.healthBar(
        this.pos.x - barW / 2,
        this.pos.y - 14,
        barW, barH,
        this.hp / this.maxHp,
        '#e67e22',
        CONST.COLOR_HP_BG
      );
    }
  }
}


export class Caravan {
  constructor(type, world) {
    const def = CARAVAN_DEFS[type];
    this.type = type;
    this.def = def;
    this.world = world;
    this.radius = def.radius;

    // Path following
    this.pathT = 0; // 0 to 1 along the road
    this.speed = def.speed;
    this.direction = 1; // 1 = forward, -1 = reverse (for variety)

    // Position from path
    const startPos = world.getRoadPosition(this.pathT);
    this.pos = new Vec2(startPos.x, startPos.y);

    // Health
    this.maxHp = def.hp;
    this.hp = this.maxHp;
    this.alive = true;

    // Loot
    this.lootValue = randInt(def.lootMin, def.lootMax);

    // Guards
    this.guards = [];

    // State
    this.looted = false; // has been destroyed and loot dropped
  }

  spawnGuards() {
    const count = this.def.guardCount;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      const offset = 30;
      const gx = this.pos.x + Math.cos(angle) * offset;
      const gy = this.pos.y + Math.sin(angle) * offset;
      const guard = new Guard(gx, gy, this);
      this.guards.push(guard);
    }
    return this.guards;
  }

  update(dt, playerPos) {
    if (!this.alive) return;

    // Advance along road
    // Convert speed to path parameter change
    // Road length is roughly world width, so speed / worldWidth gives approximate dt for pathT
    const roadLen = this.world.width * 1.2; // approximate road length (a bit longer than world width due to curves)
    const pathSpeed = this.speed / roadLen;
    this.pathT += pathSpeed * dt * this.direction;

    // If reached end, caravan escapes
    if (this.pathT > 1 || this.pathT < 0) {
      this.alive = false;
      this.looted = true; // mark as done (escaped, no loot)
      return;
    }

    // Update position from path
    const roadPos = this.world.getRoadPosition(this.pathT);
    this.pos.x = roadPos.x;
    this.pos.y = roadPos.y;
  }

  takeDamage(amount) {
    if (!this.alive) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
  }

  render(renderer) {
    if (!this.alive) return;

    let sprite, palette;
    switch (this.type) {
      case CaravanType.DONKEY:
        sprite = DONKEY_SPRITE;
        palette = DONKEY_PALETTE;
        break;
      case CaravanType.WAGON:
        sprite = WAGON_SPRITE;
        palette = WAGON_PALETTE;
        break;
      case CaravanType.ROYAL:
        sprite = ROYAL_SPRITE;
        palette = ROYAL_PALETTE;
        break;
    }

    // Flip based on direction
    const flipH = this.direction < 0;
    const drawSprite = flipH ? sprite.map(row => row.split('').reverse().join('')) : sprite;
    renderer.pixelSprite(this.pos.x, this.pos.y, drawSprite, palette, 2);

    // Health bar when damaged
    if (this.hp < this.maxHp) {
      const barW = 30;
      const barH = 4;
      renderer.healthBar(
        this.pos.x - barW / 2,
        this.pos.y - this.radius - 6,
        barW, barH,
        this.hp / this.maxHp,
        '#e74c3c',
        CONST.COLOR_HP_BG
      );
    }
  }
}


// Wave spawning system
export function spawnWave(wave, world) {
  const caravans = [];

  // Base: 1 caravan at wave 1, scaling up
  const caravanCount = Math.min(1 + Math.floor(wave / 2), 6);

  for (let i = 0; i < caravanCount; i++) {
    // Choose type based on wave
    let type;
    if (wave <= 2) {
      type = CaravanType.DONKEY;
    } else if (wave <= 4) {
      type = Math.random() < 0.6 ? CaravanType.DONKEY : CaravanType.WAGON;
    } else {
      const roll = Math.random();
      if (roll < 0.3) type = CaravanType.DONKEY;
      else if (roll < 0.7) type = CaravanType.WAGON;
      else type = CaravanType.ROYAL;
    }

    const caravan = new Caravan(type, world);

    // Stagger starting positions along the road
    caravan.pathT = 0.02 + (i * 0.12);
    caravan.direction = 1;
    const roadPos = world.getRoadPosition(caravan.pathT);
    caravan.pos.x = roadPos.x;
    caravan.pos.y = roadPos.y;

    caravans.push(caravan);
  }

  return caravans;
}
