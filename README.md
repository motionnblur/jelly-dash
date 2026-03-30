# 3D Side Scroller Game Template (Three.js + Rapier)

<img width="558" height="173" alt="Screen Shot 2026-03-30 at 23 29 12" src="https://github.com/user-attachments/assets/3eca1c0c-138e-4afb-a831-12cff919497f" />

itch.io link: https://motionnblur.itch.io/jelly-dash

Note: The game is mainly vibe coded using claude code and codex.


A premium-styled 3D side-scroller template built with **Three.js** for rendering and **Rapier** for physics.

## ✨ Features
- **3D Physics**: Powered by Rapier WASM for efficient collisions and character controller.
- **Side-Scrolling Camera**: Dynamic smooth camera following on the X and Y axes.
- **Locked Axis**: Horizontal platformer movement (Z-axis is locked).
- **Premium Aesthetics**: Directional shadows, point lights, and modern typography.
- **Vite Setup**: Fast development and building workflow.
- **Lua**: For scripting language

## 🚀 Getting Started

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Run Development Server**:
   ```bash
   npm run dev
   ```

3. **Build for Production**:
   ```bash
   npm run build
   ```

## 🎮 Controls
- **A / D / Arrow Left / Arrow Right**: Move Left/Right
- **Space**: Jump

## 📂 Project Structure
- `index.html`: Base template and UI overlay.
- `main.js`: Game logic, physics initialization, and Three.js scene.
- `package.json`: Dependency and script management.

## 🛠 Next Steps (Iterations)
- Replace basic boxes with GLTF models for the player and environment.
- Implement more complex level loading (maybe via JSON or a scene editor).
- Add sound effects using Three.js `AudioListener`.
- Expand character controller with double jumps, dash, or combat.

Happy Coding! 🎮
