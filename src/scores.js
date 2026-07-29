/* Leaderboard, kept in localStorage.

   One table per maze size, ranked by escape time. Everything is stored under a
   single versioned key so the shape can change later without leaving stale
   records behind, and every write is wrapped: if storage is unavailable
   (private mode, or a file:// origin some browsers lock down) the board still
   works for the session, it just does not survive a reload. */

const Scores = {
  KEY: 'escape-maze-scores-v2',
  LIMIT: 10,
  data: null,

  /* Tables are keyed by "<world>-<size>", created on demand, so adding a
     world never needs a schema change. */
  blank() {
    return { version: 2, name: 'Player', runs: {}, deaths: {} };
  },

  load() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(this.KEY));
    } catch {
      saved = null;
    }

    this.data = this.blank();
    if (saved && saved.runs) {
      Object.keys(saved.runs).forEach((key) => {
        if (Array.isArray(saved.runs[key])) this.data.runs[key] = saved.runs[key];
      });
      Object.keys(saved.deaths || {}).forEach((key) => {
        if (typeof saved.deaths[key] === 'number') this.data.deaths[key] = saved.deaths[key];
      });
      if (typeof saved.name === 'string' && saved.name.trim()) this.data.name = saved.name;
    } else {
      this.migrate();
    }
    return this.data;
  },

  /* Two older shapes to carry forward, so nobody loses a record: the v1
     leaderboard keyed by bare size, and before that a single fastest time per
     size under 'maze-best'. Both belonged to what is now world 1. */
  migrate() {
    const sizes = ['small', 'medium', 'large'];

    let v1 = null;
    try {
      v1 = JSON.parse(localStorage.getItem('escape-maze-scores-v1'));
    } catch {
      v1 = null;
    }
    if (v1 && v1.runs) {
      sizes.forEach((size) => {
        if (Array.isArray(v1.runs[size]) && v1.runs[size].length) {
          this.data.runs[`w1-${size}`] = v1.runs[size].slice(0, this.LIMIT);
        }
        if (v1.deaths && typeof v1.deaths[size] === 'number') {
          this.data.deaths[`w1-${size}`] = v1.deaths[size];
        }
      });
      if (typeof v1.name === 'string' && v1.name.trim()) this.data.name = v1.name;
      this.save();
      return;
    }

    let legacy = null;
    try {
      legacy = JSON.parse(localStorage.getItem('maze-best'));
    } catch {
      return;
    }
    if (!legacy || typeof legacy !== 'object') return;

    sizes.forEach((size) => {
      const time = legacy[size];
      if (typeof time !== 'number') return;
      this.table(`w1-${size}`).push({ name: 'Player', time, kills: 0, at: Date.now(), legacy: true });
    });
    this.save();
  },

  table(key) {
    if (!Array.isArray(this.data.runs[key])) this.data.runs[key] = [];
    return this.data.runs[key];
  },

  save() {
    try {
      localStorage.setItem(this.KEY, JSON.stringify(this.data));
      return true;
    } catch {
      return false;   // in memory only for this session
    }
  },

  get name() {
    return this.data.name;
  },

  setName(value) {
    const clean = String(value || '').trim().slice(0, 14) || 'Player';
    this.data.name = clean;
    this.save();
    return clean;
  },

  /* Returns the 1-based rank, or null if the run did not make the table. */
  add(key, time, kills) {
    const table = this.table(key);
    const entry = { name: this.data.name, time, kills, at: Date.now() };

    table.push(entry);
    table.sort((a, b) => a.time - b.time);
    const index = table.indexOf(entry);
    this.data.runs[key] = table.slice(0, this.LIMIT);
    this.save();

    entry.rank = index + 1;
    return index < this.LIMIT ? entry : null;
  },

  /* Rename an already-recorded entry, for when you fix your name after a run. */
  rename(entry, value) {
    const clean = this.setName(value);
    if (entry) entry.name = clean;
    this.save();
    return clean;
  },

  recordDeath(key) {
    this.data.deaths[key] = (this.data.deaths[key] || 0) + 1;
    this.save();
  },

  top(key) {
    return this.data.runs[key] || [];
  },

  best(key) {
    const table = this.top(key);
    return table.length ? table[0].time : null;
  },

  deaths(key) {
    return this.data.deaths[key] || 0;
  },

  /* Has this world ever been escaped? Used to gate the harder one. */
  escapedWorld(worldId) {
    return Object.keys(this.data.runs)
      .some((key) => key.startsWith(`${worldId}-`) && this.data.runs[key].length > 0);
  },

  clear(key) {
    if (key) {
      this.data.runs[key] = [];
      this.data.deaths[key] = 0;
    } else {
      this.data = this.blank();
    }
    this.save();
  },
};
