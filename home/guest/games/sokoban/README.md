# Sokoban Levels Directory

Welcome to the Sokoban levels directory! 

You can play builtin levels by running:
```bash
sokoban
```

Or you can load any level file in this directory (or anywhere on your filesystem) by specifying the path:
```bash
sokoban level1.txt
# or: sokoban ~/games/sokoban/level1.txt
```

---

## How to Create or Edit Levels

You can use the built-in terminal editors `nano` or `vim` to create your own levels (e.g. `nano ~/games/sokoban/mylevel.txt` or `vim ~/mylevel.txt`).

Levels are defined using standard text grids. Use the following characters:

| Character | Represents | Description |
| :---: | :--- | :--- |
| `#` | Wall | Impassable barrier |
| `.` | Target | The destination where boxes must be pushed |
| `$` | Box | A crate that can be pushed by the player |
| `*` | Box on Target | A crate that has successfully been placed on a target |
| `@` | Player | Your starting position |
| `+` | Player on Target | Player starting on top of a target cell |
| ` ` | Empty Floor | Walkable space (use standard space bar spaces) |

### Example Level Design
```text
  #####
  #   #
  #$#$#
  #.@.#
  # . #
  #####
```

### Design Constraints
1. The level must contain exactly one player starting point (`@` or `+`).
2. There must be at least as many targets (`.` or `*` or `+`) as there are boxes (`$` or `*`).
3. Ensure the play area is fully enclosed by walls (`#`) so the player or boxes cannot escape the board grid.
