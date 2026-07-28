/* All sound is synthesised — the game ships no audio files.

   The growl is a low sawtooth pair through a resonant low-pass, mixed with
   filtered noise. Its gain and cutoff follow how close the monster is, so
   proximity is something you hear before you see it. */

const Audio3D = {
  ctx: null,
  ready: false,
  on: true,

  init() {
    if (this.ctx || !window.AudioContext) return;
    this.ctx = new AudioContext();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.ctx.destination);

    /* growl */
    this.growlGain = this.ctx.createGain();
    this.growlGain.gain.value = 0;
    this.growlFilter = this.ctx.createBiquadFilter();
    this.growlFilter.type = 'lowpass';
    this.growlFilter.frequency.value = 220;
    this.growlFilter.Q.value = 6;
    this.growlGain.connect(this.growlFilter);
    this.growlFilter.connect(this.master);

    this.growlOsc = [0, 1].map((i) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = i ? 41 : 27;
      osc.detune.value = i ? 12 : -9;
      osc.connect(this.growlGain);
      osc.start();
      return osc;
    });

    /* a slow wobble on the growl pitch, so it breathes */
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 4.5;
    const lfoDepth = this.ctx.createGain();
    lfoDepth.gain.value = 7;
    lfo.connect(lfoDepth);
    lfoDepth.connect(this.growlOsc[0].frequency);
    lfoDepth.connect(this.growlOsc[1].frequency);
    lfo.start();

    /* noise bed, reused for breath and impacts */
    const seconds = 2;
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate * seconds, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.breathGain = this.ctx.createGain();
    this.breathGain.gain.value = 0;
    const breathFilter = this.ctx.createBiquadFilter();
    breathFilter.type = 'bandpass';
    breathFilter.frequency.value = 620;
    breathFilter.Q.value = 0.9;
    const breath = this.ctx.createBufferSource();
    breath.buffer = this.noise;
    breath.loop = true;
    breath.connect(breathFilter);
    breathFilter.connect(this.breathGain);
    this.breathGain.connect(this.master);
    breath.start();

    this.ready = true;
  },

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },

  /* distance in world units; anything past `range` is silent */
  proximity(distance, range = 26) {
    if (!this.ready) return 0;
    const near = Math.max(0, 1 - distance / range);
    const level = this.on ? near * near : 0;
    const now = this.ctx.currentTime;
    this.growlGain.gain.setTargetAtTime(level * 0.5, now, 0.25);
    this.growlFilter.frequency.setTargetAtTime(140 + level * 520, now, 0.3);
    this.breathGain.gain.setTargetAtTime(level * 0.05, now, 0.3);
    return near;
  },

  silence() {
    if (!this.ready) return;
    this.growlGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
    this.breathGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
  },

  /* one-shot: 'step' | 'roar' | 'win' | 'shot' | 'dry' | 'reload' | 'hit'
     | 'headshot' | 'pain' | 'death' | 'hurt' */
  blip(type) {
    if (!this.ready || !this.on) return;
    const now = this.ctx.currentTime;
    const gain = this.ctx.createGain();
    gain.connect(this.master);

    /* --- gunfire: a hard noise crack over a short low thump --- */
    if (type === 'shot') {
      const crack = this.ctx.createBufferSource();
      crack.buffer = this.noise;
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 900;
      crack.connect(hp);
      hp.connect(gain);
      gain.gain.setValueAtTime(0.6, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      crack.start(now);
      crack.stop(now + 0.2);

      const thump = this.ctx.createOscillator();
      thump.type = 'sine';
      thump.frequency.setValueAtTime(180, now);
      thump.frequency.exponentialRampToValueAtTime(48, now + 0.14);
      const thumpGain = this.ctx.createGain();
      thumpGain.gain.setValueAtTime(0.5, now);
      thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      thump.connect(thumpGain);
      thumpGain.connect(this.master);
      thump.start(now);
      thump.stop(now + 0.2);
      return;
    }

    if (type === 'dry' || type === 'reload') {
      const click = this.ctx.createBufferSource();
      click.buffer = this.noise;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = type === 'dry' ? 2600 : 1500;
      bp.Q.value = 3;
      click.connect(bp);
      bp.connect(gain);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
      click.start(now);
      click.stop(now + 0.1);
      return;
    }

    /* --- impacts and cries --- */
    if (type === 'hit' || type === 'headshot') {
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(type === 'headshot' ? 1500 : 900, now);
      osc.frequency.exponentialRampToValueAtTime(type === 'headshot' ? 700 : 420, now + 0.07);
      osc.connect(gain);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.12);
      return;
    }

    if (type === 'pain' || type === 'death' || type === 'hurt') {
      const long = type !== 'pain';
      const cry = this.ctx.createOscillator();
      cry.type = 'sawtooth';
      const top = type === 'hurt' ? 320 : 220;
      cry.frequency.setValueAtTime(top, now);
      cry.frequency.exponentialRampToValueAtTime(type === 'death' ? 38 : 90, now + (long ? 0.8 : 0.28));
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = type === 'hurt' ? 1400 : 700;
      cry.connect(filter);
      filter.connect(gain);
      gain.gain.setValueAtTime(type === 'death' ? 0.5 : 0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + (long ? 0.95 : 0.32));
      cry.start(now);
      cry.stop(now + 1);
      return;
    }

    if (type === 'step' || type === 'roar') {
      const source = this.ctx.createBufferSource();
      source.buffer = this.noise;
      const filter = this.ctx.createBiquadFilter();
      filter.type = type === 'roar' ? 'bandpass' : 'lowpass';
      filter.frequency.value = type === 'roar' ? 400 : 180;
      filter.Q.value = type === 'roar' ? 0.7 : 1;
      source.connect(filter);
      filter.connect(gain);
      const peak = type === 'roar' ? 0.85 : 0.16;
      const tail = type === 'roar' ? 1.1 : 0.18;
      gain.gain.setValueAtTime(peak, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + tail);
      source.start(now);
      source.stop(now + tail + 0.05);

      if (type === 'roar') {
        const cry = this.ctx.createOscillator();
        cry.type = 'sawtooth';
        cry.frequency.setValueAtTime(180, now);
        cry.frequency.exponentialRampToValueAtTime(46, now + 0.9);
        const cryGain = this.ctx.createGain();
        cryGain.gain.setValueAtTime(0.35, now);
        cryGain.gain.exponentialRampToValueAtTime(0.001, now + 1);
        cry.connect(cryGain);
        cryGain.connect(this.master);
        cry.start(now);
        cry.stop(now + 1.1);
      }
      return;
    }

    // win chime
    [523, 659, 784].forEach((hz, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = hz;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, now + i * 0.11);
      g.gain.linearRampToValueAtTime(0.22, now + i * 0.11 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.11 + 0.5);
      osc.connect(g);
      g.connect(this.master);
      osc.start(now + i * 0.11);
      osc.stop(now + i * 0.11 + 0.6);
    });
  },
};
