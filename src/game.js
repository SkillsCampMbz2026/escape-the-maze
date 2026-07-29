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

  /* Monster speeds sit between walking (4.6) and sprinting (7.4): you cannot
     stroll away from them, but you can outrun them if you know where you are
     going. Per-world values live in worlds.js. */
  const SIZES = {
    small: { cols: 8, rows: 8, label: 'Small' },
    medium: { cols: 13, rows: 13, label: 'Medium' },
    large: { cols: 20, rows: 20, label: 'Large' },
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
    health: 100,
    hurtCooldown: 0,
    kick: 0,          // camera punch when mauled
  };

  const MAUL_COOLDOWN = 1.1;   // damage per hit comes from the monster variant

  let maze = null;
  let world = null;
  let distances = null;
  let visited = null;
  let mode = 'menu';           // menu | playing | paused | won | caught
  let startTime = 0;
  let elapsed = 0;
  let sizeKey = 'medium';
  let worldKey = 'w1';
  let deathTimer = 0;
  let stepTimer = 0;
  let lastEntry = null;      // the run just recorded, so it can be highlighted/renamed
  let killer = null;         // which monster got you
  let firing = false;

  const boardKey = () => `${worldKey}-${sizeKey}`;
  const worldDef = () => Worlds[worldKey];

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
    health: document.getElementById('health-fill'),
    healthText: document.getElementById('health-text'),
    ammo: document.getElementById('ammo'),
    kills: document.getElementById('kills'),
    hitmarker: document.getElementById('hitmarker'),
    hurt: document.getElementById('hurt'),
    monsterBar: document.getElementById('monster-bar'),
    monsterFill: document.getElementById('monster-fill'),
    monsterName: document.getElementById('monster-name'),
    alive: document.getElementById('alive'),
    gunName: document.getElementById('gun-name'),
    gunSlots: document.getElementById('gun-slots'),
    worlds: document.getElementById('worlds'),
    playerName: document.getElementById('player-name'),
    fireBtn: document.getElementById('fire-btn'),
    reloadBtn: document.getElementById('reload-btn'),
    swapBtn: document.getElementById('swap-btn'),
    boardSize: document.getElementById('board-size'),
    boardList: document.getElementById('board-list'),
    boardEmpty: document.getElementById('board-empty'),
    boardTally: document.getElementById('board-tally'),
    boardName: document.getElementById('board-name'),
    boardClear: document.getElementById('board-clear'),
  };
  const mapCtx = el.minimap.getContext('2d');

  /* ---------- Records ---------- */

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = (seconds % 60).toFixed(1).padStart(4, '0');
    return `${m}:${s}`;
  };

  /* ---------- Level ---------- */

  function newMaze() {
    if (world) world.dispose();
    Monsters.clear(scene);

    const size = SIZES[sizeKey];
    const def = worldDef();
    const scale = def.sizeScale;
    maze = Maze.generate(Math.round(size.cols * scale), Math.round(size.rows * scale));
    distances = Maze.distanceField(maze);
    visited = new Uint8Array(maze.width * maze.height);
    world = World.build(THREE, scene, maze, quality, def);

    torch.color.set(def.palette.torchColor);
    torch.intensity = def.palette.torchPower;
    torch.distance = def.palette.torchRange;

    /* The pack spawns as far from your start as the maze allows, spread out. */
    if (Monsters.loaded) {
      Monsters.spawnPack(THREE, scene, maze, {
        tile: TILE,
        speed: def.hunter[sizeKey],
        grace: def.grace[sizeKey],
        pack: def.pack,
        exitField: distances,      // they know the maze as well as the maze does
        intercept: def.intercept[sizeKey],
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
    player.health = 100;
    player.hurtCooldown = 0;
    player.kick = 0;
    Guns.reset();
    el.kills.textContent = '0';

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
    camera.rotation.set(player.pitch + player.kick, player.yaw, 0, 'YXZ');

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
    Monsters.pack.forEach((m) => {
      if (m.dead || m.distanceToPlayer > TILE * 7) return;
      mapCtx.fillStyle = m.variant === 'mini' ? '#fb923c' : '#f87171';
      mapCtx.beginPath();
      mapCtx.arc((m.x / TILE) * cell, (m.z / TILE) * cell, m.variant === 'mini' ? 2 : 3, 0, Math.PI * 2);
      mapCtx.fill();
    });

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
    firing = false;
    killer = null;
    renderGun();
    if (!coarse) Controls.requestLock();
    clock.getDelta();
  }

  /* ---------- Combat ---------- */

  function flashHitmarker(headshot) {
    el.hitmarker.classList.toggle('hitmarker--head', headshot);
    el.hitmarker.classList.remove('hidden');
    clearTimeout(flashHitmarker.timer);
    flashHitmarker.timer = setTimeout(() => el.hitmarker.classList.add('hidden'), 130);
  }

  function shoot() {
    if (mode !== 'playing') return;

    const shot = Guns.fire(THREE, camera, world.walls, Monsters.bodies());
    if (shot.dry) { Audio3D.blip('dry'); return; }
    if (!shot.spent) return;                 // cooldown or reloading

    Audio3D.blip('shot');
    player.kick = Math.min(player.kick + (Guns.spec.id === 'shotgun' ? 0.07 : 0.03), 0.1);

    if (!shot.hits.length) return;

    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);

    /* A shotgun blast can land several pellets on the same target, so total
       them up per monster and apply one hit — otherwise the flinch and the
       sound would fire eight times. */
    const tally = new Map();
    let anyHead = false;
    shot.hits.forEach((hit) => {
      tally.set(hit.body, (tally.get(hit.body) || 0) + hit.damage);
      if (hit.headshot) anyHead = true;
    });

    let killed = 0;
    tally.forEach((damage, body) => {
      const monster = Monsters.find(body);
      if (!monster) return;
      const result = Monsters.damage(monster, damage, { x: direction.x, z: direction.z }, elapsed);
      if (result === 'killed') killed += 1;
    });

    flashHitmarker(anyHead);
    Audio3D.blip(anyHead ? 'headshot' : 'hit');
    if (killed) {
      Audio3D.blip('death');
      el.kills.textContent = Monsters.kills;
    } else {
      Audio3D.blip('pain');
    }
  }

  /* They maul rather than instantly kill, so a fight is winnable. */
  function contact(monster) {
    if (mode !== 'playing' || player.hurtCooldown > 0) return;
    player.hurtCooldown = MAUL_COOLDOWN;
    player.health -= monster.kind.damage;
    player.kick = 0.16;
    killer = monster;
    Audio3D.blip('hurt');

    el.hurt.classList.remove('hidden');
    setTimeout(() => el.hurt.classList.add('hidden'), 220);

    // shoved back, so you get a chance to shoot your way out
    const dx = player.x - monster.x;
    const dz = player.z - monster.z;
    const gap = Math.hypot(dx, dz) || 1;
    const nextX = player.x + (dx / gap) * 0.9;
    const nextZ = player.z + (dz / gap) * 0.9;
    if (!blocked(nextX, player.z)) player.x = nextX;
    if (!blocked(player.x, nextZ)) player.z = nextZ;

    if (player.health <= 0) {
      player.health = 0;
      caught();
    }
  }

  function switchGun(index) {
    if (mode !== 'playing') return;
    if (Guns.select(index)) {
      Audio3D.blip('reload');
      renderGun();
    }
  }

  function renderGun() {
    el.gunName.textContent = Guns.spec.name;
    el.gunSlots.querySelectorAll('span').forEach((slot, i) => {
      slot.classList.toggle('on', i === Guns.current);
    });
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
    lastEntry = null;
    Scores.recordDeath(boardKey());
    const kills = Monsters.kills;
    el.title.textContent = '💀 Caught';
    el.text.innerHTML = kills
      ? `Killed it ${kills} time${kills > 1 ? 's' : ''}, then it got you after <b>${formatTime(elapsed)}</b>.`
      : `The monster found you after <b>${formatTime(elapsed)}</b>.`;
    el.play.textContent = 'Try again';
    renderBoard();
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
    const kills = Monsters.kills;
    const previousBest = Scores.best(boardKey());
    lastEntry = Scores.add(boardKey(), seconds, kills);
    if (document.exitPointerLock) document.exitPointerLock();

    const isRecord = previousBest === null || seconds < previousBest;
    const killNote = kills ? ` · ${kills} kill${kills > 1 ? 's' : ''}` : '';

    el.title.textContent = '🎉 You escaped!';
    if (isRecord) {
      el.text.innerHTML = `<b>${formatTime(seconds)}</b>${killNote} — fastest yet on the ${SIZES[sizeKey].label.toLowerCase()} maze.`;
    } else if (lastEntry) {
      el.text.innerHTML = `<b>${formatTime(seconds)}</b>${killNote} — #${lastEntry.rank} on the board.`;
    } else {
      el.text.innerHTML = `<b>${formatTime(seconds)}</b>${killNote} · best ${formatTime(previousBest)}`;
    }
    el.play.textContent = 'New maze';
    el.overlay.classList.remove('hidden');
    el.overlay.classList.remove('overlay--dead');
    el.hud.classList.add('hidden');
    el.touch.classList.add('hidden');
    el.danger.style.opacity = '0';
    el.warning.classList.add('hidden');
    renderBest();
    renderBoard();
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
    const record = Scores.best(boardKey());
    el.bestOut.textContent = record === null ? '--:--' : formatTime(record);
  }

  /* ---------- Leaderboard ---------- */

  function renderBoard() {
    const table = Scores.top(boardKey());
    el.boardSize.textContent = `${worldDef().name} · ${SIZES[sizeKey].label}`;
    el.boardList.textContent = '';
    el.boardEmpty.classList.toggle('hidden', table.length > 0);

    const escapes = table.length;
    const deaths = Scores.deaths(boardKey());
    el.boardTally.textContent = escapes || deaths
      ? `${escapes} escape${escapes === 1 ? '' : 's'} · ${deaths} death${deaths === 1 ? '' : 's'}`
      : '';

    table.forEach((entry, index) => {
      const row = document.createElement('li');
      row.className = 'row';
      if (entry === lastEntry) row.classList.add('row--new');
      row.innerHTML = `
        <span class="row__rank">${index + 1}</span>
        <span class="row__who"></span>
        <span class="row__time">${formatTime(entry.time)}</span>
        <span class="row__kills">${entry.kills ? `${entry.kills}☠` : '—'}</span>`;
      // set the name as text, never as markup
      row.querySelector('.row__who').textContent = entry.name || 'Player';
      el.boardList.appendChild(row);
    });

    el.boardName.value = Scores.name;
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

      const nearest = Monsters.updateAll(dt, player, contact, elapsed);
      const pace = Math.min(1, Math.hypot(player.vx, player.vz) / WALK);
      Guns.update(dt, pace);
      if (firing && Guns.spec.auto) shoot();

      player.hurtCooldown = Math.max(0, player.hurtCooldown - dt);
      player.kick *= Math.exp(-dt * 9);

      /* Proximity feedback comes from whichever one is closest. */
      const near = Audio3D.proximity(nearest ? nearest.distanceToPlayer : 999);
      el.danger.style.opacity = (near * 0.85).toFixed(3);
      el.warning.classList.toggle('hidden',
        !(nearest && nearest.grace <= 0 && nearest.distanceToPlayer < TILE * 3));

      stepTimer -= dt;
      if (stepTimer <= 0 && nearest && nearest.grace <= 0 && near > 0.12) {
        stepTimer = 0.42;
        Audio3D.blip('step');
      }

      /* Health bar for the one you are looking at, or just hit. */
      const focus = Monsters.pack
        .filter((m) => !m.dead && (m.sees && m.distanceToPlayer < 24 || elapsed - m.hurtAt < 2.5))
        .sort((a, b) => a.distanceToPlayer - b.distanceToPlayer)[0];
      el.monsterBar.classList.toggle('hidden', !focus);
      if (focus) {
        el.monsterName.textContent = focus.kind.label;
        el.monsterFill.style.width = `${(focus.health / focus.maxHealth) * 100}%`;
      }

      el.alive.textContent = Monsters.alive();
      el.health.style.width = `${player.health}%`;
      el.healthText.textContent = player.health;
      el.health.classList.toggle('health--low', player.health <= 34);
      el.ammo.textContent = Guns.reloading > 0 ? 'RELOADING' : `${Guns.rounds} / ${Guns.magSize}`;

      const gap = Math.hypot(player.x - world.exitPosition.x, player.z - world.exitPosition.z);
      if (gap < 1.6) win();

      el.timer.textContent = formatTime(elapsed);
      const tiles = distances[Math.floor(player.z / TILE) * maze.width + Math.floor(player.x / TILE)];
      el.distance.textContent = tiles >= 0 ? `${tiles} tiles` : '—';
      drawMinimap();
    } else if (mode === 'caught') {
      Monsters.lunge(killer, dt, camera);
      // look at what got you
      const s = killer;
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
  Guns.build(THREE, camera);
  Controls.onLockChange = (locked) => {
    if (!locked && mode === 'playing' && !coarse) pause();
  };

  /* The model has to be in before a run can start. */
  el.play.disabled = true;
  el.play.textContent = 'Waking the monster…';
  Monsters.load(THREE, 'assets/blue_monster.glb').then(() => {
    el.play.disabled = false;
    el.play.textContent = 'Enter the maze';
  }).catch((error) => {
    console.error('monster failed to load', error);
    el.play.disabled = false;
    el.play.textContent = 'Enter the maze (no monsters)';
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
      renderBoard();
    });
  });

  el.worlds.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => {
      worldKey = button.dataset.world;
      el.worlds.querySelectorAll('button').forEach((other) => {
        other.classList.toggle('on', other === button);
      });
      renderBest();
      renderBoard();
    });
  });

  /* Name is shared with the leaderboard, and either field can set it. */
  function syncName(value) {
    Scores.rename(lastEntry, value);
    el.playerName.value = Scores.name;
    el.boardName.value = Scores.name;
    renderBoard();
  }

  el.playerName.addEventListener('change', () => syncName(el.playerName.value));
  el.playerName.addEventListener('keydown', (event) => {
    if (event.code === 'Enter') el.playerName.blur();
    event.stopPropagation();
  });

  /* Editing the name renames the run you just posted, so a late correction
     still lands on the right row. */
  el.boardName.addEventListener('change', () => syncName(el.boardName.value));
  el.boardName.addEventListener('keydown', (event) => {
    if (event.code === 'Enter') el.boardName.blur();
    event.stopPropagation();          // do not let R or Escape reach the game
  });

  el.boardClear.addEventListener('click', () => {
    if (el.boardClear.dataset.armed) {
      Scores.clear(boardKey());
      lastEntry = null;
      delete el.boardClear.dataset.armed;
      el.boardClear.textContent = 'Clear';
      renderBest();
      renderBoard();
      return;
    }
    el.boardClear.dataset.armed = '1';
    el.boardClear.textContent = 'Sure?';
    setTimeout(() => {
      delete el.boardClear.dataset.armed;
      el.boardClear.textContent = 'Clear';
    }, 2600);
  });

  window.addEventListener('keydown', (event) => {
    if (event.code === 'Escape' && mode === 'playing') pause();
    if (event.code === 'KeyR' && mode === 'playing') {
      if (Guns.reload()) Audio3D.blip('reload');
    }
    if (mode === 'playing') {
      const slot = ['Digit1', 'Digit2', 'Digit3'].indexOf(event.code);
      if (slot >= 0) switchGun(slot);
    }
  });

  /* Fire: mouse while the pointer is locked, or the on-screen button.
     Holding only keeps firing on a weapon that is actually automatic. */
  canvas.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    if (mode !== 'playing' || !Controls.locked) return;
    firing = true;
    shoot();
  });
  window.addEventListener('mouseup', () => { firing = false; });

  const startFiring = (event) => {
    event.preventDefault();
    firing = true;
    shoot();
  };
  const stopFiring = () => { firing = false; };

  el.fireBtn.addEventListener('pointerdown', startFiring);
  el.fireBtn.addEventListener('pointerup', stopFiring);
  el.fireBtn.addEventListener('pointercancel', stopFiring);
  el.fireBtn.addEventListener('pointerleave', stopFiring);

  el.reloadBtn.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    if (Guns.reload()) Audio3D.blip('reload');
  });

  el.swapBtn.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    switchGun((Guns.current + 1) % Guns.LIST.length);
  });

  window.addEventListener('resize', resize);
  resize();
  Scores.load();
  el.playerName.value = Scores.name;
  renderBest();
  renderBoard();
  renderGun();
  frame();
})();
