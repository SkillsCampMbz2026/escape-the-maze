/* Escape the Maze — first person, Three.js.

   The maze is a grid, so collision is a circle against the wall tiles around
   the player, resolved one axis at a time. That is cheap and, unlike pushing
   out along the shortest overlap, it never lets you slip through a corner. */

(() => {
  const THREE = window.THREE;

  const TILE = World.TILE;
  const EYE_HEIGHT = 1.62;
  const RADIUS = 0.42;
  const WALK = 4.6;
  const SPRINT = 7.4;
  const ACCEL = 14;
  const MAX_PITCH = Math.PI / 2 - 0.05;

  /* Monster speed sits between walking (4.6) and sprinting (7.4): you cannot
     stroll away from it, but you can outrun it if you know where you are
     going. `grace` is the head start before it begins hunting. */
  const SIZES = {
    small: { cols: 8, rows: 8, label: 'Small', hunter: 3.9, grace: 5, intercept: false },
    medium: { cols: 13, rows: 13, label: 'Medium', hunter: 4.5, grace: 4, intercept: true },
    large: { cols: 20, rows: 20, label: 'Large', hunter: 5.1, grace: 3.5, intercept: true },
  };

  /* ---------- Renderer ---------- */

  const canvas = document.getElementById('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;

  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const quality = {
    shadows: !coarse,
    shadowMap: 2048,
    anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()),
  };
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(76, 1, 0.1, 400);

  /* a torch on the camera, so corridors read as corridors */
  const torch = new THREE.PointLight(0xffd9a0, 1.5, 16, 2);
  camera.add(torch);
  scene.add(camera);

  /* ---------- State ---------- */

  const player = {
    x: 0, z: 0,
    vx: 0, vz: 0,
    yaw: 0, pitch: 0,
    bob: 0,
  };

  let maze = null;
  let world = null;
  let distances = null;
  let visited = null;
  let mode = 'menu';           // menu | playing | paused | won | caught
  let startTime = 0;
  let elapsed = 0;
  let sizeKey = 'medium';
  let best = loadBest();
  let deathTimer = 0;
  let stepTimer = 0;

  const clock = new THREE.Clock();

  /* ---------- Elements ---------- */

  const el = {
    overlay: document.getElementById('overlay'),
    panel: document.getElementById('panel'),
    title: document.getElementById('panel-title'),
    text: document.getElementById('panel-text'),
    play: document.getElementById('play'),
    sizes: document.getElementById('sizes'),
    hud: document.getElementById('hud'),
    timer: document.getElementById('timer'),
    distance: document.getElementById('distance'),
    bestOut: document.getElementById('best'),
    minimap: document.getElementById('minimap'),
    touch: document.getElementById('touch'),
    danger: document.getElementById('danger'),
    warning: document.getElementById('warning'),
  };
  const mapCtx = el.minimap.getContext('2d');

  /* ---------- Records ---------- */

  function loadBest() {
    try {
      return JSON.parse(localStorage.getItem('maze-best')) || {};
    } catch {
      return {};
    }
  }

  function saveBest() {
    try {
      localStorage.setItem('maze-best', JSON.stringify(best));
    } catch {
      /* storage blocked — keep the record for this session only */
    }
  }

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = (seconds % 60).toFixed(1).padStart(4, '0');
    return `${m}:${s}`;
  };

  /* ---------- Level ---------- */

  function newMaze() {
    if (world) world.dispose();
    Monster.remove(scene);

    const size = SIZES[sizeKey];
    maze = Maze.generate(size.cols, size.rows);
    distances = Maze.distanceField(maze);
    visited = new Uint8Array(maze.width * maze.height);
    world = World.build(THREE, scene, maze, quality);

    /* Put the monster as far from your start as the maze allows. */
    if (Monster.loaded) {
      const fromStart = Monster.fieldFrom(maze, maze.start.x, maze.start.y);
      Monster.spawn(THREE, scene, maze, {
        tile: TILE,
        speed: size.hunter,
        grace: size.grace,
        cell: Monster.pickSpawn(maze, fromStart),
        exitField: distances,      // it knows the maze as well as the maze does
        intercept: size.intercept,
        playerSpeed: (WALK + SPRINT) / 2,
      });
    }

    player.x = maze.start.x * TILE + TILE / 2;
    player.z = maze.start.y * TILE + TILE / 2;
    player.vx = 0;
    player.vz = 0;
    player.yaw = 0;
    player.pitch = 0;
    player.bob = 0;

    // face the first open direction so you never start staring at a wall
    if (!maze.solid(maze.start.x + 1, maze.start.y)) player.yaw = -Math.PI / 2;
    else if (!maze.solid(maze.start.x, maze.start.y + 1)) player.yaw = 0;

    el.minimap.width = maze.width * 4;
    el.minimap.height = maze.height * 4;
  }

  /* ---------- Movement ---------- */

  function blocked(x, z) {
    const gx = Math.floor(x / TILE);
    const gz = Math.floor(z / TILE);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!maze.solid(gx + dx, gz + dy)) continue;
        const left = (gx + dx) * TILE;
        const top = (gz + dy) * TILE;
        // nearest point on the tile to the player, then a radius test
        const nx = Math.max(left, Math.min(x, left + TILE));
        const nz = Math.max(top, Math.min(z, top + TILE));
        if ((x - nx) ** 2 + (z - nz) ** 2 < RADIUS * RADIUS) return true;
      }
    }
    return false;
  }

  function move(dt, input) {
    player.yaw -= input.look.x;
    player.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, player.pitch - input.look.y));

    const speed = input.sprint ? SPRINT : WALK;
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);

    // forward is -Z rotated by yaw; strafe is perpendicular to it
    const targetX = (-sin * input.y + cos * input.x) * speed;
    const targetZ = (-cos * input.y - sin * input.x) * speed;

    const blend = Math.min(1, dt * ACCEL);
    player.vx += (targetX - player.vx) * blend;
    player.vz += (targetZ - player.vz) * blend;

    // one axis at a time, so hitting a wall head-on still lets you slide along it
    const nextX = player.x + player.vx * dt;
    if (!blocked(nextX, player.z)) player.x = nextX;
    else player.vx = 0;

    const nextZ = player.z + player.vz * dt;
    if (!blocked(player.x, nextZ)) player.z = nextZ;
    else player.vz = 0;

    const pace = Math.hypot(player.vx, player.vz);
    player.bob += dt * pace * 1.9;

    camera.position.set(
      player.x,
      EYE_HEIGHT + Math.sin(player.bob) * 0.045 * Math.min(1, pace / WALK),
      player.z,
    );
    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');

    const gx = Math.floor(player.x / TILE);
    const gz = Math.floor(player.z / TILE);
    if (gx >= 0 && gz >= 0 && gx < maze.width && gz < maze.height) visited[gz * maze.width + gx] = 1;
  }

  /* ---------- Minimap ---------- */

  function drawMinimap() {
    const cell = 4;
    const w = el.minimap.width;
    const h = el.minimap.height;
    mapCtx.clearRect(0, 0, w, h);
    mapCtx.fillStyle = 'rgba(8, 12, 24, 0.72)';
    mapCtx.fillRect(0, 0, w, h);

    const px = Math.floor(player.x / TILE);
    const pz = Math.floor(player.z / TILE);

    for (let y = 0; y < maze.height; y++) {
      for (let x = 0; x < maze.width; x++) {
        // fog of war: only what you have been near is drawn
        const seen = visited[y * maze.width + x]
          || (Math.abs(x - px) <= 2 && Math.abs(y - pz) <= 2);
        if (!seen) continue;
        mapCtx.fillStyle = maze.grid[y * maze.width + x] ? '#5a6480' : '#141b2e';
        mapCtx.fillRect(x * cell, y * cell, cell, cell);
      }
    }

    // exit, always shown — this is a race, not a hide-and-seek
    mapCtx.fillStyle = '#4ade80';
    mapCtx.fillRect(maze.exit.x * cell - 1, maze.exit.y * cell - 1, cell + 2, cell + 2);

    /* The monster only appears on the map once it is close — knowing exactly
       where it always is would drain the tension out of the chase. */
    const hunter = Monster.state;
    if (hunter && hunter.distanceToPlayer < TILE * 7) {
      mapCtx.fillStyle = '#f87171';
      mapCtx.beginPath();
      mapCtx.arc((hunter.x / TILE) * cell, (hunter.z / TILE) * cell, 3, 0, Math.PI * 2);
      mapCtx.fill();
    }

    // player, pointing the way they face
    const cx = (player.x / TILE) * cell;
    const cy = (player.z / TILE) * cell;
    mapCtx.save();
    mapCtx.translate(cx, cy);
    mapCtx.rotate(-player.yaw);
    mapCtx.fillStyle = '#fbbf24';
    mapCtx.beginPath();
    mapCtx.moveTo(0, -4);
    mapCtx.lineTo(3, 4);
    mapCtx.lineTo(-3, 4);
    mapCtx.closePath();
    mapCtx.fill();
    mapCtx.restore();
  }

  /* ---------- Flow ---------- */

  function startRun() {
    Audio3D.init();
    Audio3D.resume();
    newMaze();
    mode = 'playing';
    startTime = performance.now();
    elapsed = 0;
    deathTimer = 0;
    el.overlay.classList.add('hidden');
    el.overlay.classList.remove('overlay--dead');
    el.hud.classList.remove('hidden');
    el.touch.classList.toggle('hidden', !coarse);
    el.danger.style.opacity = '0';
    if (!coarse) Controls.requestLock();
    clock.getDelta();
  }

  /* Caught: freeze the player, let the monster lunge into the camera for a
     beat, then show the panel. */
  function caught() {
    if (mode !== 'playing') return;
    mode = 'caught';
    deathTimer = 1.5;
    Audio3D.blip('roar');
    if (document.exitPointerLock) document.exitPointerLock();
    el.danger.style.opacity = '1';
    el.warning.classList.add('hidden');
  }

  function showCaughtPanel() {
    Audio3D.silence();
    el.title.textContent = '💀 Caught';
    el.text.innerHTML = `The monster found you after <b>${formatTime(elapsed)}</b>.`;
    el.play.textContent = 'Try again';
    el.overlay.classList.remove('hidden');
    el.overlay.classList.add('overlay--dead');
    el.hud.classList.add('hidden');
    el.touch.classList.add('hidden');
    el.danger.style.opacity = '0';
  }

  function win() {
    mode = 'won';
    Audio3D.silence();
    Audio3D.blip('win');
    const seconds = elapsed;
    const record = best[sizeKey];
    const isRecord = record === undefined || seconds < record;
    if (isRecord) {
      best[sizeKey] = seconds;
      saveBest();
    }
    if (document.exitPointerLock) document.exitPointerLock();

    el.title.textContent = '🎉 You escaped!';
    el.text.innerHTML = isRecord
      ? `<b>${formatTime(seconds)}</b> — a new record for the ${SIZES[sizeKey].label.toLowerCase()} maze.`
      : `<b>${formatTime(seconds)}</b> · best ${formatTime(record)}`;
    el.play.textContent = 'New maze';
    el.overlay.classList.remove('hidden');
    el.overlay.classList.remove('overlay--dead');
    el.hud.classList.add('hidden');
    el.touch.classList.add('hidden');
    el.danger.style.opacity = '0';
    el.warning.classList.add('hidden');
    renderBest();
  }

  function pause() {
    if (mode !== 'playing') return;
    mode = 'paused';
    Audio3D.silence();
    el.title.textContent = 'Paused';
    el.text.textContent = 'Something is hunting you. Find the green gate.';
    el.play.textContent = 'Resume';
    el.overlay.classList.remove('hidden');
  }

  function resume() {
    mode = 'playing';
    startTime = performance.now() - elapsed * 1000;
    el.overlay.classList.add('hidden');
    if (!coarse) Controls.requestLock();
    clock.getDelta();
  }

  function renderBest() {
    const record = best[sizeKey];
    el.bestOut.textContent = record === undefined ? '--:--' : formatTime(record);
  }

  /* ---------- Loop ---------- */

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, clock.getDelta());

    if (mode === 'playing') {
      move(dt, Controls.sample());
      elapsed = (performance.now() - startTime) / 1000;

      const time = performance.now() * 0.001;
      world.portal.rotation.z = time * 0.7;
      world.shimmer.scale.setScalar(1 + Math.sin(time * 2.4) * 0.06);
      world.exitGlow.intensity = 2.2 + Math.sin(time * 3) * 0.5;

      Monster.update(dt, player, caught);

      /* Proximity feedback: you hear and see it coming before you meet it. */
      const hunter = Monster.state;
      if (hunter) {
        const near = Audio3D.proximity(hunter.distanceToPlayer);
        el.danger.style.opacity = (near * 0.85).toFixed(3);
        el.warning.classList.toggle('hidden', !(hunter.grace <= 0 && hunter.distanceToPlayer < TILE * 3));

        stepTimer -= dt;
        if (stepTimer <= 0 && hunter.grace <= 0 && near > 0.12) {
          stepTimer = 0.42;
          Audio3D.blip('step');
        }
      }

      const gap = Math.hypot(player.x - world.exitPosition.x, player.z - world.exitPosition.z);
      if (gap < 1.6) win();

      el.timer.textContent = formatTime(elapsed);
      const tiles = distances[Math.floor(player.z / TILE) * maze.width + Math.floor(player.x / TILE)];
      el.distance.textContent = tiles >= 0 ? `${tiles} tiles` : '—';
      drawMinimap();
    } else if (mode === 'caught') {
      Monster.lunge(dt, camera);
      // look at what got you
      const s = Monster.state;
      if (s) {
        const want = Math.atan2(-(s.x - player.x), -(s.z - player.z));
        let delta = want - player.yaw;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        player.yaw += delta * Math.min(1, dt * 6);
        player.pitch += (0.1 - player.pitch) * Math.min(1, dt * 4);
        camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
      }
      deathTimer -= dt;
      if (deathTimer <= 0) {
        mode = 'dead';
        showCaughtPanel();
      }
    }

    renderer.render(scene, camera);
  }

  /* ---------- Wiring ---------- */

  Controls.init(canvas);
  Controls.onLockChange = (locked) => {
    if (!locked && mode === 'playing' && !coarse) pause();
  };

  /* The model has to be in before a run can start. */
  el.play.disabled = true;
  el.play.textContent = 'Waking the monster…';
  Monster.load(THREE, 'assets/blue_monster.glb').then(() => {
    el.play.disabled = false;
    el.play.textContent = 'Enter the maze';
  }).catch((error) => {
    console.error('monster failed to load', error);
    el.play.disabled = false;
    el.play.textContent = 'Enter the maze (no monster)';
  });

  el.play.addEventListener('click', () => {
    if (mode === 'paused') resume();
    else startRun();
  });

  el.sizes.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => {
      sizeKey = button.dataset.size;
      el.sizes.querySelectorAll('button').forEach((other) => {
        other.classList.toggle('on', other === button);
      });
      renderBest();
    });
  });

  window.addEventListener('keydown', (event) => {
    if (event.code === 'Escape' && mode === 'playing') pause();
  });

  window.addEventListener('resize', resize);
  resize();
  renderBest();
  frame();
})();
