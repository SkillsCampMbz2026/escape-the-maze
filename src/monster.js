/* The monsters: load blue_monster.glb once, then spawn a pack of them.

   The model has no animations and no skin — it is 51 rigid meshes in a named
   hierarchy whose joint nodes all sit at the origin with identity transforms.
   Rotating those directly would swing each limb around the model's centre, so
   an auto-rig pass gives every joint a real pivot: wrap its children in a
   group placed at the joint and offset them back, parents before children.
   The run cycle is then just rotating those groups.

   Hunting is a breadth-first field over the whole maze, so every route is the
   true shortest path. On top of that they compare arrival times along your
   likely route to the exit and try to get in front of you. */

const Monsters = {
  JOINTS: [
    { name: 'HipL', from: 'UpperLegL', at: 'top', parent: null },
    { name: 'LowerLegPivotL', from: 'LowerLegL', at: 'top', parent: 'HipL' },
    { name: 'HipR', from: 'UpperLegR', at: 'top', parent: null },
    { name: 'LowerLegPivotR', from: 'LowerLegR', at: 'top', parent: 'HipR' },
    { name: 'ShoulderL', from: 'UpperArmL', at: 'top', parent: null },
    { name: 'ForearmPivotL', from: 'ForearmL', at: 'top', parent: 'ShoulderL' },
    { name: 'ShoulderR', from: 'UpperArmR', at: 'top', parent: null },
    { name: 'ForearmPivotR', from: 'ForearmR', at: 'top', parent: 'ShoulderR' },
    { name: 'HeadPivot', from: 'Head', at: 'bottom', parent: null },
  ],

  /* Big ones hit hard and soak damage; the little ones are quick and brittle. */
  VARIANTS: {
    big: {
      height: 2.05, health: 100, speed: 1, damage: 34, catchRange: 1.35,
      eye: 0x86e3ff, tint: null, respawn: 7, label: 'Hunter',
    },
    mini: {
      height: 1.05, health: 34, speed: 1.34, damage: 15, catchRange: 0.95,
      eye: 0xffb066, tint: 0xff8a4c, respawn: 5, label: 'Runt',
    },
  },

  loaded: false,
  template: null,
  pack: [],
  kills: 0,

  /* ---------- Loading and rigging ---------- */

  load(THREE, url) {
    this.THREE = THREE;
    return new Promise((resolve, reject) => {
      new THREE.GLTFLoader().load(url, (gltf) => {
        this.template = this.rig(THREE, gltf.scene);
        this.loaded = true;
        resolve(this.template);
      }, undefined, reject);
    });
  },

  rig(THREE, root) {
    const byName = {};
    root.traverse((object) => {
      if (object.name) byName[object.name] = object;
      if (object.isMesh) {
        object.castShadow = true;
        object.frustumCulled = false;
      }
    });

    /* Pivot points, measured before anything moves so they stay consistent. */
    const pivots = {};
    this.JOINTS.forEach((joint) => {
      const source = byName[joint.from];
      if (!source || !source.geometry) return;
      source.geometry.computeBoundingBox();
      const box = source.geometry.boundingBox;
      pivots[joint.name] = new THREE.Vector3(
        (box.min.x + box.max.x) / 2,
        joint.at === 'top' ? box.max.y : box.min.y,
        (box.min.z + box.max.z) / 2,
      );
    });

    /* Parents first: a child joint lives inside its parent's new wrapper, so
       its pivot has to be expressed relative to that. */
    this.JOINTS.forEach((joint) => {
      const node = byName[joint.name];
      const pivot = pivots[joint.name];
      if (!node || !pivot) return;

      const local = pivot.clone();
      for (let ancestor = joint.parent; ancestor; ) {
        if (pivots[ancestor]) local.sub(pivots[ancestor]);
        const next = this.JOINTS.find((entry) => entry.name === ancestor);
        ancestor = next ? next.parent : null;
      }

      const wrapper = new THREE.Group();
      wrapper.name = `${joint.name}__pivot`;
      wrapper.position.copy(local);
      while (node.children.length) {
        const child = node.children[0];
        child.position.sub(local);
        wrapper.add(child);
      }
      node.add(wrapper);
    });

    const bounds = new THREE.Box3().setFromObject(root);

    const body = new THREE.Group();
    body.name = 'MonsterBody';
    const inner = new THREE.Group();
    inner.name = 'MonsterInner';
    inner.add(root);
    body.add(inner);

    /* Height is applied per spawn, so remember the raw model size. */
    body.userData = { rawHeight: bounds.max.y - bounds.min.y, rawMinY: bounds.min.y };
    return body;
  },

  /* ---------- Spawning ---------- */

  clear(scene) {
    this.pack.forEach((m) => scene.remove(m.body));
    this.pack = [];
    this.kills = 0;
  },

  spawnPack(THREE, scene, maze, options) {
    this.clear(scene);
    const counts = options.pack || { big: 1, mini: 0 };
    const fromStart = this.fieldFrom(maze, maze.start.x, maze.start.y);
    const taken = [];

    Object.keys(counts).forEach((variant) => {
      for (let i = 0; i < (counts[variant] || 0); i++) {
        const cell = this.pickSpawn(maze, fromStart, taken);
        taken.push(cell);
        this.pack.push(this.spawn(THREE, scene, maze, {
          ...options,
          variant,
          cell,
          // stagger the pack so they do not arrive as one clump
          grace: options.grace + i * 0.9,
        }));
      }
    });

    return this.pack;
  },

  spawn(THREE, scene, maze, options) {
    const kind = this.VARIANTS[options.variant] || this.VARIANTS.big;
    const body = this.template.clone(true);
    const raw = this.template.userData;

    const rig = {};
    body.traverse((object) => {
      if (object.name && object.name.endsWith('__pivot')) {
        rig[object.name.slice(0, -'__pivot'.length)] = object;
      }
    });

    const inner = body.getObjectByName('MonsterInner');
    const scale = kind.height / raw.rawHeight;
    inner.scale.setScalar(scale);
    inner.position.y = -raw.rawMinY * scale;

    /* Recolour the small ones so you can tell at a glance what is coming.
       clone() shares materials, so they have to be cloned per instance. */
    if (kind.tint) {
      body.traverse((object) => {
        if (!object.isMesh || !object.material) return;
        object.material = object.material.clone();
        if (object.material.color) object.material.color.lerp(new THREE.Color(kind.tint), 0.55);
      });
    }

    scene.add(body);

    const eyeLight = new THREE.PointLight(kind.eye, 0, kind.height * 4.5, 2);
    eyeLight.position.y = kind.height * 0.8;
    body.add(eyeLight);

    const instance = {
      body,
      rig,
      inner,
      kind,
      variant: options.variant,
      baseY: inner.position.y,
      phase: Math.random() * Math.PI * 2,
      eyeLight,
      maze,
      tile: options.tile,
      speed: options.speed * kind.speed,
      grace: options.grace,
      exitField: options.exitField,
      intercept: options.intercept !== false,
      playerSpeed: options.playerSpeed || 5.2,
      x: options.cell.x * options.tile + options.tile / 2,
      z: options.cell.y * options.tile + options.tile / 2,
      yaw: 0,
      path: null,
      repathIn: Math.random() * 0.25,
      ambushing: false,
      sees: false,
      health: kind.health,
      maxHealth: kind.health,
      dead: false,
      dying: 0,
      respawnIn: 0,
      flinch: 0,
      hurtAt: -99,
      distanceToPlayer: 999,
    };

    body.position.set(instance.x, 0, instance.z);
    return instance;
  },

  /* Farthest open cell from the player, avoiding the exit and cells already
     claimed by another monster. */
  pickSpawn(maze, fromPlayer, taken = []) {
    let best = null;
    let bestScore = -1;
    for (let y = 1; y < maze.height - 1; y++) {
      for (let x = 1; x < maze.width - 1; x++) {
        if (maze.grid[y * maze.width + x]) continue;
        if (x === maze.exit.x && y === maze.exit.y) continue;
        let score = fromPlayer[y * maze.width + x];
        if (score < 0) continue;
        // push them apart so they spread through the maze
        taken.forEach((cell) => {
          const gap = Math.abs(cell.x - x) + Math.abs(cell.y - y);
          if (gap < 8) score -= (8 - gap) * 6;
        });
        if (score > bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }
    }
    return best || { x: maze.width - 2, y: 1 };
  },

  /* ---------- Maze knowledge ---------- */

  fieldFrom(maze, cellX, cellY) {
    const field = new Int32Array(maze.width * maze.height).fill(-1);
    const start = cellY * maze.width + cellX;
    if (start < 0 || start >= field.length || maze.grid[start]) return field;
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

  /* Downhill through a field is the shortest path, not an approximation. */
  tracePath(maze, field, fromX, fromY, tile) {
    const path = [];
    let x = fromX;
    let y = fromY;
    let steps = field[y * maze.width + x];
    if (steps === undefined || steps < 0) return path;

    let guard = maze.width * maze.height;
    while (steps > 0 && guard-- > 0) {
      let moved = false;
      for (let d = 0; d < 4; d++) {
        const nx = x + [1, -1, 0, 0][d];
        const ny = y + [0, 0, 1, -1][d];
        if (nx < 0 || ny < 0 || nx >= maze.width || ny >= maze.height) continue;
        if (field[ny * maze.width + nx] !== steps - 1) continue;
        x = nx; y = ny; steps -= 1;
        path.push({ x: x * tile + tile / 2, z: y * tile + tile / 2, cx: x, cy: y });
        moved = true;
        break;
      }
      if (!moved) break;
    }
    return path;
  },

  clearLine(maze, tile, x1, z1, x2, z2) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const steps = Math.ceil(Math.hypot(dx, dz) / 0.3);
    const r = 0.5;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const px = x1 + dx * t;
      const pz = z1 + dz * t;
      for (let corner = 0; corner < 4; corner++) {
        const ox = corner & 1 ? r : -r;
        const oz = corner & 2 ? r : -r;
        if (maze.solid(Math.floor((px + ox) / tile), Math.floor((pz + oz) / tile))) return false;
      }
    }
    return true;
  },

  /* Walk the player's likely route to the exit and compare arrival times: the
     furthest tile this one can reach first becomes an ambush. */
  chooseTarget(m, playerCellX, playerCellZ) {
    const maze = m.maze;
    const chase = { x: playerCellX, y: playerCellZ, ambush: false };
    if (!m.intercept || !m.exitField) return chase;

    const fromMe = this.fieldFrom(maze, Math.floor(m.x / m.tile), Math.floor(m.z / m.tile));
    const playerPace = m.tile / m.playerSpeed;
    const myPace = m.tile / m.speed;

    let x = playerCellX;
    let y = playerCellZ;
    let ambush = null;

    for (let k = 1; k <= 22; k++) {
      const here = m.exitField[y * maze.width + x];
      if (here <= 0) break;
      let stepped = false;
      for (let d = 0; d < 4; d++) {
        const nx = x + [1, -1, 0, 0][d];
        const ny = y + [0, 0, 1, -1][d];
        if (nx < 0 || ny < 0 || nx >= maze.width || ny >= maze.height) continue;
        if (m.exitField[ny * maze.width + nx] !== here - 1) continue;
        x = nx; y = ny; stepped = true;
        break;
      }
      if (!stepped) break;

      const reach = fromMe[y * maze.width + x];
      if (reach < 0) continue;
      if (reach * myPace <= k * playerPace - 0.35) ambush = { x, y, ambush: true };
    }

    return ambush || chase;
  },

  /* ---------- Damage ---------- */

  damage(m, amount, from, now) {
    if (!m || m.dead) return null;
    m.health -= amount;
    m.hurtAt = now;
    m.flinch = 0.22;

    if (from) {
      m.x += from.x * 0.3;
      m.z += from.z * 0.3;
    }

    if (m.health <= 0) {
      m.health = 0;
      m.dead = true;
      m.dying = 1.1;
      m.respawnIn = m.kind.respawn;
      m.path = null;
      this.kills += 1;
      return 'killed';
    }
    return 'hurt';
  },

  respawn(m, playerCellX, playerCellZ) {
    const others = this.pack.filter((other) => other !== m && !other.dead)
      .map((other) => ({ x: Math.floor(other.x / m.tile), y: Math.floor(other.z / m.tile) }));
    const fromPlayer = this.fieldFrom(m.maze, playerCellX, playerCellZ);
    const cell = this.pickSpawn(m.maze, fromPlayer, others);

    m.x = cell.x * m.tile + m.tile / 2;
    m.z = cell.y * m.tile + m.tile / 2;
    m.health = m.maxHealth;
    m.dead = false;
    m.dying = 0;
    m.respawnIn = 0;
    m.flinch = 0;
    m.path = null;
    m.grace = 1.6;
    m.body.visible = true;
    m.body.position.set(m.x, 0, m.z);
    m.inner.rotation.set(0, 0, 0);
    m.inner.position.y = m.baseY;
  },

  /* ---------- Per-frame ---------- */

  updateAll(dt, player, onContact, now) {
    let nearest = null;
    this.pack.forEach((m) => {
      this.update(m, dt, player, onContact, now);
      if (!m.dead && (!nearest || m.distanceToPlayer < nearest.distanceToPlayer)) nearest = m;
    });
    return nearest;
  },

  update(m, dt, player, onContact, now) {
    const tile = m.tile;
    const maze = m.maze;
    const playerCellX = Math.floor(player.x / tile);
    const playerCellZ = Math.floor(player.z / tile);

    m.distanceToPlayer = Math.hypot(player.x - m.x, player.z - m.z);
    m.sees = !m.dead && this.clearLine(maze, tile, m.x, m.z, player.x, player.z);

    if (m.dead) {
      m.respawnIn -= dt;
      if (m.dying > 0) {
        m.dying -= dt;
        const fall = 1 - Math.max(0, m.dying) / 1.1;
        m.inner.rotation.x = -fall * (Math.PI / 2);
        m.inner.rotation.z = fall * 0.35;
        m.inner.position.y = m.baseY - fall * 0.25 * (m.kind.height / 2);
        m.eyeLight.intensity = Math.max(0, 1.4 * (1 - fall));
      } else {
        m.body.visible = false;
        m.eyeLight.intensity = 0;
      }
      if (m.respawnIn <= 0) this.respawn(m, playerCellX, playerCellZ);
      return;
    }

    if (m.flinch > 0) m.flinch -= dt;

    if (m.grace > 0) {
      m.grace -= dt;
      this.animate(m, dt, 0);
      return;
    }

    m.repathIn -= dt;
    const playerCell = playerCellZ * maze.width + playerCellX;
    if (!m.path || m.repathIn <= 0 || m.lastPlayerCell !== playerCell) {
      const target = this.chooseTarget(m, playerCellX, playerCellZ);
      m.ambushing = target.ambush;
      const field = this.fieldFrom(maze, target.x, target.y);
      m.path = this.tracePath(maze, field, Math.floor(m.x / tile), Math.floor(m.z / tile), tile);
      m.lastPlayerCell = playerCell;
      m.repathIn = 0.25;
    }

    while (m.path.length && Math.hypot(m.path[0].x - m.x, m.path[0].z - m.z) < 0.4) m.path.shift();

    /* Aim at the furthest waypoint still in clear line of sight, so it sweeps
       through junctions instead of pacing tile centre to tile centre. */
    let aim = null;
    if (m.path.length) {
      aim = m.path[0];
      for (let i = Math.min(m.path.length - 1, 5); i >= 1; i--) {
        if (this.clearLine(maze, tile, m.x, m.z, m.path[i].x, m.path[i].z)) {
          aim = m.path[i];
          break;
        }
      }
    } else if (m.distanceToPlayer > 0.3) {
      aim = { x: player.x, z: player.z };
    }

    const charging = m.sees && m.distanceToPlayer < 16;
    const speed = m.speed * (charging ? 1.22 : 1) * (m.flinch > 0 ? 0.25 : 1);

    let moved = 0;
    if (aim) {
      const dx = aim.x - m.x;
      const dz = aim.z - m.z;
      const gap = Math.hypot(dx, dz);
      if (gap > 0.001) {
        const step = Math.min(gap, speed * dt);
        m.x += (dx / gap) * step;
        m.z += (dz / gap) * step;
        moved = step / Math.max(dt, 0.0001);

        // the model faces +Z, so yaw is atan2(dx, dz)
        const want = Math.atan2(dx, dz);
        let delta = want - m.yaw;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        m.yaw += delta * Math.min(1, dt * 8);
      }
    }

    m.body.position.set(m.x, 0, m.z);
    m.body.rotation.y = m.yaw;
    m.eyeLight.intensity = Math.max(0, 1.8 - m.distanceToPlayer * 0.12);

    this.animate(m, dt, moved);

    if (m.distanceToPlayer < m.kind.catchRange) onContact(m);
  },

  /* Procedural run cycle: legs counter-swing, knees fold on the backstroke,
     arms mirror the legs, body bobs and leans into the run. */
  animate(m, dt, speed) {
    const rig = m.rig;
    const pace = Math.min(1, speed / m.speed);

    m.phase += dt * (3.4 + pace * 6.5) * (m.kind.height < 1.5 ? 1.5 : 1);
    const t = m.phase;
    const swing = 0.85 * (0.25 + pace * 0.75);
    const legL = Math.sin(t);
    const legR = Math.sin(t + Math.PI);

    if (rig.HipL) rig.HipL.rotation.x = legL * swing;
    if (rig.HipR) rig.HipR.rotation.x = legR * swing;
    if (rig.LowerLegPivotL) rig.LowerLegPivotL.rotation.x = -Math.max(0, -legL) * swing * 1.5;
    if (rig.LowerLegPivotR) rig.LowerLegPivotR.rotation.x = -Math.max(0, -legR) * swing * 1.5;
    if (rig.ShoulderL) rig.ShoulderL.rotation.x = legR * swing * 0.7;
    if (rig.ShoulderR) rig.ShoulderR.rotation.x = legL * swing * 0.7;
    if (rig.ForearmPivotL) rig.ForearmPivotL.rotation.x = -0.5 - Math.max(0, legR) * 0.5;
    if (rig.ForearmPivotR) rig.ForearmPivotR.rotation.x = -0.5 - Math.max(0, legL) * 0.5;
    if (rig.HeadPivot) {
      rig.HeadPivot.rotation.x = -0.12 + Math.sin(t * 2) * 0.06 * pace;
      rig.HeadPivot.rotation.z = Math.sin(t) * 0.05 * pace;
    }

    m.inner.position.y = m.baseY + Math.abs(Math.sin(t)) * 0.07 * pace * m.kind.height;
    m.inner.rotation.x = -0.12 * pace;
  },

  /* Final lunge at the camera from whichever one got you. */
  lunge(m, dt, camera) {
    if (!m) return;
    const dx = camera.position.x - m.x;
    const dz = camera.position.z - m.z;
    const gap = Math.hypot(dx, dz) || 1;
    if (gap > 0.55) {
      m.x += (dx / gap) * dt * 3.4;
      m.z += (dz / gap) * dt * 3.4;
      m.body.position.set(m.x, 0, m.z);
    }
    m.yaw = Math.atan2(dx, dz);
    m.body.rotation.y = m.yaw;
    m.phase += dt * 18;
    if (m.rig.HeadPivot) m.rig.HeadPivot.rotation.x = -0.5 + Math.sin(m.phase) * 0.25;
    m.eyeLight.intensity = 3;
  },

  bodies() {
    return this.pack.filter((m) => !m.dead).map((m) => m.body);
  },

  find(body) {
    return this.pack.find((m) => m.body === body) || null;
  },

  alive() {
    return this.pack.filter((m) => !m.dead).length;
  },
};
