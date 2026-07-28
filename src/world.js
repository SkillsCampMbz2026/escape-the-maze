/* Builds the Three.js scene for a maze: walls, floor, sky, lights and exit.

   Every texture is generated into a canvas at runtime, so the game ships no
   image files. Walls are one InstancedMesh — a 15x15 maze is ~400 blocks, and
   drawing them individually would be 400 draw calls instead of one. */

const TILE = 3;          // world units per grid tile
const WALL_HEIGHT = 3.4;

const World = {
  /* ---------- Procedural textures ---------- */

  canvas(size, paint) {
    const surface = document.createElement('canvas');
    surface.width = size;
    surface.height = size;
    paint(surface.getContext('2d'), size);
    return surface;
  },

  stoneTexture() {
    return this.canvas(256, (g, s) => {
      g.fillStyle = '#4a4a52';
      g.fillRect(0, 0, s, s);

      // courses of blocks, offset every other row
      const rows = 8;
      const h = s / rows;
      for (let row = 0; row < rows; row++) {
        const offset = (row % 2) * (s / 8);
        for (let col = -1; col < 4; col++) {
          const x = offset + col * (s / 4);
          const shade = 62 + Math.random() * 26;
          g.fillStyle = `rgb(${shade}, ${shade - 2}, ${shade + 6})`;
          g.fillRect(x + 2, row * h + 2, s / 4 - 4, h - 4);
          g.fillStyle = 'rgba(0,0,0,0.25)';
          g.fillRect(x + 2, row * h + h - 5, s / 4 - 4, 3);
        }
      }

      // grain
      for (let i = 0; i < 4000; i++) {
        g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
        g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
      }
    });
  },

  groundTexture() {
    return this.canvas(256, (g, s) => {
      g.fillStyle = '#2b2f36';
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 2600; i++) {
        const v = Math.random();
        g.fillStyle = v > 0.5 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.13)';
        const r = 1 + Math.random() * 3;
        g.beginPath();
        g.arc(Math.random() * s, Math.random() * s, r, 0, Math.PI * 2);
        g.fill();
      }
      // faint flagstone seams
      g.strokeStyle = 'rgba(0,0,0,0.28)';
      g.lineWidth = 2;
      for (let i = 1; i < 4; i++) {
        g.beginPath();
        g.moveTo((s / 4) * i, 0);
        g.lineTo((s / 4) * i, s);
        g.moveTo(0, (s / 4) * i);
        g.lineTo(s, (s / 4) * i);
        g.stroke();
      }
    });
  },

  skyTexture() {
    return this.canvas(256, (g, s) => {
      const sky = g.createLinearGradient(0, 0, 0, s);
      sky.addColorStop(0, '#0b1026');
      sky.addColorStop(0.55, '#1c2748');
      sky.addColorStop(1, '#3a3f5c');
      g.fillStyle = sky;
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 260; i++) {
        const y = Math.random() * s * 0.7;
        g.fillStyle = `rgba(226,232,255,${0.2 + Math.random() * 0.7})`;
        g.fillRect(Math.random() * s, y, 1, 1);
      }
    });
  },

  /* ---------- Scene ---------- */

  build(THREE, scene, maze, quality) {
    const group = new THREE.Group();
    const created = { meshes: [], lights: [] };

    const stone = new THREE.CanvasTexture(this.stoneTexture());
    stone.wrapS = stone.wrapT = THREE.RepeatWrapping;
    stone.anisotropy = quality.anisotropy;

    const ground = new THREE.CanvasTexture(this.groundTexture());
    ground.wrapS = ground.wrapT = THREE.RepeatWrapping;
    ground.repeat.set(maze.width, maze.height);
    ground.anisotropy = quality.anisotropy;

    /* floor */
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(maze.width * TILE, maze.height * TILE),
      new THREE.MeshStandardMaterial({ map: ground, roughness: 0.95, metalness: 0 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((maze.width * TILE) / 2, 0, (maze.height * TILE) / 2);
    floor.receiveShadow = quality.shadows;
    group.add(floor);

    /* walls, all in one instanced draw */
    const solidCount = maze.grid.reduce((total, cell) => total + cell, 0);
    const wallGeometry = new THREE.BoxGeometry(TILE, WALL_HEIGHT, TILE);
    const wallMaterial = new THREE.MeshStandardMaterial({ map: stone, roughness: 0.9, metalness: 0.05 });
    const walls = new THREE.InstancedMesh(wallGeometry, wallMaterial, solidCount);
    walls.castShadow = quality.shadows;
    walls.receiveShadow = quality.shadows;

    const matrix = new THREE.Matrix4();
    let index = 0;
    for (let y = 0; y < maze.height; y++) {
      for (let x = 0; x < maze.width; x++) {
        if (!maze.grid[y * maze.width + x]) continue;
        matrix.makeTranslation(x * TILE + TILE / 2, WALL_HEIGHT / 2, y * TILE + TILE / 2);
        walls.setMatrixAt(index++, matrix);
      }
    }
    walls.instanceMatrix.needsUpdate = true;
    group.add(walls);

    /* the exit: a glowing gate you can see down a corridor */
    const exitPosition = new THREE.Vector3(
      maze.exit.x * TILE + TILE / 2, 0, maze.exit.y * TILE + TILE / 2,
    );

    const portal = new THREE.Mesh(
      new THREE.TorusGeometry(1.05, 0.16, 12, 32),
      new THREE.MeshStandardMaterial({
        color: 0x22c55e, emissive: 0x22c55e, emissiveIntensity: 1.4, roughness: 0.35,
      }),
    );
    portal.position.copy(exitPosition).setY(1.5);
    group.add(portal);

    const shimmer = new THREE.Mesh(
      new THREE.CircleGeometry(1, 32),
      new THREE.MeshBasicMaterial({ color: 0x86efac, transparent: true, opacity: 0.22, side: THREE.DoubleSide }),
    );
    shimmer.position.copy(portal.position);
    group.add(shimmer);

    const exitGlow = new THREE.PointLight(0x4ade80, 2.4, 14, 2);
    exitGlow.position.copy(exitPosition).setY(1.8);
    group.add(exitGlow);

    /* a marker pillar of light so the goal is findable from a distance */
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 26, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x4ade80, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    beacon.position.copy(exitPosition).setY(13);
    group.add(beacon);

    /* lighting */
    const hemi = new THREE.HemisphereLight(0x8ea2d0, 0x2b2f36, 0.55);
    group.add(hemi);

    const moon = new THREE.DirectionalLight(0xbcd0ff, 0.85);
    moon.position.set(maze.width * TILE * 0.3, 40, -maze.height * TILE * 0.2);
    moon.target.position.set((maze.width * TILE) / 2, 0, (maze.height * TILE) / 2);
    group.add(moon.target);

    if (quality.shadows) {
      moon.castShadow = true;
      moon.shadow.mapSize.set(quality.shadowMap, quality.shadowMap);
      const span = Math.max(maze.width, maze.height) * TILE * 0.6;
      Object.assign(moon.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 120 });
      moon.shadow.bias = -0.0012;
      moon.shadow.camera.updateProjectionMatrix();
    }
    group.add(moon);

    scene.add(group);
    scene.fog = new THREE.FogExp2(0x141a2e, 0.045);

    const sky = new THREE.CanvasTexture(this.skyTexture());
    sky.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = sky;

    created.group = group;
    created.portal = portal;
    created.shimmer = shimmer;
    created.exitGlow = exitGlow;
    created.beacon = beacon;
    created.exitPosition = exitPosition;
    created.dispose = () => {
      scene.remove(group);
      group.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => {
            if (material.map) material.map.dispose();
            material.dispose();
          });
        }
      });
      sky.dispose();
    };

    return created;
  },

  TILE,
  WALL_HEIGHT,
};
