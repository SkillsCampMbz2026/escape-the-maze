/* World 3 built from the Backrooms model itself, not a generated maze.

   Everything else in the game works off a grid: collision, the monsters'
   breadth-first pathfinding, the minimap, and where the exit goes. An imported
   mesh has no grid, so one is baked from it at load:

     - the model is tiled so the rooms actually go on for a while, which is the
       whole point of the place
     - a cell is walkable if there is floor under its centre and headroom above
     - two cells are connected if a chest-height ray between their centres is
       clear, and a cell with no connections is walled off

   The result is handed back in exactly the shape Maze.generate produces, so
   nothing downstream needs to know the difference. */

const Level3 = {
  scene: null,          // the loaded model, kept for cloning
  loaded: false,

  load(THREE, url) {
    this.THREE = THREE;
    return new Promise((resolve, reject) => {
      new THREE.GLTFLoader().load(url, (gltf) => {
        this.scene = gltf.scene;
        this.loaded = true;
        resolve(this);
      }, undefined, reject);
    });
  },

  /* ---------- Build ---------- */

  build(THREE, def, tile) {
    const source = this.scene;
    const group = new THREE.Group();

    /* --- orientation and scale ---
       The file measures 81.5 x 20.6 x 4.1, so the smallest axis is the height
       and it was authored Z-up. Turn it Y-up, then scale so the ceiling sits at
       a sensible height for a 1.62 tall player. */
    const probe = new THREE.Group();
    const model = source.clone(true);
    probe.add(model);
    let box = new THREE.Box3().setFromObject(probe);
    let size = new THREE.Vector3();
    box.getSize(size);

    if (size.y > size.z && size.z < size.x) {
      model.rotation.x = -Math.PI / 2;      // Z-up source
      box = new THREE.Box3().setFromObject(probe);
      box.getSize(size);
    }

    const CEILING = 3.4;
    const scale = CEILING / Math.max(0.001, size.y);
    const tiles = def.tiles || 2;

    /* --- lay the same rooms out in a grid, which is the endless part --- */
    const cellW = size.x * scale;
    const cellD = size.z * scale;

    for (let tz = 0; tz < tiles; tz++) {
      for (let tx = 0; tx < tiles; tx++) {
        const copy = source.clone(true);
        copy.rotation.x = model.rotation.x;
        const holder = new THREE.Group();
        holder.add(copy);
        holder.scale.setScalar(scale);
        // sit each copy flush against its neighbours, floor at y = 0
        holder.position.set(
          tx * cellW - box.min.x * scale,
          -box.min.y * scale,
          tz * cellD - box.min.z * scale,
        );
        holder.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = false;        // the ceiling would shadow everything
            o.receiveShadow = true;
            o.frustumCulled = true;
          }
        });
        group.add(holder);
      }
    }

    const world = { width: cellW * tiles, depth: cellD * tiles, ceiling: CEILING };

    /* Raycasting reads matrixWorld, and nothing has updated it yet — the group
       was assembled a moment ago and has never been rendered. Without this
       every ray misses, no floor is ever found, every cell bakes solid, and
       you spawn sealed inside a wall. */
    group.updateMatrixWorld(true);

    const maze = this.bake(THREE, group, world, tile);
    return { group, maze, world };
  },

  /* ---------- Baking the grid ---------- */

  bake(THREE, group, world, tile) {
    const width = Math.max(4, Math.floor(world.width / tile));
    const height = Math.max(4, Math.floor(world.depth / tile));
    const grid = new Uint8Array(width * height).fill(1);
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const origin = new THREE.Vector3();
    const meshes = [];
    group.traverse((o) => { if (o.isMesh) meshes.push(o); });

    const centre = (i) => i * tile + tile / 2;
    const floors = new Float32Array(width * height).fill(-1);

    /* pass 1: is there floor under this cell, with headroom above it? */
    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        origin.set(centre(x), world.ceiling - 0.15, centre(z));
        ray.set(origin, down);
        ray.far = world.ceiling + 1;
        const hits = ray.intersectObjects(meshes, false);
        if (!hits.length) continue;
        const floor = hits[hits.length - 1].point.y;   // lowest surface in the column
        if (floor > 1.2) continue;                     // standing on furniture, not floor
        floors[z * width + x] = floor;
        grid[z * width + x] = 0;                       // provisionally open
      }
    }

    /* pass 2: a cell you cannot actually walk into from anywhere is not open.
       Chest-height rays between neighbouring centres decide that, which also
       catches the walls the downward pass cannot see. */
    const dir = new THREE.Vector3();
    const link = (ax, az, bx, bz) => {
      const ay = floors[az * width + ax] + 1.1;
      const from = new THREE.Vector3(centre(ax), ay, centre(az));
      const to = new THREE.Vector3(centre(bx), floors[bz * width + bx] + 1.1, centre(bz));
      dir.copy(to).sub(from);
      const span = dir.length();
      ray.set(from, dir.normalize());
      ray.far = span - 0.05;
      return ray.intersectObjects(meshes, false).length === 0;
    };

    const links = new Uint8Array(width * height);
    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        if (grid[z * width + x]) continue;
        let count = 0;
        if (x + 1 < width && !grid[z * width + x + 1] && link(x, z, x + 1, z)) count++;
        if (x > 0 && !grid[z * width + x - 1] && link(x, z, x - 1, z)) count++;
        if (z + 1 < height && !grid[(z + 1) * width + x] && link(x, z, x, z + 1)) count++;
        if (z > 0 && !grid[(z - 1) * width + x] && link(x, z, x, z - 1)) count++;
        links[z * width + x] = count;
      }
    }
    for (let i = 0; i < grid.length; i++) {
      if (!grid[i] && links[i] === 0) grid[i] = 1;     // isolated: treat as wall
    }

    /* border is always solid, so nobody walks off the edge of the world */
    for (let x = 0; x < width; x++) {
      grid[x] = 1;
      grid[(height - 1) * width + x] = 1;
    }
    for (let z = 0; z < height; z++) {
      grid[z * width] = 1;
      grid[z * width + width - 1] = 1;
    }

    const maze = {
      grid, width, height, cols: width, rows: height,
      solid: (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 1 : grid[y * width + x]),
      start: { x: 1, y: 1 },
      exit: { x: width - 2, y: height - 2 },
    };

    /* Start and exit have to be real open cells, and as far apart as the baked
       space allows — the corners almost certainly are not open. */
    const open = [];
    for (let i = 0; i < grid.length; i++) if (!grid[i]) open.push(i);
    if (open.length) {
      const first = open[0];
      maze.start = { x: first % width, y: (first / width) | 0 };
      const field = Level3.spread(maze, maze.start.x, maze.start.y);
      let best = first;
      let bestScore = -1;
      open.forEach((i) => { if (field[i] > bestScore) { bestScore = field[i]; best = i; } });
      maze.exit = { x: best % width, y: (best / width) | 0 };
      /* Anything the start cannot reach is scenery, not level. */
      for (let i = 0; i < grid.length; i++) if (!grid[i] && field[i] < 0) grid[i] = 1;
    }

    /* Count what is actually reachable from the start, not merely open. */
    let reachable = 0;
    if (open.length) {
      const field = Level3.spread(maze, maze.start.x, maze.start.y);
      for (let i = 0; i < field.length; i++) if (field[i] >= 0) reachable += 1;
    }
    maze.openCount = open.length;
    maze.reachable = reachable;
    console.log(`world 3 bake: ${width}x${height} grid, ${open.length} open, ${reachable} reachable`);
    return maze;
  },

  /* Breadth-first reach, used to place the exit and prune unreachable rooms. */
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
};
