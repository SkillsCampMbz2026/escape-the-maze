/* Input: pointer-lock mouse-look and WASD on desktop, a thumbstick and
   drag-to-look on touch. Everything lands in the same little state object,
   so the game loop never needs to know which one is being used. */

const Controls = {
  keys: Object.create(null),
  look: { x: 0, y: 0 },      // consumed each frame
  move: { x: 0, y: 0 },      // -1..1, from keys or the stick
  sprint: false,
  locked: false,
  sensitivity: 0.0022,
  onLockChange: null,

  init(canvas) {
    this.canvas = canvas;

    /* ---- keyboard ---- */
    window.addEventListener('keydown', (event) => {
      this.keys[event.code] = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) {
        event.preventDefault();
      }
    });
    window.addEventListener('keyup', (event) => { this.keys[event.code] = false; });
    window.addEventListener('blur', () => { this.keys = Object.create(null); });

    /* ---- pointer lock ---- */
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });

    document.addEventListener('mousemove', (event) => {
      if (!this.locked) return;
      this.look.x += event.movementX * this.sensitivity;
      this.look.y += event.movementY * this.sensitivity;
    });

    this.initTouch();
  },

  requestLock() {
    if (this.canvas.requestPointerLock) this.canvas.requestPointerLock();
  },

  /* ---- touch: left half drives the stick, right half looks ---- */
  initTouch() {
    const stick = document.getElementById('stick');
    const knob = document.getElementById('stick-knob');
    const RADIUS = 46;
    let stickId = null;
    let lookId = null;
    let lastLook = { x: 0, y: 0 };
    let origin = { x: 0, y: 0 };

    const setKnob = (dx, dy) => {
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };

    stick.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      stickId = event.pointerId;
      stick.setPointerCapture(event.pointerId);
      const box = stick.getBoundingClientRect();
      origin = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });

    stick.addEventListener('pointermove', (event) => {
      if (event.pointerId !== stickId) return;
      let dx = event.clientX - origin.x;
      let dy = event.clientY - origin.y;
      const distance = Math.hypot(dx, dy);
      if (distance > RADIUS) {
        dx = (dx / distance) * RADIUS;
        dy = (dy / distance) * RADIUS;
      }
      setKnob(dx, dy);
      this.move.x = dx / RADIUS;
      this.move.y = -dy / RADIUS;
    });

    const dropStick = (event) => {
      if (event.pointerId !== stickId) return;
      stickId = null;
      setKnob(0, 0);
      this.move.x = 0;
      this.move.y = 0;
    };
    stick.addEventListener('pointerup', dropStick);
    stick.addEventListener('pointercancel', dropStick);

    /* look anywhere that is not the stick */
    const surface = document.getElementById('look-area');
    surface.addEventListener('pointerdown', (event) => {
      if (lookId !== null) return;
      lookId = event.pointerId;
      surface.setPointerCapture(event.pointerId);
      lastLook = { x: event.clientX, y: event.clientY };
    });

    surface.addEventListener('pointermove', (event) => {
      if (event.pointerId !== lookId) return;
      this.look.x += (event.clientX - lastLook.x) * 0.005;
      this.look.y += (event.clientY - lastLook.y) * 0.005;
      lastLook = { x: event.clientX, y: event.clientY };
    });

    const dropLook = (event) => {
      if (event.pointerId !== lookId) return;
      lookId = null;
    };
    surface.addEventListener('pointerup', dropLook);
    surface.addEventListener('pointercancel', dropLook);
  },

  /* Merge keyboard into the movement vector and hand back this frame's look
     delta, resetting it so deltas are never applied twice. */
  sample() {
    const keys = this.keys;
    let x = this.move.x;
    let y = this.move.y;

    if (keys.KeyW || keys.ArrowUp) y += 1;
    if (keys.KeyS || keys.ArrowDown) y -= 1;
    if (keys.KeyA || keys.ArrowLeft) x -= 1;
    if (keys.KeyD || keys.ArrowRight) x += 1;

    const length = Math.hypot(x, y);
    if (length > 1) { x /= length; y /= length; }

    const look = { x: this.look.x, y: this.look.y };
    this.look.x = 0;
    this.look.y = 0;

    return {
      x,
      y,
      look,
      sprint: Boolean(keys.ShiftLeft || keys.ShiftRight),
    };
  },
};
