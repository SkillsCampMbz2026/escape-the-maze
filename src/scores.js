/* Leaderboard, kept in localStorage.

   One table per maze size, ranked by escape time. Everything is stored under a
   single versioned key so the shape can change later without leaving stale
   records behind, and every write is wrapped: if storage is unavailable
   (private mode, or a file:// origin some browsers lock down) the board still
   works for the session, it just does not survive a reload. */

const Scores = {
  KEY: 'escape-maze-scores-v1',
  LIMIT: 10,
  data: null,

  blank() {
    return {
      version: 1,
      name: 'Player',
      runs: { small: [], medium: [], large: [] },
      deaths: { small: 0, medium: 0, large: 0 },
    };
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
      ['small', 'medium', 'large'].forEach((size) => {
        if (Array.isArray(saved.runs[size])) this.data.runs[size] = saved.runs[size];
        if (saved.deaths && typeof saved.deaths[size] === 'number') {
          this.data.deaths[size] = saved.deaths[size];
        }
      });
      if (typeof saved.name === 'string' && saved.name.trim()) this.data.name = saved.name;
    } else {
      this.migrate();
    }
    return this.data;
  },

  /* Earlier builds kept a single fastest time per size under 'maze-best'.
     Carry those over so nobody loses a record they already set. */
  migrate() {
    let legacy = null;
    try {
      legacy = JSON.parse(localStorage.getItem('maze-best'));
    } catch {
      return;
    }
    if (!legacy || typeof legacy !== 'object') return;

    ['small', 'medium', 'large'].forEach((size) => {
      const time = legacy[size];
      if (typeof time !== 'number') return;
      this.data.runs[size].push({ name: 'Player', time, kills: 0, at: Date.now(), legacy: true });
    });
    this.save();
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
  add(size, time, kills) {
    const table = this.data.runs[size];
    const entry = { name: this.data.name, time, kills, at: Date.now() };

    table.push(entry);
    table.sort((a, b) => a.time - b.time);
    const index = table.indexOf(entry);
    this.data.runs[size] = table.slice(0, this.LIMIT);
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

  recordDeath(size) {
    this.data.deaths[size] = (this.data.deaths[size] || 0) + 1;
    this.save();
  },

  top(size) {
    return this.data.runs[size] || [];
  },

  best(size) {
    const table = this.top(size);
    return table.length ? table[0].time : null;
  },

  deaths(size) {
    return this.data.deaths[size] || 0;
  },

  clear(size) {
    if (size) {
      this.data.runs[size] = [];
      this.data.deaths[size] = 0;
    } else {
      this.data = this.blank();
    }
    this.save();
  },
};
