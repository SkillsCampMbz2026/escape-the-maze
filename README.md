# 🌑 Escape the Maze

A first-person 3D maze game. You are dropped into a procedurally generated maze at night with a torch — find the glowing green gate before the clock runs up.

**Built with [Three.js](https://threejs.org) r149** (MIT), vendored into `vendor/` so the game runs offline and straight off the filesystem — no CDN, no build step, no npm install.

## Play

| Input | Action |
|---|---|
| `W` `A` `S` `D` / arrows | Move |
| Mouse | Look (click to capture the pointer) |
| `Shift` | Run |
| `Esc` | Pause |

On a phone: left thumbstick to move, drag anywhere else to look.

Three maze sizes — Small (8×8), Medium (13×13), Large (20×20). Your best time is saved per size.

## How it works

**Maze generation** — a recursive backtracker (randomised depth-first search). From a random cell it carves into an unvisited neighbour, and when boxed in it retraces until it finds one with an unvisited neighbour. That produces a *perfect* maze: exactly one path between any two cells, no loops, nothing walled off. A breadth-first distance field from the exit drives the "tiles to exit" readout and proves solvability.

**Rendering** — every wall block is one instance of a single `InstancedMesh`, so a 20×20 maze (~800 blocks) is one draw call rather than 800. All textures are painted into canvases at runtime, so the repo carries no image files.

**Collision** — the maze is a grid, so the player is a circle tested against the nine wall tiles around them, resolved one axis at a time. Sliding along a wall works, and unlike shortest-overlap pushout you can't squeeze through a corner.

## Running locally

Open `index.html` — it works from the filesystem. Or serve it:

```sh
npx serve .
```

## Files

```
index.html          HUD, overlay, canvas
style.css
vendor/three.min.js Three.js r149 (MIT)
src/maze.js         generation + solvability check
src/world.js        scene, procedural textures, lighting
src/controls.js     pointer lock, keyboard, touch stick
src/game.js         loop, collision, minimap, timing
```
