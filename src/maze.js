/* Maze generation.

   Recursive backtracker (randomised depth-first search): from a random cell,
   repeatedly carve into an unvisited neighbour; when boxed in, retrace until
   a cell with an unvisited neighbour is found. It produces a "perfect" maze —
   exactly one path between any two cells, no loops, no unreachable spots. */

const Maze = {
  /* cols/rows are in cells. The returned grid is (cols*2+1) x (rows*2+1),
     where each cell becomes a floor tile surrounded by wall tiles. */
  generate(cols, rows) {
    const visited = new Uint8Array(cols * rows);
    // wall bitmask per cell: 1 = north, 2 = east, 4 = south, 8 = west
    const walls = new Uint8Array(cols * rows).fill(0b1111);
    const at = (x, y) => y * cols + x;

    const stack = [{ x: 0, y: 0 }];
    visited[0] = 1;

    while (stack.length) {
      const current = stack[stack.length - 1];
      const options = [];

      if (current.y > 0 && !visited[at(current.x, current.y - 1)]) options.push([0, -1, 1, 4]);
      if (current.x < cols - 1 && !visited[at(current.x + 1, current.y)]) options.push([1, 0, 2, 8]);
      if (current.y < rows - 1 && !visited[at(current.x, current.y + 1)]) options.push([0, 1, 4, 1]);
      if (current.x > 0 && !visited[at(current.x - 1, current.y)]) options.push([-1, 0, 8, 2]);

      if (!options.length) {
        stack.pop();
        continue;
      }

      const [dx, dy, wallHere, wallThere] = options[Math.floor(Math.random() * options.length)];
      const nx = current.x + dx;
      const ny = current.y + dy;

      walls[at(current.x, current.y)] &= ~wallHere;
      walls[at(nx, ny)] &= ~wallThere;
      visited[at(nx, ny)] = 1;
      stack.push({ x: nx, y: ny });
    }

    return this.toGrid(walls, cols, rows);
  },

  /* Expand the per-cell wall bitmasks into a solid/open tile grid. */
  toGrid(walls, cols, rows) {
    const width = cols * 2 + 1;
    const height = rows * 2 + 1;
    const grid = new Uint8Array(width * height).fill(1);   // 1 = solid
    const at = (x, y) => y * width + x;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const gx = x * 2 + 1;
        const gy = y * 2 + 1;
        const cell = walls[y * cols + x];
        grid[at(gx, gy)] = 0;
        if (!(cell & 1)) grid[at(gx, gy - 1)] = 0;
        if (!(cell & 2)) grid[at(gx + 1, gy)] = 0;
        if (!(cell & 4)) grid[at(gx, gy + 1)] = 0;
        if (!(cell & 8)) grid[at(gx - 1, gy)] = 0;
      }
    }

    return {
      grid,
      width,
      height,
      cols,
      rows,
      solid: (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 1 : grid[y * width + x]),
      // opposite corners, always reachable from each other
      start: { x: 1, y: 1 },
      exit: { x: width - 2, y: height - 2 },
    };
  },

  /* Breadth-first distance from the exit, used for the "getting warmer"
     hint and to prove the exit really is reachable. */
  distanceField(maze) {
    const field = new Int32Array(maze.width * maze.height).fill(-1);
    const start = maze.exit.y * maze.width + maze.exit.x;
    field[start] = 0;

    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
      const index = queue[head];
      const x = index % maze.width;
      const y = (index / maze.width) | 0;
      const step = field[index] + 1;

      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= maze.width || ny >= maze.height) return;
        const next = ny * maze.width + nx;
        if (maze.grid[next] || field[next] !== -1) return;
        field[next] = step;
        queue.push(next);
      });
    }

    return field;
  },
};
