// Renderer - canvas drawing utilities

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = 0;
    this.height = 0;
    this.resize();
  }

  resize() {
    const dpr = 1; // keep 1:1 for pixel art crispness
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx.imageSmoothingEnabled = false;
  }

  clear(color = '#1a1a2e') {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  rect(x, y, w, h, color) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  strokeRect(x, y, w, h, color, lineWidth = 1) {
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = lineWidth;
    this.ctx.strokeRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  circle(x, y, r, color) {
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc(Math.round(x), Math.round(y), r, 0, Math.PI * 2);
    this.ctx.fill();
  }

  strokeCircle(x, y, r, color, lineWidth = 1) {
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = lineWidth;
    this.ctx.beginPath();
    this.ctx.arc(Math.round(x), Math.round(y), r, 0, Math.PI * 2);
    this.ctx.stroke();
  }

  strokeArc(x, y, r, startAngle, endAngle, color, lineWidth = 1) {
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = lineWidth;
    this.ctx.lineCap = 'round';
    this.ctx.beginPath();
    this.ctx.arc(x, y, r, startAngle, endAngle);
    this.ctx.stroke();
    this.ctx.lineCap = 'butt';
  }

  line(x1, y1, x2, y2, color, lineWidth = 1) {
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = lineWidth;
    this.ctx.beginPath();
    this.ctx.moveTo(Math.round(x1), Math.round(y1));
    this.ctx.lineTo(Math.round(x2), Math.round(y2));
    this.ctx.stroke();
  }

  text(str, x, y, color = '#fff', size = 16, align = 'left', baseline = 'top') {
    this.ctx.fillStyle = color;
    this.ctx.font = `bold ${size}px monospace`;
    this.ctx.textAlign = align;
    this.ctx.textBaseline = baseline;
    this.ctx.fillText(str, Math.round(x), Math.round(y));
  }

  textOutlined(str, x, y, color = '#fff', outlineColor = '#000', size = 16, align = 'left', baseline = 'top') {
    this.ctx.font = `bold ${size}px monospace`;
    this.ctx.textAlign = align;
    this.ctx.textBaseline = baseline;
    const ox = Math.round(x);
    const oy = Math.round(y);
    // Outline
    this.ctx.fillStyle = outlineColor;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        this.ctx.fillText(str, ox + dx, oy + dy);
      }
    }
    // Main text
    this.ctx.fillStyle = color;
    this.ctx.fillText(str, ox, oy);
  }

  // Outlined text that shrinks to fit within maxWidth.
  textOutlinedFit(str, x, y, maxWidth, color, outlineColor, size, align, baseline) {
    let s = size;
    while (s > 8 && this.measureText(str, s) > maxWidth) s--;
    this.textOutlined(str, x, y, color, outlineColor, s, align, baseline);
  }

  measureText(str, size = 16) {
    this.ctx.font = `bold ${size}px monospace`;
    return this.ctx.measureText(str).width;
  }

  // Draw word-wrapped text within maxWidth. Returns the total height used.
  textWrapped(str, x, y, maxWidth, color = '#fff', size = 16, align = 'left', lineHeight = 1.3) {
    this.ctx.font = `bold ${size}px monospace`;
    this.ctx.fillStyle = color;
    this.ctx.textAlign = align;
    this.ctx.textBaseline = 'top';

    const words = str.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (this.ctx.measureText(test).width > maxWidth && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);

    const lh = Math.round(size * lineHeight);
    const ox = Math.round(x);
    let oy = Math.round(y);
    for (const line of lines) {
      this.ctx.fillText(line, ox, oy);
      oy += lh;
    }
    return lines.length * lh;
  }

  // Draw a simple pixel-art style sprite from a pixel map
  // pixels is an array of rows, each row is a string where each char maps to a color
  // palette is { char: color }, space = transparent
  pixelSprite(x, y, pixels, palette, scale = 2) {
    const rows = pixels.length;
    const cols = pixels[0].length;
    const ox = Math.round(x - (cols * scale) / 2);
    const oy = Math.round(y - (rows * scale) / 2);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ch = pixels[r][c];
        if (ch === ' ' || ch === '.') continue;
        const color = palette[ch];
        if (color) {
          this.ctx.fillStyle = color;
          this.ctx.fillRect(ox + c * scale, oy + r * scale, scale, scale);
        }
      }
    }
  }

  // Health bar
  healthBar(x, y, w, h, ratio, fgColor = '#e74c3c', bgColor = '#333') {
    this.rect(x, y, w, h, bgColor);
    if (ratio > 0) {
      this.rect(x, y, w * Math.max(0, Math.min(1, ratio)), h, fgColor);
    }
  }

  // Save/restore for camera transforms
  save() { this.ctx.save(); }
  restore() { this.ctx.restore(); }

  translate(x, y) { this.ctx.translate(x, y); }
  scale(sx, sy) { this.ctx.scale(sx, sy !== undefined ? sy : sx); }
  rotate(angle) { this.ctx.rotate(angle); }

  setAlpha(a) { this.ctx.globalAlpha = a; }
  resetAlpha() { this.ctx.globalAlpha = 1; }
}
