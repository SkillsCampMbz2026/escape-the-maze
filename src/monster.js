/* The monster: loads blue_monster.glb, rigs it, hunts you through the maze.

   The model has no animations and no skin — it is 51 rigid meshes in a named
   hierarchy, and every joint node sits at the origin with an identity
   transform. Rotating those nodes directly would swing each limb around the
   model's centre, so first we give each joint a real pivot: wrap its children
   in a group placed at the joint position and offset them back. After that a
   run cycle is just rotating those groups. */

const Monster = {
  /* Which joints to rig: the mesh that defines the pivot, whether the joint
     sits at the top or bottom of it, and the joint it hangs off. */
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

  HEIGHT: 2.05,        // world units, tuned against a 3.4-high wall
  CATCH_RANGE: 1.15,

  loaded: false,
  ready: null,

  /* ---------- Loading and rigging ---------- */

  load(THREE, url) {
    this.ready = new Promise((resolve, reject) => {
      new THREE.GLTFLoader().load(url, (gltf) => {
        this.template = this.rig(THREE, gltf.scene);
        this.loaded = true;
        resolve(this.template);
      }, undefined, reject);
    });
    return this.ready;
  },

  rig(THREE, root) {
    const byName = {};
    root.traverse((object) => {
      if (object.name) byName[object.name] = object;
      if (object.isMesh) {
        object.castShadow = true;
        object.frustumCulled = false;   // it is one logical creature, cull as a whole
        if (object.material) {
          object.material = object.material.clone();
          object.material.side = THREE.FrontSide;
        }
      }
    });

    /* Pivot positions, measured in the original model space before anything
       moves, so the measurements stay consistent with each other. */
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

    /* Apply parents before children: a child joint lives inside its parent's
       new wrapper, so its pivot has to be expressed relative to that. */
    const rigged = {};
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
      rigged[joint.name] = wrapper;
    });

    /* Scale to a menacing-but-fair height and stand it on the floor. */
    const bounds = new THREE.Box3().setFromObject(root);
    const scale = this.HEIGHT / (bounds.max.y - bounds.min.y);

    const body = new THREE.Group();          // yaw + travel
    body.name = 'MonsterBody';
    const inner = new THREE.Group();         // scale + ground offset + bob
    inner.name = 'MonsterInner';
    inner.scale.setScalar(scale);
    inner.position.y = -bounds.min.y * scale;
    inner.add(root);
    body.add(inner);

    /* Deliberately no Object3D references in userData: Object3D.clone deep
       copies userData through JSON, and a scene node is circular. Everything
       is found by name on the clone instead. */
    void rigged;
    return body;
  },

  /* ---------- Spawning ---------- */

  spawn(THREE, scene, maze, options) {
    const body = this.template.clone(true);

    // relink the rig on the clone by name (see the note in rig())
    const rigged = {};
    body.traverse((object) => {
      if (object.name && object.name.endsWith('__pivot')) {
        rigged[object.name.slice(0, -'__pivot'.length)] = object;
      }
    });

    scene.add(body);

    const eyeLight = new THREE.PointLight(0x86e3ff, 0, 9, 2);
    eyeLight.position.y = 1.6;
    body.add(eyeLight);

    this.state = {
      body,
      rig: rigged,
      inner: body.getObjectByName('MonsterInner'),
      baseY: 0,
      phase: Math.random() * Math.PI * 2,
      eyeLight,
      maze,
      tile: options.tile,
      speed: options.speed,
      grace: options.grace,
      cell: options.cell,
      x: options.cell.x * options.tile + options.tile / 2,
      z: options.cell.y * options.tile + options.tile / 2,
      yaw: 0,
      field: null,
      repathIn: 0,
      target: null,
      caught: false,
      distanceToPlayer: 999,
      stepTimer: 0,
    };

    body.position.set(this.state.x, 0, this.state.z);
    return this.state;
  },

  /* Farthest open cell from the player's start, so it never spawns on top of
     you, and never on the exit. */
  pickSpawn(maze, distanceFromStart) {
    let best = null;
    let bestScore = -1;
    for (let y = 1; y < maze.height - 1; y++) {
      for (let x = 1; x < maze.width - 1; x++) {
        if (maze.grid[y * maze.width + x]) continue;
        if (x === maze.exit.x && y === maze.exit.y) continue;
        const score = distanceFromStart[y * maze.width + x];
        if (score > bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }
    }
    return best || { x: maze.width - 2, y: 1 };
  },

  /* ---------- Hunting ---------- */

  /* Breadth-first field from the player: every open tile learns how many
     steps it is from them, so the monster only has to walk downhill. */
  fieldFrom(maze, cellX, cellY) {
    const field = new Int32Array(maze.width * maze.height).fill(-1);
    const start = cellY * maze.width + cellX;
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

  update(dt, player, onCatch) {
    const s = this.state;
    if (!s || s.caught) return;

    const tile = s.tile;
    const playerCellX = Math.floor(player.x / tile);
    const playerCellZ = Math.floor(player.z / tile);

    s.distanceToPlayer = Math.hypot(player.x - s.x, player.z - s.z);

    if (s.grace > 0) {
      s.grace -= dt;
      this.animate(dt, 0);
      return;
    }

    /* Re-path a few times a second, or the moment you change tile. */
    s.repathIn -= dt;
    if (!s.field || s.repathIn <= 0 || s.lastPlayerCell !== playerCellZ * s.maze.width + playerCellX) {
      s.field = this.fieldFrom(s.maze, playerCellX, playerCellZ);
      s.lastPlayerCell = playerCellZ * s.maze.width + playerCellX;
      s.repathIn = 0.3;
      s.target = null;
    }

    /* Pick the neighbouring tile closest to the player. */
    if (!s.target) {
      const cx = Math.floor(s.x / tile);
      const cz = Math.floor(s.z / tile);
      let bestCell = null;
      let bestDistance = s.field[cz * s.maze.width + cx];
      if (bestDistance < 0) bestDistance = Infinity;

      for (let d = 0; d < 4; d++) {
        const nx = cx + [1, -1, 0, 0][d];
        const ny = cz + [0, 0, 1, -1][d];
        if (nx < 0 || ny < 0 || nx >= s.maze.width || ny >= s.maze.height) continue;
        const value = s.field[ny * s.maze.width + nx];
        if (value < 0 || value >= bestDistance) continue;
        bestDistance = value;
        bestCell = { x: nx, y: ny };
      }

      if (bestCell) {
        s.target = {
          x: bestCell.x * tile + tile / 2,
          z: bestCell.y * tile + tile / 2,
        };
      }
    }

    /* Walk toward the target tile centre. */
    let moved = 0;
    if (s.target) {
      const dx = s.target.x - s.x;
      const dz = s.target.z - s.z;
      const gap = Math.hypot(dx, dz);
      if (gap < 0.12) {
        s.target = null;
      } else {
        const step = Math.min(gap, s.speed * dt);
        s.x += (dx / gap) * step;
        s.z += (dz / gap) * step;
        moved = step / Math.max(dt, 0.0001);

        // turn toward travel; the model faces +Z, so yaw is atan2(dx, dz)
        const want = Math.atan2(dx, dz);
        let delta = want - s.yaw;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        s.yaw += delta * Math.min(1, dt * 7);
      }
    }

    s.body.position.set(s.x, 0, s.z);
    s.body.rotation.y = s.yaw;

    // eyes glow brighter the closer it gets
    s.eyeLight.intensity = Math.max(0, 1.8 - s.distanceToPlayer * 0.12);

    this.animate(dt, moved);

    if (s.distanceToPlayer < this.CATCH_RANGE) {
      s.caught = true;
      onCatch();
    }
  },

  /* Procedural run cycle: legs counter-swing, knees fold on the backstroke,
     arms mirror the legs, torso bobs, head tracks. */
  animate(dt, speed) {
    const s = this.state;
    const rig = s.rig;
    const pace = Math.min(1, speed / s.speed);

    s.phase += dt * (3.4 + pace * 6.5);
    const t = s.phase;
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

    // gnashing head bob, and a lunge lean when it is right behind you
    if (rig.HeadPivot) {
      rig.HeadPivot.rotation.x = -0.12 + Math.sin(t * 2) * 0.06 * pace;
      rig.HeadPivot.rotation.z = Math.sin(t) * 0.05 * pace;
    }

    if (s.inner) {
      if (!s.baseY) s.baseY = s.inner.position.y;
      s.inner.position.y = s.baseY + Math.abs(Math.sin(t)) * 0.07 * pace;
      s.inner.rotation.x = -0.12 * pace;   // leans into the run
    }
  },

  /* Final lunge at the camera when it catches you. */
  lunge(dt, camera) {
    const s = this.state;
    if (!s) return;
    const dx = camera.position.x - s.x;
    const dz = camera.position.z - s.z;
    const gap = Math.hypot(dx, dz) || 1;
    if (gap > 0.55) {
      s.x += (dx / gap) * dt * 3.4;
      s.z += (dz / gap) * dt * 3.4;
      s.body.position.set(s.x, 0, s.z);
    }
    s.yaw = Math.atan2(dx, dz);
    s.body.rotation.y = s.yaw;
    s.phase += dt * 18;
    if (s.rig.HeadPivot) s.rig.HeadPivot.rotation.x = -0.5 + Math.sin(s.phase) * 0.25;
    s.eyeLight.intensity = 3;
  },

  remove(scene) {
    if (this.state && this.state.body) scene.remove(this.state.body);
    this.state = null;
  },
};
