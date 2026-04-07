// World - desert terrain with roads, rocks, and bushes

import { CONST, seededRandom } from './utils.js';

export class World {
  constructor() {
    this.width = CONST.WORLD_W;
    this.height = CONST.WORLD_H;
    this.tileSize = CONST.TILE_SIZE;
    this.cols = Math.ceil(this.width / this.tileSize);
    this.rows = Math.ceil(this.height / this.tileSize);

    // Road waypoints - the path caravans follow
    this.roadPoints = this._generateRoad();

    // Tile map: 0=sand, 1=road, 2=road edge
    this.tiles = this._buildTileMap();

    // Decorations (rocks, bushes, cacti)
    this.decorations = this._generateDecorations();

    // Pre-render terrain to offscreen canvas for performance
    this._terrainCanvas = null;
    this._terrainDirty = true;
  }

  _generateRoad() {
    // Road enters from the left and exits to the right with some curves
    const points = [];
    const segments = 8;
    const rng = seededRandom(42);
    const segW = this.width / segments;

    for (let i = 0; i <= segments; i++) {
      const x = i * segW;
      // Keep road in the middle third vertically, with some variation
      const baseY = this.height / 2;
      const variance = this.height * 0.2;
      const y = baseY + (rng() - 0.5) * 2 * variance;
      points.push({ x, y });
    }

    // Smooth the points - ensure start and end are at edges
    points[0].x = -20;
    points[points.length - 1].x = this.width + 20;

    return points;
  }

  // Interpolate a position along the road at parameter t (0..1)
  getRoadPosition(t) {
    const pts = this.roadPoints;
    const totalSegments = pts.length - 1;
    const segFloat = t * totalSegments;
    const seg = Math.floor(segFloat);
    const segT = segFloat - seg;

    if (seg >= totalSegments) {
      return { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y };
    }
    if (seg < 0) {
      return { x: pts[0].x, y: pts[0].y };
    }

    // Catmull-Rom for smoother curves
    const p0 = pts[Math.max(0, seg - 1)];
    const p1 = pts[seg];
    const p2 = pts[Math.min(pts.length - 1, seg + 1)];
    const p3 = pts[Math.min(pts.length - 1, seg + 2)];

    const tt = segT;
    const tt2 = tt * tt;
    const tt3 = tt2 * tt;

    const x = 0.5 * (
      (2 * p1.x) +
      (-p0.x + p2.x) * tt +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * tt2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * tt3
    );
    const y = 0.5 * (
      (2 * p1.y) +
      (-p0.y + p2.y) * tt +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * tt2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * tt3
    );

    return { x, y };
  }

  // Get road direction at parameter t
  getRoadDirection(t) {
    const delta = 0.001;
    const a = this.getRoadPosition(t);
    const b = this.getRoadPosition(t + delta);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return { x: 1, y: 0 };
    return { x: dx / len, y: dy / len };
  }

  _buildTileMap() {
    const tiles = new Uint8Array(this.cols * this.rows);
    const roadWidth = 2.5; // in tiles

    // Sample road at many points and mark tiles as road
    for (let t = 0; t <= 1; t += 0.002) {
      const pos = this.getRoadPosition(t);
      const col = Math.floor(pos.x / this.tileSize);
      const row = Math.floor(pos.y / this.tileSize);

      for (let dr = -Math.ceil(roadWidth); dr <= Math.ceil(roadWidth); dr++) {
        for (let dc = -Math.ceil(roadWidth); dc <= Math.ceil(roadWidth); dc++) {
          const r = row + dr;
          const c = col + dc;
          if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) continue;
          const dist = Math.sqrt(dr * dr + dc * dc);
          const idx = r * this.cols + c;
          if (dist <= roadWidth - 0.5) {
            tiles[idx] = 1; // road
          } else if (dist <= roadWidth + 0.5 && tiles[idx] === 0) {
            tiles[idx] = 2; // road edge
          }
        }
      }
    }

    return tiles;
  }

  _generateDecorations() {
    const decorations = [];
    const rng = seededRandom(123);
    const count = 120;

    for (let i = 0; i < count; i++) {
      const x = rng() * this.width;
      const y = rng() * this.height;

      // Don't place on roads
      const col = Math.floor(x / this.tileSize);
      const row = Math.floor(y / this.tileSize);
      if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
        if (this.tiles[row * this.cols + col] !== 0) continue;
      }

      const type = rng() < 0.4 ? 'rock' : rng() < 0.7 ? 'bush' : 'cactus';
      const size = 4 + rng() * 8;
      decorations.push({ x, y, type, size });
    }

    return decorations;
  }

  isRoad(worldX, worldY) {
    const col = Math.floor(worldX / this.tileSize);
    const row = Math.floor(worldY / this.tileSize);
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return false;
    return this.tiles[row * this.cols + col] === 1;
  }

  _renderTerrainToCache(renderer) {
    // Create offscreen canvas for terrain
    if (!this._terrainCanvas) {
      this._terrainCanvas = document.createElement('canvas');
      this._terrainCanvas.width = this.width;
      this._terrainCanvas.height = this.height;
    }

    const ctx = this._terrainCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const ts = this.tileSize;

    // Draw tiles
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const tile = this.tiles[r * this.cols + c];
        const x = c * ts;
        const y = r * ts;

        if (tile === 1) {
          ctx.fillStyle = CONST.COLOR_ROAD;
          ctx.fillRect(x, y, ts, ts);
        } else if (tile === 2) {
          ctx.fillStyle = CONST.COLOR_ROAD_EDGE;
          ctx.fillRect(x, y, ts, ts);
        } else {
          // Sand with slight variation
          const rng = seededRandom(r * 1000 + c);
          const v = rng();
          ctx.fillStyle = v < 0.3 ? CONST.COLOR_SAND_DARK :
            v < 0.7 ? CONST.COLOR_SAND : CONST.COLOR_SAND_LIGHT;
          ctx.fillRect(x, y, ts, ts);
        }
      }
    }

    // Draw decorations
    for (const dec of this.decorations) {
      if (dec.type === 'rock') {
        ctx.fillStyle = CONST.COLOR_ROCK;
        ctx.beginPath();
        ctx.ellipse(dec.x, dec.y, dec.size, dec.size * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#9a9288';
        ctx.beginPath();
        ctx.ellipse(dec.x - 1, dec.y - 1, dec.size * 0.7, dec.size * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (dec.type === 'bush') {
        ctx.fillStyle = '#5a7a2e';
        ctx.beginPath();
        ctx.arc(dec.x, dec.y, dec.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = CONST.COLOR_BUSH;
        ctx.beginPath();
        ctx.arc(dec.x - 1, dec.y - 2, dec.size * 0.8, 0, Math.PI * 2);
        ctx.fill();
      } else if (dec.type === 'cactus') {
        ctx.fillStyle = '#4a7a2a';
        // Main body
        ctx.fillRect(dec.x - 2, dec.y - dec.size, 5, dec.size * 2);
        // Arms
        ctx.fillRect(dec.x - 6, dec.y - dec.size * 0.5, 5, 3);
        ctx.fillRect(dec.x - 6, dec.y - dec.size * 0.5 - 4, 3, 5);
        ctx.fillRect(dec.x + 3, dec.y - dec.size * 0.3, 5, 3);
        ctx.fillRect(dec.x + 6, dec.y - dec.size * 0.3 - 3, 3, 5);
      }
    }

    this._terrainDirty = false;
  }

  render(renderer, camera) {
    // Lazy-render terrain cache
    if (this._terrainDirty || !this._terrainCanvas) {
      this._renderTerrainToCache(renderer);
    }

    // Draw only the visible portion
    const sx = Math.max(0, Math.floor(camera.x));
    const sy = Math.max(0, Math.floor(camera.y));
    const sw = Math.min(this.width - sx, renderer.width);
    const sh = Math.min(this.height - sy, renderer.height);

    if (sw > 0 && sh > 0) {
      renderer.ctx.drawImage(
        this._terrainCanvas,
        sx, sy, sw, sh,
        Math.round(sx - camera.x - camera.shakeX), Math.round(sy - camera.y - camera.shakeY), sw, sh
      );
    }
  }
}
