/* Guns and chests.

   Each gun is a real model rather than a box: loaded once, measured, then
   scaled and turned so its barrel points down -Z at a sensible viewmodel size,
   because nothing about an imported model's scale or orientation can be
   assumed. Worlds 2 and 3 start you unarmed — the guns are in chests. */

const Arsenal = {
  /* Stats stay in code; the model is just the thing you look at. */
  GUNS: [
    {
      id: 'm4a1', name: 'M4A1', file: 'assets/gun_m4a1.glb',
      mag: 30, damage: 16, pellets: 1, spread: 0.014, delay: 0.09,
      reload: 2, auto: true, headMultiplier: 2, range: 70,
      view: { width: 0.34, x: 0.13, y: -0.15, z: -0.26 },
    },
    {
      id: 'deagle', name: 'Desert Eagle', file: 'assets/gun_deagle.glb',
      mag: 7, damage: 52, pellets: 1, spread: 0.004, delay: 0.34,
      reload: 1.6, auto: false, headMultiplier: 2.6, range: 60,
      view: { width: 0.24, x: 0.12, y: -0.14, z: -0.22 },
    },
    {
      id: 'badger', name: 'Honey Badger', file: 'assets/gun_badger.glb',
      mag: 20, damage: 26, pellets: 1, spread: 0.009, delay: 0.13,
      reload: 1.8, auto: true, headMultiplier: 2.2, range: 80,
      view: { width: 0.32, x: 0.13, y: -0.15, z: -0.25 },
    },
  ],

  models: {},
  chestModel: null,
  chests: [],
  loaded: false,

  /* ---------- Loading ---------- */

  load(THREE) {
    this.THREE = THREE;
    const loader = new THREE.GLTFLoader();
    const one = (url) => new Promise((resolve) => {
      loader.load(url, (gltf) => resolve(gltf.scene), undefined, () => resolve(null));
    });

    return Promise.all([
      ...this.GUNS.map((spec) => one(spec.file)),
      one('assets/chest.glb'),
    ]).then((results) => {
      this.GUNS.forEach((spec, i) => {
        if (results[i]) this.models[spec.id] = this.prepareGun(THREE, results[i], spec);
      });
      const chest = results[results.length - 1];
      if (chest) this.chestModel = this.prepareChest(THREE, chest);
      this.loaded = true;
      return this;
    });
  },

  /* Fit a model into a box `width` across, with its long axis down -Z. */
  prepareGun(THREE, scene, spec) {
    scene.traverse((o) => {
      if (o.isMesh) {
        o.frustumCulled = false;
        o.castShadow = false;
        if (o.material) o.material.side = THREE.FrontSide;
      }
    });

    const holder = new THREE.Group();
    holder.add(scene);

    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    box.getSize(size);

    /* The longest horizontal axis is the barrel. Turn it onto -Z. */
    const longest = size.x > size.z ? 'x' : 'z';
    if (longest === 'x') scene.rotation.y = size.x > 0 ? Math.PI / 2 : -Math.PI / 2;

    const after = new THREE.Box3().setFromObject(scene);
    const span = new THREE.Vector3();
    after.getSize(span);
    const scale = spec.view.width / Math.max(0.0001, Math.max(span.x, span.z));
    holder.scale.setScalar(scale);

    const centre = new THREE.Vector3();
    after.getCenter(centre);
    scene.position.sub(centre);

    const rig = new THREE.Group();
    rig.add(holder);
    rig.userData.muzzle = new THREE.Vector3(0, 0, -spec.view.width * 1.15);
    return rig;
  },

  prepareChest(THREE, scene) {
    scene.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    const holder = new THREE.Group();
    holder.add(scene);

    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    const scale = 1.1 / Math.max(0.0001, size.y);      // ~1.1 units tall
    holder.scale.setScalar(scale);
    holder.position.set(
      -(box.min.x + box.max.x) / 2 * scale,
      -box.min.y * scale,
      -(box.min.z + box.max.z) / 2 * scale,
    );

    const rig = new THREE.Group();
    rig.add(holder);
    return rig;
  },

  /* ---------- Chests in the level ---------- */

  /* Put `count` chests in open cells.

     They used to go to the furthest reachable cells, which made the first gun
     a long hunt while a pack chased you unarmed. Instead each chest aims at a
     share of the way out: the first is close enough to reach in the head start,
     the last is a proper trek. */
  place(THREE, scene, maze, tile, count, fromStart, options = {}) {
    this.clear(scene);
    if (!this.chestModel) return this.chests;

    const open = [];
    let furthest = 1;
    for (let y = 1; y < maze.height - 1; y++) {
      for (let x = 1; x < maze.width - 1; x++) {
        if (maze.grid[y * maze.width + x]) continue;
        const distance = fromStart[y * maze.width + x];
        if (distance < 2) continue;            // not underneath your feet
        open.push({ x, y, distance });
        if (distance > furthest) furthest = distance;
      }
    }
    if (!open.length) return this.chests;

    /* Bands at roughly a fifth, half and three quarters of the way out. The
       first chest is put a couple of tiles from the spawn instead, so you are
       armed before anything reaches you. */
    const bands = [0.2, 0.45, 0.72, 0.9, 1];
    const chosen = [];
    for (let i = 0; i < count && open.length; i++) {
      const target = i === 0 && options.firstAtStart
        ? 2.5
        : furthest * bands[Math.min(i, bands.length - 1)];
      let best = null;
      let bestScore = Infinity;
      open.forEach((cell) => {
        // closeness to the target distance, plus a push away from other chests
        let score = Math.abs(cell.distance - target);
        chosen.forEach((taken) => {
          const gap = Math.abs(taken.x - cell.x) + Math.abs(taken.y - cell.y);
          // the spawn chest is meant to be close, so it is exempt from spacing
          const room = chosen.length === 1 && options.firstAtStart ? 6 : 12;
          if (gap < room) score += (room - gap) * 2;
        });
        if (score < bestScore) {
          bestScore = score;
          best = cell;
        }
      });
      if (!best) break;
      chosen.push(best);
      open.splice(open.indexOf(best), 1);
    }

    chosen.forEach((cell, index) => {
      const rig = this.chestModel.clone(true);
      rig.position.set(cell.x * tile + tile / 2, 0, cell.y * tile + tile / 2);
      rig.rotation.y = Math.random() * Math.PI * 2;
      scene.add(rig);

      const glow = new THREE.PointLight(0xffd76b, 2.2, 14, 2);
      glow.position.set(rig.position.x, 1.3, rig.position.z);
      scene.add(glow);

      /* A pillar of light, the same trick the exit uses: walls hide the chest
         itself, but you can see this over the top of them from a corridor away. */
      const beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.3, 24, 10, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xffc53d, transparent: true, opacity: 0.2,
          side: THREE.DoubleSide, depthWrite: false,
        }),
      );
      beacon.position.set(rig.position.x, 12, rig.position.z);
      scene.add(beacon);

      /* and a slowly turning ring at head height, which reads as "loot here" */
      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(0.75, 0.045, 8, 28),
        new THREE.MeshBasicMaterial({ color: 0xffd76b, transparent: true, opacity: 0.75 }),
      );
      halo.rotation.x = Math.PI / 2;
      halo.position.set(rig.position.x, 1.7, rig.position.z);
      scene.add(halo);

      this.chests.push({
        rig, glow, beacon, halo, cell, index,
        x: rig.position.x, z: rig.position.z,
        open: false, lid: 0,
      });
    });

    return this.chests;
  },

  /* The nearest unopened chest you are standing next to. */
  nearest(x, z, reach = 2.4) {
    let best = null;
    let bestGap = reach;
    this.chests.forEach((chest) => {
      if (chest.open) return;
      const gap = Math.hypot(chest.x - x, chest.z - z);
      if (gap < bestGap) {
        bestGap = gap;
        best = chest;
      }
    });
    return best;
  },

  /* Open it, and hand back the gun inside. `owned` are ids you already hold,
     so a second chest never gives you a duplicate while anything is left. */
  loot(chest, owned) {
    if (!chest || chest.open) return null;
    chest.open = true;

    const fresh = this.GUNS.filter((spec) => !owned.includes(spec.id) && this.models[spec.id]);
    const pool = fresh.length ? fresh : this.GUNS.filter((spec) => this.models[spec.id]);
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  },

  /* Lid swings up, then the beacon and ring go out so you can tell at a glance
     which ones you have already been to. */
  animate(dt) {
    const now = performance.now();
    this.chests.forEach((chest) => {
      if (chest.open) {
        if (chest.lid < 1) {
          chest.lid = Math.min(1, chest.lid + dt * 2.2);
          chest.rig.rotation.x = -chest.lid * 0.12;
          chest.rig.position.y = chest.lid * 0.05;
        }
        const fade = 1 - chest.lid;
        chest.glow.intensity = 2.2 * fade;
        chest.beacon.material.opacity = 0.2 * fade;
        chest.halo.material.opacity = 0.75 * fade;
        chest.halo.visible = fade > 0.02;
        return;
      }
      chest.glow.intensity = 1.9 + Math.sin(now * 0.004 + chest.index) * 0.5;
      chest.halo.rotation.z = now * 0.0012 + chest.index;
      chest.halo.position.y = 1.7 + Math.sin(now * 0.002 + chest.index) * 0.14;
      chest.beacon.material.opacity = 0.16 + Math.sin(now * 0.003 + chest.index) * 0.06;
    });
  },

  clear(scene) {
    this.chests.forEach((chest) => {
      scene.remove(chest.rig);
      scene.remove(chest.glow);
      scene.remove(chest.beacon);
      scene.remove(chest.halo);
    });
    this.chests = [];
  },

  spec(id) {
    return this.GUNS.find((g) => g.id === id) || null;
  },
};
