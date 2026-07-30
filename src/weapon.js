/* The guns you carry.

   Stats and behaviour live in arsenal.js; this holds the inventory, the firing
   logic and the viewmodel animation. In worlds 2 and 3 the inventory starts
   empty and only fills from chests, so `owned` gates everything. */

const Guns = {
  owned: [],          // gun ids, in pickup order
  current: -1,        // index into `owned`, or -1 for empty hands
  ammo: {},           // by gun id
  reloading: 0,
  cooldown: 0,
  recoil: 0,
  sway: 0,
  rigs: {},

  get LIST() {
    return Arsenal.GUNS;
  },

  get spec() {
    const id = this.owned[this.current];
    return id ? Arsenal.spec(id) : null;
  },

  get rounds() {
    const id = this.owned[this.current];
    return id ? (this.ammo[id] || 0) : 0;
  },

  get magSize() {
    const spec = this.spec;
    return spec ? spec.mag : 0;
  },

  get armed() {
    return this.current >= 0 && Boolean(this.spec);
  },

  /* ---------- Setup ---------- */

  build(THREE, camera) {
    this.THREE = THREE;
    this.camera = camera;
    this.raycaster = new THREE.Raycaster();
    this.rest = new THREE.Vector3(0.2, -0.18, -0.4);

    Arsenal.GUNS.forEach((spec) => {
      const model = Arsenal.models[spec.id];
      if (!model) return;
      const rig = model.clone(true);

      const flash = new THREE.Mesh(
        new THREE.PlaneGeometry(0.3, 0.3),
        new THREE.MeshBasicMaterial({
          color: 0xffe9a8, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
        }),
      );
      const muzzle = model.userData.muzzle || new THREE.Vector3(0, 0, -0.5);
      flash.position.copy(muzzle);
      rig.add(flash);

      const light = new THREE.PointLight(0xffd08a, 0, 10, 2);
      light.position.copy(muzzle);
      rig.add(light);

      rig.userData.flash = flash;
      rig.userData.light = light;
      rig.position.set(spec.view.x, spec.view.y, spec.view.z);
      rig.visible = false;
      camera.add(rig);
      this.rigs[spec.id] = rig;
    });
  },

  /* startArmed: world 1 hands you a rifle; the others make you find one. */
  reset(startArmed) {
    this.owned = [];
    this.ammo = {};
    this.current = -1;
    this.reloading = 0;
    this.cooldown = 0;
    this.recoil = 0;
    Object.values(this.rigs).forEach((rig) => { rig.visible = false; });
    if (startArmed) this.give('m4a1');
  },

  give(id) {
    const spec = Arsenal.spec(id);
    if (!spec) return false;
    if (this.owned.includes(id)) {
      // a duplicate is a resupply
      this.ammo[id] = spec.mag;
      return true;
    }
    this.owned.push(id);
    this.ammo[id] = spec.mag;
    this.select(this.owned.length - 1);
    return true;
  },

  select(index) {
    if (index < 0 || index >= this.owned.length) return false;
    const showing = this.owned[this.current];
    if (showing && this.rigs[showing]) this.rigs[showing].visible = false;
    this.current = index;
    const id = this.owned[index];
    if (this.rigs[id]) this.rigs[id].visible = true;
    this.reloading = 0;
    this.cooldown = 0.18;
    this.recoil = 0.5;
    return true;
  },

  next() {
    if (this.owned.length < 2) return false;
    return this.select((this.current + 1) % this.owned.length);
  },

  /* ---------- Firing ---------- */

  fire(THREE, camera, walls, bodies) {
    const spec = this.spec;
    if (!spec) return { spent: false, empty: true, hits: [] };
    if (this.cooldown > 0 || this.reloading > 0) return { spent: false, hits: [] };

    const id = this.owned[this.current];
    if ((this.ammo[id] || 0) <= 0) {
      this.reload();
      return { spent: false, dry: true, hits: [] };
    }

    this.ammo[id] -= 1;
    this.cooldown = spec.delay;
    this.recoil = 1;

    const rig = this.rigs[id];
    if (rig) {
      rig.userData.flash.material.opacity = 1;
      rig.userData.flash.rotation.z = Math.random() * Math.PI;
      rig.userData.light.intensity = 4.5;
    }

    const targets = [];
    if (walls) targets.push(walls);
    bodies.forEach((body) => targets.push(body));

    this.raycaster.far = spec.range;
    const hits = [];

    for (let pellet = 0; pellet < spec.pellets; pellet++) {
      const ox = spec.spread ? (Math.random() - 0.5) * 2 * spec.spread : 0;
      const oy = spec.spread ? (Math.random() - 0.5) * 2 * spec.spread : 0;
      this.raycaster.setFromCamera({ x: ox, y: oy }, camera);

      const found = this.raycaster.intersectObjects(targets, true);
      if (!found.length) continue;

      const first = found[0];
      let node = first.object;
      let body = null;
      let headshot = false;
      while (node) {
        if (bodies.includes(node)) { body = node; break; }
        if (/Head|Tooth|Lips|Mouth|Eye|Pupil/.test(node.name || '')) headshot = true;
        node = node.parent;
      }
      if (!body) continue;      // a wall was nearer, so it stopped the shot

      hits.push({
        body,
        headshot,
        point: first.point,
        damage: spec.damage * (headshot ? spec.headMultiplier : 1),
      });
    }

    return { spent: true, hits };
  },

  reload() {
    const spec = this.spec;
    if (!spec) return false;
    const id = this.owned[this.current];
    if (this.reloading > 0 || this.ammo[id] === spec.mag) return false;
    this.reloading = spec.reload;
    return true;
  },

  update(dt, pace) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.recoil *= Math.exp(-dt * 11);
    this.sway += dt * pace * 1.8;

    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.reloading = 0;
        const spec = this.spec;
        if (spec) this.ammo[this.owned[this.current]] = spec.mag;
      }
    }

    const spec = this.spec;
    if (!spec) return;
    const rig = this.rigs[this.owned[this.current]];
    if (!rig) return;

    const flash = rig.userData.flash;
    flash.material.opacity = Math.max(0, flash.material.opacity - dt * 22);
    rig.userData.light.intensity = Math.max(0, rig.userData.light.intensity - dt * 90);

    const dip = this.reloading > 0
      ? Math.sin((1 - this.reloading / spec.reload) * Math.PI)
      : 0;

    rig.position.set(
      spec.view.x + Math.sin(this.sway) * 0.008 * pace,
      spec.view.y + Math.abs(Math.cos(this.sway)) * 0.006 * pace - dip * 0.16,
      spec.view.z + this.recoil * 0.07,
    );
    rig.rotation.x = -this.recoil * 0.3 - dip * 0.5;
    rig.rotation.z = dip * 0.3;
  },
};
