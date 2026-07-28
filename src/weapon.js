/* The gun: a viewmodel welded to the camera, and hitscan fire.

   Shots are a raycast from the centre of the screen against the wall mesh and
   the monster together. Whichever is hit *first* wins, so walls give real
   cover — you cannot shoot through a corner. Hits that land on a node named
   Head count double. */

const Weapon = {
  RANGE: 44,
  MAG: 8,
  RELOAD_TIME: 1.25,
  BODY_DAMAGE: 22,
  HEAD_MULTIPLIER: 2.4,
  FIRE_DELAY: 0.16,

  ammo: 8,
  reloading: 0,
  cooldown: 0,
  recoil: 0,
  sway: 0,

  build(THREE, camera) {
    const gun = new THREE.Group();

    const steel = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.45, metalness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x14171d, roughness: 0.7, metalness: 0.4 });
    const grip = new THREE.MeshStandardMaterial({ color: 0x3a2b22, roughness: 0.9, metalness: 0.1 });

    const add = (geometry, material, x, y, z, rx = 0) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.rotation.x = rx;
      gun.add(mesh);
      return mesh;
    };

    add(new THREE.BoxGeometry(0.09, 0.1, 0.42), steel, 0, 0, -0.1);          // receiver
    add(new THREE.BoxGeometry(0.05, 0.05, 0.46), dark, 0, 0.012, -0.42);     // barrel
    add(new THREE.BoxGeometry(0.075, 0.16, 0.1), grip, 0, -0.11, 0.05, 0.22); // grip
    add(new THREE.BoxGeometry(0.06, 0.13, 0.07), dark, 0, -0.075, -0.12);    // magazine
    add(new THREE.BoxGeometry(0.018, 0.03, 0.02), dark, 0, 0.062, -0.6);     // front sight
    add(new THREE.BoxGeometry(0.05, 0.018, 0.09), steel, 0, 0.058, -0.02);   // rail

    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.012, -0.66);
    gun.add(this.muzzle);

    /* flash: a bright cross that pops for a couple of frames */
    const flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffe9a8, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
    });
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), flashMaterial);
    this.flash.position.copy(this.muzzle.position);
    gun.add(this.flash);

    this.flashLight = new THREE.PointLight(0xffd08a, 0, 12, 2);
    this.flashLight.position.copy(this.muzzle.position);
    gun.add(this.flashLight);

    /* Held low and right, angled slightly inward like an over-the-sights view */
    this.rest = new THREE.Vector3(0.19, -0.17, -0.34);
    gun.position.copy(this.rest);
    gun.rotation.y = 0.06;

    camera.add(gun);
    this.gun = gun;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = this.RANGE;
    this.ammo = this.MAG;
    return gun;
  },

  /* Returns { hit, headshot, distance, point } — hit is false on a miss,
     a wall, an empty magazine or while reloading. */
  fire(THREE, camera, walls, monsterBody) {
    if (this.cooldown > 0 || this.reloading > 0) return { hit: false, spent: false };
    if (this.ammo <= 0) {
      this.reload();
      return { hit: false, spent: false, dry: true };
    }

    this.ammo -= 1;
    this.cooldown = this.FIRE_DELAY;
    this.recoil = 1;
    this.flash.material.opacity = 1;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flashLight.intensity = 4.5;

    this.raycaster.setFromCamera({ x: 0, y: 0 }, camera);

    const targets = [];
    if (walls) targets.push(walls);
    if (monsterBody) targets.push(monsterBody);
    const hits = this.raycaster.intersectObjects(targets, true);
    if (!hits.length) return { hit: false, spent: true };

    const first = hits[0];

    /* Is the nearest thing the monster, or a wall in the way? */
    let node = first.object;
    let onMonster = false;
    let headshot = false;
    while (node) {
      if (node === monsterBody) { onMonster = true; break; }
      if (/Head|Tooth|Lips|Mouth|Eye|Pupil/.test(node.name || '')) headshot = true;
      node = node.parent;
    }

    if (!onMonster) return { hit: false, spent: true, wall: first.point };

    return {
      hit: true,
      spent: true,
      headshot,
      distance: first.distance,
      point: first.point,
      damage: this.BODY_DAMAGE * (headshot ? this.HEAD_MULTIPLIER : 1),
    };
  },

  reload() {
    if (this.reloading > 0 || this.ammo === this.MAG) return false;
    this.reloading = this.RELOAD_TIME;
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
        this.ammo = this.MAG;
      }
    }

    if (this.flash) {
      this.flash.material.opacity = Math.max(0, this.flash.material.opacity - dt * 22);
      this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 90);
    }

    if (!this.gun) return;

    /* walk sway, reload dip, and recoil kick */
    const dip = this.reloading > 0 ? Math.sin((1 - this.reloading / this.RELOAD_TIME) * Math.PI) : 0;
    const bobX = Math.sin(this.sway) * 0.008 * pace;
    const bobY = Math.abs(Math.cos(this.sway)) * 0.006 * pace;

    this.gun.position.set(
      this.rest.x + bobX,
      this.rest.y + bobY - dip * 0.16,
      this.rest.z + this.recoil * 0.07,
    );
    this.gun.rotation.x = -this.recoil * 0.28 - dip * 0.5;
    this.gun.rotation.z = dip * 0.3;
  },

  reset() {
    this.ammo = this.MAG;
    this.reloading = 0;
    this.cooldown = 0;
    this.recoil = 0;
  },
};
