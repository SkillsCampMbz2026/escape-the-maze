/* Three guns, all hitscan.

   A shot raycasts against the wall mesh and every monster together, so the
   nearest thing wins and walls give real cover. The shotgun fires a cone of
   pellets, each traced separately. Viewmodels are built once and shown or
   hidden on switch, so swapping weapons costs nothing. */

const Guns = {
  LIST: [
    {
      id: 'pistol', name: 'Sidearm', key: '1',
      mag: 8, damage: 22, pellets: 1, spread: 0,
      delay: 0.16, reload: 1.2, auto: false, headMultiplier: 2.4, range: 46,
    },
    {
      id: 'shotgun', name: 'Breacher', key: '2',
      mag: 5, damage: 9, pellets: 8, spread: 0.06,
      delay: 0.72, reload: 2.1, auto: false, headMultiplier: 1.6, range: 26,
    },
    {
      id: 'smg', name: 'Stutter', key: '3',
      mag: 28, damage: 11, pellets: 1, spread: 0.014,
      delay: 0.085, reload: 1.5, auto: true, headMultiplier: 2, range: 40,
    },
  ],

  current: 0,
  ammo: [],
  reloading: 0,
  cooldown: 0,
  recoil: 0,
  sway: 0,
  models: [],

  get spec() {
    return this.LIST[this.current];
  },

  /* ---------- Viewmodels ---------- */

  build(THREE, camera) {
    this.raycaster = new THREE.Raycaster();
    this.rest = new THREE.Vector3(0.19, -0.17, -0.34);

    const steel = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.45, metalness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x14171d, roughness: 0.7, metalness: 0.4 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x3a2b22, roughness: 0.9, metalness: 0.1 });

    const box = (group, w, h, d, material, x, y, z, rx = 0) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z);
      mesh.rotation.x = rx;
      group.add(mesh);
      return mesh;
    };

    this.LIST.forEach((spec, index) => {
      const gun = new THREE.Group();

      if (spec.id === 'pistol') {
        box(gun, 0.09, 0.10, 0.42, steel, 0, 0, -0.10);
        box(gun, 0.05, 0.05, 0.46, dark, 0, 0.012, -0.42);
        box(gun, 0.075, 0.16, 0.10, wood, 0, -0.11, 0.05, 0.22);
        box(gun, 0.06, 0.13, 0.07, dark, 0, -0.075, -0.12);
        box(gun, 0.018, 0.03, 0.02, dark, 0, 0.062, -0.60);
        gun.userData.muzzle = new THREE.Vector3(0, 0.012, -0.66);
      } else if (spec.id === 'shotgun') {
        box(gun, 0.13, 0.12, 0.5, wood, 0, -0.01, 0.02);                 // stock/body
        box(gun, 0.055, 0.055, 0.72, dark, -0.032, 0.03, -0.5);          // barrel L
        box(gun, 0.055, 0.055, 0.72, dark, 0.032, 0.03, -0.5);           // barrel R
        box(gun, 0.11, 0.05, 0.18, steel, 0, -0.045, -0.3);              // pump
        box(gun, 0.08, 0.15, 0.1, wood, 0, -0.12, 0.12, 0.26);           // grip
        gun.userData.muzzle = new THREE.Vector3(0, 0.03, -0.88);
      } else {
        box(gun, 0.10, 0.11, 0.34, steel, 0, 0, -0.06);
        box(gun, 0.042, 0.042, 0.4, dark, 0, 0.02, -0.36);
        box(gun, 0.06, 0.22, 0.075, dark, 0, -0.13, -0.02);              // long mag
        box(gun, 0.075, 0.14, 0.1, dark, 0, -0.1, 0.12, 0.3);            // grip
        box(gun, 0.05, 0.06, 0.2, steel, 0, 0.02, 0.2);                  // stock
        gun.userData.muzzle = new THREE.Vector3(0, 0.02, -0.58);
      }

      const flash = new THREE.Mesh(
        new THREE.PlaneGeometry(0.36, 0.36),
        new THREE.MeshBasicMaterial({
          color: 0xffe9a8, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
        }),
      );
      flash.position.copy(gun.userData.muzzle);
      gun.add(flash);

      const light = new THREE.PointLight(0xffd08a, 0, 12, 2);
      light.position.copy(gun.userData.muzzle);
      gun.add(light);

      gun.userData.flash = flash;
      gun.userData.light = light;
      gun.position.copy(this.rest);
      gun.rotation.y = 0.06;
      gun.visible = index === 0;

      camera.add(gun);
      this.models.push(gun);
      this.ammo.push(spec.mag);
    });
  },

  select(index) {
    if (index < 0 || index >= this.LIST.length || index === this.current) return false;
    this.models[this.current].visible = false;
    this.current = index;
    this.models[index].visible = true;
    this.reloading = 0;
    this.cooldown = 0.2;          // brief beat while it comes up
    this.recoil = 0.6;
    return true;
  },

  selectById(id) {
    return this.select(this.LIST.findIndex((spec) => spec.id === id));
  },

  /* ---------- Firing ---------- */

  /* Returns { spent, dry, hits: [{ body, damage, headshot, point }] }.
     One entry per pellet that found a monster. */
  fire(THREE, camera, walls, bodies) {
    const spec = this.spec;
    if (this.cooldown > 0 || this.reloading > 0) return { spent: false, hits: [] };
    if (this.ammo[this.current] <= 0) {
      this.reload();
      return { spent: false, dry: true, hits: [] };
    }

    this.ammo[this.current] -= 1;
    this.cooldown = spec.delay;
    this.recoil = 1;

    const model = this.models[this.current];
    model.userData.flash.material.opacity = 1;
    model.userData.flash.rotation.z = Math.random() * Math.PI;
    model.userData.light.intensity = spec.id === 'shotgun' ? 7 : 4.5;

    const targets = [];
    if (walls) targets.push(walls);
    bodies.forEach((body) => targets.push(body));

    this.raycaster.far = spec.range;
    const hits = [];

    for (let pellet = 0; pellet < spec.pellets; pellet++) {
      // a cone around the crosshair; the first pellet of a single-shot gun is dead centre
      const spread = spec.spread;
      const ox = spread ? (Math.random() - 0.5) * 2 * spread : 0;
      const oy = spread ? (Math.random() - 0.5) * 2 * spread : 0;
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
      if (!body) continue;      // a wall was nearer, so it stopped the pellet

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
    if (this.reloading > 0 || this.ammo[this.current] === spec.mag) return false;
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
        this.ammo[this.current] = this.spec.mag;
      }
    }

    const model = this.models[this.current];
    if (!model) return;

    const flash = model.userData.flash;
    flash.material.opacity = Math.max(0, flash.material.opacity - dt * 22);
    model.userData.light.intensity = Math.max(0, model.userData.light.intensity - dt * 90);

    const dip = this.reloading > 0
      ? Math.sin((1 - this.reloading / this.spec.reload) * Math.PI)
      : 0;
    const kick = this.spec.id === 'shotgun' ? 0.11 : 0.07;

    model.position.set(
      this.rest.x + Math.sin(this.sway) * 0.008 * pace,
      this.rest.y + Math.abs(Math.cos(this.sway)) * 0.006 * pace - dip * 0.16,
      this.rest.z + this.recoil * kick,
    );
    model.rotation.x = -this.recoil * (this.spec.id === 'shotgun' ? 0.4 : 0.28) - dip * 0.5;
    model.rotation.z = dip * 0.3;
  },

  reset() {
    this.LIST.forEach((spec, i) => { this.ammo[i] = spec.mag; });
    this.reloading = 0;
    this.cooldown = 0;
    this.recoil = 0;
    if (this.models.length) {
      this.models.forEach((model, i) => { model.visible = i === 0; });
      this.current = 0;
    }
  },

  get magSize() {
    return this.spec.mag;
  },

  get rounds() {
    return this.ammo[this.current];
  },
};
