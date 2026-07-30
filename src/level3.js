/* World 3: a maze I generate, dressed in the Backrooms model's own materials.

   Using the model's geometry directly did not work. Collision, the monsters'
   pathfinding, the minimap and the exit all run off a grid, and a grid baked
   out of an arbitrary mesh is only ever approximately right — cells that look
   open but are not, walls you can see through, and no way to guarantee a
   walkable spawn.

   So the file is used as a reference instead of as level geometry. Its
   materials are harvested by name (Wall_1..4, Moquette_1..4 for the carpet,
   Ceiling_1..4, Ceiling_Lamp, Exit_Door, Exit_Sign) and applied to geometry
   built on an exact grid, at the same ceiling height and floor area as the
   original. The look and the format carry over; the weirdness does not. */

const Level3 = {
  loaded: false,
  tex: null,

  /* Measured from the file: 81.5 x 20.6 of floor under a 4.1 ceiling. The maze
     is squared off to a similar area rather than copying the long thin strip,
     which plays better while staying the same size and complexity. */
  CEILING: 4.1,
  COLS: 15,
  ROWS: 15,

  load(THREE, url) {
    this.THREE = THREE;
    return new Promise((resolve, reject) => {
      new THREE.GLTFLoader().load(url, (gltf) => {
        this.tex = this.harvest(THREE, gltf.scene);
        this.loaded = Boolean(this.tex.wall.length);
        /* The geometry has done its job; only the textures are kept. */
        gltf.scene.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
        resolve(this);
      }, undefined, reject);
    });
  },

  /* Pull the base colour maps out by material name. */
  harvest(THREE, scene) {
    const found = { wall: [], carpet: [], ceiling: [], lamp: null, door: null, sign: null };

    scene.traverse((object) => {
      const materials = object.material
        ? (Array.isArray(object.material) ? object.material : [object.material])
        : [];
      materials.forEach((material) => {
        const map = material.map;
        const name = material.name || '';
        if (!map) return;
        if (/^Wall_/i.test(name)) found.wall.push(map);
        else if (/^Moquette/i.test(name)) found.carpet.push(map);
        else if (/^Ceiling_Lamp/i.test(name)) found.lamp = map;
        else if (/^Ceiling_/i.test(name)) found.ceiling.push(map);
        else if (/Exit_Door/i.test(name)) found.door = map;
        else if (/Exit_Sign/i.test(name)) found.sign = map;
      });
    });

    return found;
  },

  /* The file's maps are atlases: one image holding many unrelated pieces, laid
     out for that model's UVs. Sampling them onto box faces gave every wall a
     random fragment and a lot of black. So the colour is taken from the file
     and the pattern is drawn here, which is what actually matches the look. */
  sampleColour(map, fallback) {
    try {
      if (!map || !map.image) return fallback;
      const size = 48;
      const surface = document.createElement('canvas');
      surface.width = size;
      surface.height = size;
      const g = surface.getContext('2d');
      g.drawImage(map.image, 0, 0, size, size);
      const data = g.getImageData(0, 0, size, size).data;

      /* Average only the lit, opaque pixels: an atlas is padded with black and
         transparent gutters that would drag the mean toward mud. */
      let r = 0;
      let gg = 0;
      let b = 0;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 200) continue;
        const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        if (luma < 55) continue;
        r += data[i];
        gg += data[i + 1];
        b += data[i + 2];
        n += 1;
      }
      if (!n) return fallback;
      return ((r / n) & 255) << 16 | ((gg / n) & 255) << 8 | ((b / n) & 255);
    } catch {
      return fallback;      // a cross-origin or undecoded image
    }
  },

  paint(THREE, size, draw, repeatX, repeatY) {
    const surface = document.createElement('canvas');
    surface.width = size;
    surface.height = size;
    draw(surface.getContext('2d'), size);
    const texture = new THREE.CanvasTexture(surface);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.encoding = THREE.sRGBEncoding;
    return texture;
  },

  hex(colour) {
    return `#${colour.toString(16).padStart(6, '0')}`;
  },

  mix(a, b, amount) {
    const lerp = (x, y) => Math.round(x + (y - x) * amount);
    return lerp((a >> 16) & 255, (b >> 16) & 255) << 16
      | lerp((a >> 8) & 255, (b >> 8) & 255) << 8
      | lerp(a & 255, b & 255);
  },

  shade(colour, amount) {
    const r = Math.min(255, Math.max(0, ((colour >> 16) & 255) + amount));
    const g = Math.min(255, Math.max(0, ((colour >> 8) & 255) + amount));
    const b = Math.min(255, Math.max(0, (colour & 255) + amount));
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  },

  /* Wallpaper: flat yellow, faint vertical streaking, and the dado rail that
     runs along the bottom of every wall in the reference. */
  wallpaper(THREE, colour, height) {
    return this.paint(THREE, 256, (g, s) => {
      g.fillStyle = this.hex(colour);
      g.fillRect(0, 0, s, s);
      /* The reference walls are nearly flat — just enough streaking to read as
         old wallpaper. Any more and it turns to corduroy. */
      for (let i = 0; i < 34; i++) {
        g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.045)';
        g.fillRect(Math.random() * s, 0, 2 + Math.random() * 6, s);
      }
      for (let i = 0; i < 2200; i++) {
        g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.03)';
        g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
      }
      // soft top-to-bottom falloff, the way a wall catches ceiling light
      const grd = g.createLinearGradient(0, 0, 0, s);
      grd.addColorStop(0, 'rgba(255,255,255,0.10)');
      grd.addColorStop(0.55, 'rgba(0,0,0,0)');
      grd.addColorStop(1, 'rgba(0,0,0,0.16)');
      g.fillStyle = grd;
      g.fillRect(0, 0, s, s);
      // dado rail near the floor
      const railY = s * 0.84;
      g.fillStyle = this.shade(colour, -46);
      g.fillRect(0, railY, s, s * 0.022);
      g.fillStyle = this.shade(colour, 24);
      g.fillRect(0, railY + s * 0.022, s, s * 0.012);
      // skirting
      g.fillStyle = this.shade(colour, -20);
      g.fillRect(0, s * 0.965, s, s * 0.035);
    }, 1, Math.max(1, Math.round(height / 3)));
  },

  /* Carpet: flat, slightly mottled, no pattern — matching the reference floor. */
  carpetTexture(THREE, colour) {
    return this.paint(THREE, 256, (g, s) => {
      g.fillStyle = this.hex(colour);
      g.fillRect(0, 0, s, s);
      /* Fine and low contrast: the reference floor is smooth commercial carpet,
         not gravel. */
      for (let i = 0; i < 5000; i++) {
        g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.018)' : 'rgba(0,0,0,0.024)';
        g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
      }
      for (let i = 0; i < 18; i++) {
        const grd = g.createRadialGradient(Math.random() * s, Math.random() * s, 0,
          Math.random() * s, Math.random() * s, 40 + Math.random() * 70);
        grd.addColorStop(0, 'rgba(0,0,0,0.05)');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd;
        g.fillRect(0, 0, s, s);
      }
    }, 1, 1);
  },

  /* Drop ceiling: white tiles on a grey grid, with a recessed panel now and
     then, which is the other half of what makes the reference read as an office. */
  ceilingTexture(THREE, colour) {
    return this.paint(THREE, 256, (g, s) => {
      g.fillStyle = this.hex(colour);
      g.fillRect(0, 0, s, s);
      const cells = 2;
      const step = s / cells;
      for (let y = 0; y < cells; y++) {
        for (let x = 0; x < cells; x++) {
          g.fillStyle = this.shade(colour, Math.random() > 0.5 ? 4 : -4);
          g.fillRect(x * step + 2, y * step + 2, step - 4, step - 4);
          for (let i = 0; i < 500; i++) {
            g.fillStyle = 'rgba(0,0,0,0.035)';
            g.fillRect(x * step + Math.random() * step, y * step + Math.random() * step, 1, 1);
          }
        }
      }
      // the grid the tiles sit in
      g.strokeStyle = this.shade(colour, -52);
      g.lineWidth = 3;
      for (let i = 0; i <= cells; i++) {
        g.beginPath();
        g.moveTo(i * step, 0);
        g.lineTo(i * step, s);
        g.moveTo(0, i * step);
        g.lineTo(s, i * step);
        g.stroke();
      }
      // one lit panel per tile block
      g.fillStyle = 'rgba(255,252,232,0.95)';
      g.fillRect(step * 0.22, step * 0.28, step * 0.56, step * 0.44);
    }, 1, 1);
  },

  /* ---------- The maze ----------
     A perfect maze is corridors and dead ends. The Backrooms is open rooms
     joined by doorways, so rooms are carved into it afterwards and a few walls
     knocked through, which turns dead ends into loops. */
  /* The reference is not corridors, it is open halls. So the maze is generated
     at half size and every cell expanded to a 2x2 block, which doubles every
     corridor to six units across. That is what makes the ceiling feel high
     rather than like the top of a shaft. */
  generate(cols, rows) {
    const small = Maze.generate(Math.max(3, Math.round(cols / 2)), Math.max(3, Math.round(rows / 2)));
    const width = small.width * 2 + 1;
    const height = small.height * 2 + 1;
    const grid = new Uint8Array(width * height).fill(1);

    for (let y = 0; y < small.height; y++) {
      for (let x = 0; x < small.width; x++) {
        if (small.grid[y * small.width + x]) continue;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const nx = x * 2 + dx;
            const ny = y * 2 + dy;
            if (nx > 0 && ny > 0 && nx < width - 1 && ny < height - 1) grid[ny * width + nx] = 0;
          }
        }
      }
    }

    const maze = {
      grid, width, height, cols: width, rows: height,
      solid: (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 1 : grid[y * width + x]),
      start: { x: 1, y: 1 },
      exit: { x: width - 2, y: height - 2 },
    };
    const inside = (x, y) => x > 0 && y > 0 && x < width - 1 && y < height - 1;

    /* Open halls carved through it, big enough to see across. */
    const rooms = Math.max(5, Math.round((cols * rows) / 18));
    for (let r = 0; r < rooms; r++) {
      const cx = 3 + Math.floor(Math.random() * (width - 6));
      const cy = 3 + Math.floor(Math.random() * (height - 6));
      const halfW = 2 + Math.floor(Math.random() * 3);
      const halfH = 2 + Math.floor(Math.random() * 3);
      for (let y = cy - halfH; y <= cy + halfH; y++) {
        for (let x = cx - halfW; x <= cx + halfW; x++) {
          if (inside(x, y)) grid[y * width + x] = 0;
        }
      }
    }

    /* knock through walls so the place loops back on itself rather than
       dead-ending, which is how the reference reads */
    const holes = Math.round(width * height * 0.05);
    for (let h = 0; h < holes; h++) {
      const x = 1 + Math.floor(Math.random() * (width - 2));
      const y = 1 + Math.floor(Math.random() * (height - 2));
      if (inside(x, y)) grid[y * width + x] = 0;
    }

    /* Lone pillars left standing in the halls: the reference is full of them,
       and they break up the floor without closing anything off. */
    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        if (grid[y * width + x]) continue;
        let openAround = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) if (!grid[(y + dy) * width + x + dx]) openAround += 1;
        }
        if (openAround > 22 && Math.random() < 0.07) grid[y * width + x] = 1;
      }
    }

    /* Start in the middle of a hall. Doubling every cell shifts the open area
       inward, so (1,1) is a wall now — picking a cell with open neighbours all
       round is both correct and a better place to begin. */
    let start = -1;
    let bestRoom = -1;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (grid[y * width + x]) continue;
        let room = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) if (!grid[(y + dy) * width + x + dx]) room += 1;
        }
        if (room > bestRoom) {
          bestRoom = room;
          start = y * width + x;
        }
      }
    }
    if (start < 0) {
      grid[width + 1] = 0;
      start = width + 1;
    }
    maze.start = { x: start % width, y: (start / width) | 0 };

    /* Exit at the furthest cell that can actually be walked to, and anything
       the start cannot reach is sealed so it never gets used for spawns. */
    const field = this.spread(maze, maze.start.x, maze.start.y);
    let best = start;
    let bestScore = -1;
    for (let i = 0; i < field.length; i++) {
      if (field[i] > bestScore) {
        bestScore = field[i];
        best = i;
      }
    }
    maze.exit = { x: best % width, y: (best / width) | 0 };
    for (let i = 0; i < grid.length; i++) if (!grid[i] && field[i] < 0) grid[i] = 1;
    return maze;
  },

  spread(maze, x0, y0) {
    const field = new Int32Array(maze.width * maze.height).fill(-1);
    const start = y0 * maze.width + x0;
    if (maze.grid[start]) return field;
    field[start] = 0;
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
      const index = queue[head];
      const x = index % maze.width;
      const y = (index / maze.width) | 0;
      const step = field[index] + 1;
      for (let d = 0; d < 4; d++) {
        const nx = x + [1, -1, 0, 0][d];
        const ny = y + [0, 0, 1, -1][d];
        if (nx < 0 || ny < 0 || nx >= maze.width || ny >= maze.height) continue;
        const next = ny * maze.width + nx;
        if (maze.grid[next] || field[next] !== -1) continue;
        field[next] = step;
        queue.push(next);
      }
    }
    return field;
  },

  /* A wall with a round-topped opening cut out of it — the shape that defines
     the reference far more than any texture does. Built as a filled outline
     with a hole, extruded to wall thickness. */
  archGeometry(THREE, tile, ceiling) {
    const half = tile / 2;
    const outline = new THREE.Shape();
    outline.moveTo(-half, 0);
    outline.lineTo(half, 0);
    outline.lineTo(half, ceiling);
    outline.lineTo(-half, ceiling);
    outline.lineTo(-half, 0);

    /* The opening: straight jambs up to the springing line, then a semicircle.
       The reference arches are grand — nearly the full height of the wall — so
       the jambs are wide and the springing line sits low, with the apex held
       just under the ceiling so it never pokes through. */
    const jamb = half * 0.84;
    const spring = Math.min(ceiling * 0.34, ceiling * 0.94 - jamb);
    const hole = new THREE.Path();
    hole.moveTo(-jamb, 0);
    hole.lineTo(-jamb, spring);
    hole.absarc(0, spring, jamb, Math.PI, 0, true);
    hole.lineTo(jamb, 0);
    hole.lineTo(-jamb, 0);
    outline.holes.push(hole);

    const geometry = new THREE.ExtrudeGeometry(outline, {
      depth: tile * 0.34, bevelEnabled: false, curveSegments: 14,
    });
    geometry.translate(0, 0, -tile * 0.17);
    return geometry;
  },

  /* ---------- Geometry ---------- */

  build(THREE, def, tile) {
    const maze = this.generate(def.cols || this.COLS, def.rows || this.ROWS);
    const { grid, width, height } = maze;
    const ceiling = def.ceiling || this.CEILING;
    const group = new THREE.Group();
    const tex = this.tex;

    const spanX = width * tile;
    const spanZ = height * tile;

    /* Colours come from the file's own maps; the patterns are drawn here. */
    const wallColour = this.sampleColour(tex.wall[0], 0xc9b062);
    /* Sampling the carpet atlas comes back too yellow next to the reference,
       which is a browner orange. */
    const carpetColour = this.mix(this.sampleColour(tex.carpet[0], 0xbe8a4e), 0xb0763a, 0.4);
    /* The ceiling atlas averages warm, but the tiles in the reference are
       nearly white — pulled most of the way there so it reads as a suspended
       ceiling rather than more wall. */
    const ceilingColour = this.mix(this.sampleColour(tex.ceiling[0], 0xe6e2d4), 0xf2efe6, 0.72);

    /* --- carpet --- */
    const carpet = this.carpetTexture(THREE, carpetColour);
    carpet.repeat.set(width * 0.5, height * 0.5);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(spanX, spanZ),
      new THREE.MeshStandardMaterial({ map: carpet, roughness: 0.98 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(spanX / 2, 0, spanZ / 2);
    floor.receiveShadow = true;
    group.add(floor);

    /* --- drop ceiling --- */
    const ceilingMap = this.ceilingTexture(THREE, ceilingColour);
    ceilingMap.repeat.set(width * 0.5, height * 0.5);
    const lid = new THREE.Mesh(
      new THREE.PlaneGeometry(spanX, spanZ),
      new THREE.MeshStandardMaterial({ map: ceilingMap, roughness: 0.9 }),
    );
    lid.rotation.x = Math.PI / 2;
    lid.position.set(spanX / 2, ceiling, spanZ / 2);
    group.add(lid);

    /* --- walls: one instanced box per solid cell, all sharing one wallpaper.
       A single material is right here — the reference walls are continuous,
       and per-cell variation is what made it look like patchwork. --- */
    const paper = this.wallpaper(THREE, wallColour, ceiling);
    const cells = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (grid[y * width + x]) cells.push({ x, y });
      }
    }

    if (cells.length) {
      const wallMesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(tile, ceiling, tile),
        new THREE.MeshStandardMaterial({ map: paper, roughness: 0.9 }),
        cells.length,
      );
      const matrix = new THREE.Matrix4();
      cells.forEach((cell, i) => {
        matrix.makeTranslation(cell.x * tile + tile / 2, ceiling / 2, cell.y * tile + tile / 2);
        wallMesh.setMatrixAt(i, matrix);
      });
      wallMesh.instanceMatrix.needsUpdate = true;
      wallMesh.receiveShadow = true;
      group.add(wallMesh);
      group.userData.walls = wallMesh;
    }

    /* --- doorways: where an open cell is pinched between two walls, frame it.
       The frame sits above head height, so it changes the look and not the
       collision, which stays exactly the grid. --- */
    const archMaterial = new THREE.MeshStandardMaterial({ map: paper, roughness: 0.9 });
    /* Corridors are two cells across, so the openings between rooms are two
       cells wide too — a one-cell arch almost never had anywhere to go. These
       span the full gap. */
    const wideArch = this.archGeometry(THREE, tile * 2, ceiling);
    const narrowArch = this.archGeometry(THREE, tile, ceiling);
    const solid = (x, y) => grid[y * width + x];
    const taken = new Uint8Array(width * height);
    let doors = 0;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (solid(x, y) || taken[y * width + x]) continue;

        /* a two-wide gap through a wall running north-south */
        if (!solid(x + 1, y) && solid(x - 1, y) && solid(x + 2, y)
          && (solid(x, y - 1) || solid(x, y + 1))) {
          const arch = new THREE.Mesh(wideArch, archMaterial);
          arch.position.set((x + 1) * tile, 0, y * tile + tile / 2);
          group.add(arch);
          taken[y * width + x] = 1;
          taken[y * width + x + 1] = 1;
          doors += 1;
          continue;
        }

        /* the same running east-west */
        if (!solid(x, y + 1) && solid(x, y - 1) && solid(x, y + 2)
          && (solid(x - 1, y) || solid(x + 1, y))) {
          const arch = new THREE.Mesh(wideArch, archMaterial);
          arch.position.set(x * tile + tile / 2, 0, (y + 1) * tile);
          arch.rotation.y = Math.PI / 2;
          group.add(arch);
          taken[y * width + x] = 1;
          taken[(y + 1) * width + x] = 1;
          doors += 1;
          continue;
        }

        /* and a single-cell pinch, which still happens after the wall holes */
        const eastWest = solid(x - 1, y) && solid(x + 1, y);
        const northSouth = solid(x, y - 1) && solid(x, y + 1);
        if (!eastWest && !northSouth) continue;
        const arch = new THREE.Mesh(narrowArch, archMaterial);
        arch.position.set(x * tile + tile / 2, 0, y * tile + tile / 2);
        if (northSouth) arch.rotation.y = Math.PI / 2;
        group.add(arch);
        taken[y * width + x] = 1;
        doors += 1;
      }
    }

    /* --- ceiling lamps: the flat sourceless glow the place is known for --- */
    const lampMaterial = new THREE.MeshBasicMaterial({ color: 0xfffbe8 });
    let lamps = 0;
    for (let y = 2; y < height - 1; y += 3) {
      for (let x = 2; x < width - 1; x += 3) {
        if (grid[y * width + x]) continue;
        const panel = new THREE.Mesh(
          new THREE.PlaneGeometry(tile * 0.5, tile * 0.5), lampMaterial,
        );
        panel.rotation.x = Math.PI / 2;
        panel.position.set(x * tile + tile / 2, ceiling - 0.03, y * tile + tile / 2);
        group.add(panel);

        if (lamps < 20) {
          const bulb = new THREE.PointLight(0xfff2cf, 0.6, tile * 6, 2);
          bulb.position.set(x * tile + tile / 2, ceiling - 0.5, y * tile + tile / 2);
          group.add(bulb);
          lamps += 1;
        }
      }
    }

    /* --- an exit sign over the way out --- */
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 0.6),
      new THREE.MeshBasicMaterial({ color: 0x39d353 }),
    );
    sign.position.set(
      maze.exit.x * tile + tile / 2, ceiling - 0.8, maze.exit.y * tile + tile / 2,
    );
    group.add(sign);
    const glow = new THREE.PointLight(0x39d353, 1.6, 12, 2);
    glow.position.copy(sign.position);
    group.add(glow);

    maze.reachable = this.spread(maze, maze.start.x, maze.start.y)
      .reduce((total, v) => total + (v >= 0 ? 1 : 0), 0);
    console.log(`world 3: ${width}x${height} grid, ${maze.reachable} reachable, ${doors} doorways`);

    return { group, maze, world: { width: spanX, depth: spanZ, ceiling } };
  },
};
