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

  /* one-shot: 'step' | 'roar' | 'win' */
  blip(type) {
    if (!this.ready || !this.on) return;
    const now = this.ctx.currentTime;
    const gain = this.ctx.createGain();
    gain.connect(this.master);

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
