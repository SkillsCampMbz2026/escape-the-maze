/* Builds the Three.js scene for a maze, styled by a world palette.

   Every texture is painted into a canvas at runtime, so the game ships no
   image files. Walls are one InstancedMesh — a large maze is well over a
   thousand blocks, and drawing them individually would be a thousand draw
   calls instead of one. */

const TILE = 3;

const World = {
  TILE,

  canvas(size, paint) {
    const surface = document.createElement('canvas');
    surface.width = size;
    surface.height = size;
    paint(surface.getContext('2d'), size);
    return surface;
  },

  stoneTexture(palette) {
    return this.canvas(256, (g, s) => {
      g.fillStyle = palette.stoneBase;
      g.fillRect(0, 0, s, s);

      const [base, spread] = palette.stoneBlock;
      const rows = 8;
      const h = s / rows;
      for (let row = 0; row < rows; row++) {
        const offset = (row % 2) * (s / 8);
        for (let col = -1; col < 4; col++) {
          const x = offset + col * (s / 4);
          const shade = base + Math.random() * spread;
          g.fillStyle = `rgb(${shade}, ${shade * 0.92}, ${shade * 0.9})`;
          g.fillRect(x + 2, row * h + 2, s / 4 - 4, h - 4);
          g.fillStyle = palette.stoneMortar;
          g.fillRect(x + 2, row * h + h - 5, s / 4 - 4, 3);
        }
      }

      for (let i = 0; i < 4000; i++) {
        g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
        g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
      }
    });
  },

  groundTexture(palette) {
    return this.canvas(256, (g, s) => {
      g.fillStyle = palette.ground;
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 2600; i++) {
        g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.13)';
        g.beginPath();
        g.arc(Math.random() * s, Math.random() * s, 1 + Math.random() * 3, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = palette.groundSeam;
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

  skyTexture(palette) {
    return this.canvas(256, (g, s) => {
      const sky = g.createLinearGradient(0, 0, 0, s);
      sky.addColorStop(0, palette.sky[0]);
      sky.addColorStop(0.55, palette.sky[1]);
      sky.addColorStop(1, palette.sky[2]);
      g.fillStyle = sky;
      g.fillRect(0, 0, s, s);

      if (palette.stars) {
        for (let i = 0; i < 260; i++) {
          g.fillStyle = `rgba(226,232,255,${0.2 + Math.random() * 0.7})`;
          g.fillRect(Math.random() * s, Math.random() * s * 0.7, 1, 1);
        }
      } else {
        // embers drifting up from somewhere below
        for (let i = 0; i < 150; i++) {
          g.fillStyle = `rgba(255,${120 + Math.random() * 90 | 0},60,${0.2 + Math.random() * 0.5})`;
          g.fillRect(Math.random() * s, s * 0.4 + Math.random() * s * 0.6, 2, 2);
        }
      }
    });
  },

  build(THREE, scene, maze, quality, worldDef) {
    const palette = worldDef.palette;
    const wallHeight = worldDef.wallHeight;
    const group = new THREE.Group();
    const created = {};

    const stone = new THREE.CanvasTexture(this.stoneTexture(palette));
    stone.wrapS = stone.wrapT = THREE.RepeatWrapping;
    stone.anisotropy = quality.anisotropy;

    const ground = new THREE.CanvasTexture(this.groundTexture(palette));
    ground.wrapS = ground.wrapT = THREE.RepeatWrapping;
    ground.repeat.set(maze.width, maze.height);
    ground.anisotropy = quality.anisotropy;

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(maze.width * TILE, maze.height * TILE),
      new THREE.MeshStandardMaterial({ map: ground, roughness: 0.95, metalness: 0 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((maze.width * TILE) / 2, 0, (maze.height * TILE) / 2);
    floor.receiveShadow = quality.shadows;
    group.add(floor);

    const solidCount = maze.grid.reduce((total, cell) => total + cell, 0);
    const walls = new THREE.InstancedMesh(
      new THREE.BoxGeometry(TILE, wallHeight, TILE),
      new THREE.MeshStandardMaterial({ map: stone, roughness: 0.9, metalness: 0.05 }),
      solidCount,
    );
    walls.castShadow = quality.shadows;
    walls.receiveShadow = quality.shadows;

    const matrix = new THREE.Matrix4();
    let index = 0;
    for (let y = 0; y < maze.height; y++) {
      for (let x = 0; x < maze.width; x++) {
        if (!maze.grid[y * maze.width + x]) continue;
        matrix.makeTranslation(x * TILE + TILE / 2, wallHeight / 2, y * TILE + TILE / 2);
        walls.setMatrixAt(index++, matrix);
      }
    }
    walls.instanceMatrix.needsUpdate = true;
    group.add(walls);

    /* the exit */
    const exitPosition = new THREE.Vector3(
      maze.exit.x * TILE + TILE / 2, 0, maze.exit.y * TILE + TILE / 2,
    );

    const portal = new THREE.Mesh(
      new THREE.TorusGeometry(1.05, 0.16, 12, 32),
      new THREE.MeshStandardMaterial({
        color: palette.portal, emissive: palette.portal, emissiveIntensity: 1.4, roughness: 0.35,
      }),
    );
    portal.position.copy(exitPosition).setY(1.5);
    group.add(portal);

    const shimmer = new THREE.Mesh(
      new THREE.CircleGeometry(1, 32),
      new THREE.MeshBasicMaterial({
        color: palette.portalGlow, transparent: true, opacity: 0.22, side: THREE.DoubleSide,
      }),
    );
    shimmer.position.copy(portal.position);
    group.add(shimmer);

    const exitGlow = new THREE.PointLight(palette.portalGlow, 2.4, 14, 2);
    exitGlow.position.copy(exitPosition).setY(1.8);
    group.add(exitGlow);

    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 30, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: palette.portalGlow, transparent: true, opacity: 0.14,
        side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    beacon.position.copy(exitPosition).setY(15);
    group.add(beacon);

    /* lighting */
    group.add(new THREE.HemisphereLight(palette.hemiSky, palette.hemiGround, palette.hemiPower));

    const sun = new THREE.DirectionalLight(palette.sunColor, palette.sunPower);
    sun.position.set(maze.width * TILE * 0.3, 40, -maze.height * TILE * 0.2);
    sun.target.position.set((maze.width * TILE) / 2, 0, (maze.height * TILE) / 2);
    group.add(sun.target);

    if (quality.shadows) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(quality.shadowMap, quality.shadowMap);
      const span = Math.max(maze.width, maze.height) * TILE * 0.6;
      Object.assign(sun.shadow.camera, {
        left: -span, right: span, top: span, bottom: -span, near: 1, far: 160,
      });
      sun.shadow.bias = -0.0012;
      sun.shadow.camera.updateProjectionMatrix();
    }
    group.add(sun);

    scene.add(group);
    scene.fog = new THREE.FogExp2(palette.fog, palette.fogDensity);

    const sky = new THREE.CanvasTexture(this.skyTexture(palette));
    sky.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = sky;

    created.group = group;
    created.walls = walls;
    created.floor = floor;
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
};
