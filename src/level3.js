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

  /* A texture per surface, so each can repeat at its own rate. Cloning shares
     the decoded image, so this costs nothing but a wrapper. */
  tile(THREE, map, repeatX, repeatY) {
    if (!map) return null;
    const copy = map.clone();
    copy.wrapS = THREE.RepeatWrapping;
    copy.wrapT = THREE.RepeatWrapping;
    copy.repeat.set(repeatX, repeatY);
    copy.needsUpdate = true;
    return copy;
  },

  /* ---------- The maze ----------
     A perfect maze is corridors and dead ends. The Backrooms is open rooms
     joined by doorways, so rooms are carved into it afterwards and a few walls
     knocked through, which turns dead ends into loops. */
  generate(cols, rows) {
    const maze = Maze.generate(cols, rows);
    const { grid, width, height } = maze;
    const inside = (x, y) => x > 0 && y > 0 && x < width - 1 && y < height - 1;

    const rooms = Math.max(4, Math.round((cols * rows) / 26));
    for (let r = 0; r < rooms; r++) {
      const cx = 2 + Math.floor(Math.random() * (width - 4));
      const cy = 2 + Math.floor(Math.random() * (height - 4));
      const halfW = 1 + Math.floor(Math.random() * 2);
      const halfH = 1 + Math.floor(Math.random() * 2);
      for (let y = cy - halfH; y <= cy + halfH; y++) {
        for (let x = cx - halfW; x <= cx + halfW; x++) {
          if (inside(x, y)) grid[y * width + x] = 0;
        }
      }
    }

    /* knock through a few walls so the place loops back on itself */
    const holes = Math.round(cols * rows * 0.08);
    for (let h = 0; h < holes; h++) {
      const x = 1 + Math.floor(Math.random() * (width - 2));
      const y = 1 + Math.floor(Math.random() * (height - 2));
      if (inside(x, y)) grid[y * width + x] = 0;
    }

    /* Start and exit as far apart as the result allows. */
    const field = this.spread(maze, 1, 1);
    if (field[1 * width + 1] < 0) grid[1 * width + 1] = 0;
    let best = 1 * width + 1;
    let bestScore = -1;
    for (let i = 0; i < field.length; i++) {
      if (field[i] > bestScore) {
        bestScore = field[i];
        best = i;
      }
    }
    maze.start = { x: 1, y: 1 };
    maze.exit = { x: best % width, y: (best / width) | 0 };
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

  /* ---------- Geometry ---------- */

  build(THREE, def, tile) {
    const maze = this.generate(def.cols || this.COLS, def.rows || this.ROWS);
    const { grid, width, height } = maze;
    const ceiling = def.ceiling || this.CEILING;
    const group = new THREE.Group();
    const tex = this.tex;

    const spanX = width * tile;
    const spanZ = height * tile;

    /* --- carpet: one plane per variant, in bands, so the floor is patchy the
       way the original is rather than one flat repeat --- */
    const carpets = tex.carpet.length ? tex.carpet : tex.wall;
    const bands = Math.min(carpets.length, 4) || 1;
    for (let b = 0; b < bands; b++) {
      const depth = spanZ / bands;
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(spanX, depth),
        new THREE.MeshStandardMaterial({
          map: this.tile(THREE, carpets[b % carpets.length], width, Math.ceil(height / bands)),
          roughness: 0.95,
        }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(spanX / 2, 0, depth * (b + 0.5));
      floor.receiveShadow = true;
      group.add(floor);
    }

    /* --- ceiling, the thing that makes it feel indoors --- */
    const ceilings = tex.ceiling.length ? tex.ceiling : carpets;
    const lid = new THREE.Mesh(
      new THREE.PlaneGeometry(spanX, spanZ),
      new THREE.MeshStandardMaterial({
        map: this.tile(THREE, ceilings[0], width, height),
        roughness: 0.9,
        side: THREE.FrontSide,
      }),
    );
    lid.rotation.x = Math.PI / 2;
    lid.position.set(spanX / 2, ceiling, spanZ / 2);
    group.add(lid);

    /* --- walls: one instanced mesh per wall texture, cells assigned by a hash
       so the variants scatter instead of banding --- */
    const walls = tex.wall.length ? tex.wall : ceilings;
    const buckets = walls.map(() => []);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!grid[y * width + x]) continue;
        buckets[(x * 7 + y * 13) % buckets.length].push({ x, y });
      }
    }

    const matrix = new THREE.Matrix4();
    buckets.forEach((cells, index) => {
      if (!cells.length) return;
      const mesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(tile, ceiling, tile),
        new THREE.MeshStandardMaterial({
          map: this.tile(THREE, walls[index % walls.length], 1, 1),
          roughness: 0.85,
        }),
        cells.length,
      );
      cells.forEach((cell, i) => {
        matrix.makeTranslation(cell.x * tile + tile / 2, ceiling / 2, cell.y * tile + tile / 2);
        mesh.setMatrixAt(i, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      group.add(mesh);
      if (index === 0) group.userData.walls = mesh;
    });

    /* --- doorways: where an open cell is pinched between two walls, frame it.
       The frame sits above head height, so it changes the look and not the
       collision, which stays exactly the grid. --- */
    const doorMap = tex.door || walls[0];
    const doorMaterial = new THREE.MeshStandardMaterial({
      map: this.tile(THREE, doorMap, 1, 1), roughness: 0.7,
    });
    const HEAD = 2.25;
    let doors = 0;
    for (let y = 1; y < height - 1 && doors < 40; y++) {
      for (let x = 1; x < width - 1 && doors < 40; x++) {
        if (grid[y * width + x]) continue;
        const eastWest = grid[y * width + x - 1] && grid[y * width + x + 1];
        const northSouth = grid[(y - 1) * width + x] && grid[(y + 1) * width + x];
        if (!eastWest && !northSouth) continue;
        if (Math.random() > 0.35) continue;

        const lintel = new THREE.Mesh(
          new THREE.BoxGeometry(
            northSouth ? tile * 0.3 : tile, ceiling - HEAD, northSouth ? tile : tile * 0.3,
          ),
          doorMaterial,
        );
        lintel.position.set(
          x * tile + tile / 2, HEAD + (ceiling - HEAD) / 2, y * tile + tile / 2,
        );
        group.add(lintel);
        doors += 1;
      }
    }

    /* --- ceiling lamps: the flat sourceless glow the place is known for --- */
    const lampMap = tex.lamp || ceilings[0];
    const lampMaterial = new THREE.MeshBasicMaterial({
      map: this.tile(THREE, lampMap, 1, 1), color: 0xfff6d8,
    });
    let lamps = 0;
    for (let y = 2; y < height - 1; y += 4) {
      for (let x = 2; x < width - 1; x += 4) {
        if (grid[y * width + x]) continue;
        const panel = new THREE.Mesh(new THREE.PlaneGeometry(tile * 0.6, tile * 0.6), lampMaterial);
        panel.rotation.x = Math.PI / 2;
        panel.position.set(x * tile + tile / 2, ceiling - 0.04, y * tile + tile / 2);
        group.add(panel);

        if (lamps < 14) {
          const bulb = new THREE.PointLight(0xffeec2, 0.75, tile * 5.5, 2);
          bulb.position.set(x * tile + tile / 2, ceiling - 0.5, y * tile + tile / 2);
          group.add(bulb);
          lamps += 1;
        }
      }
    }

    /* --- an exit sign over the way out, straight off the original --- */
    if (tex.sign) {
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 0.7),
        new THREE.MeshBasicMaterial({ map: this.tile(THREE, tex.sign, 1, 1), transparent: true }),
      );
      sign.position.set(
        maze.exit.x * tile + tile / 2, ceiling - 0.9, maze.exit.y * tile + tile / 2,
      );
      group.add(sign);
      const glow = new THREE.PointLight(0x7dd3fc, 1.4, 10, 2);
      glow.position.copy(sign.position);
      group.add(glow);
    }

    maze.reachable = this.spread(maze, maze.start.x, maze.start.y)
      .reduce((total, v) => total + (v >= 0 ? 1 : 0), 0);
    console.log(`world 3: ${width}x${height} grid, ${maze.reachable} reachable, ${doors} doorways`);

    return { group, maze, world: { width: spanX, depth: spanZ, ceiling } };
  },
};
