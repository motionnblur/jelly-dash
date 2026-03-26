import { LuaFactory } from "wasmoon";

export class LuaRuntime {
  constructor() {
    this.factory = new LuaFactory();
    this.lua = null;
    this.isReady = false;
  }

  async init(globals = {}) {
    this.lua = await this.factory.createEngine();
    
    // Set global JS objects that should be accessible in Lua
    for (const [name, obj] of Object.entries(globals)) {
      this.lua.global.set(name, obj);
    }

    this.isReady = true;
    console.log("Lua Runtime initialized");
  }

  mountFile(path, content) {
    if (this.lua) {
      this.lua.mountFile(path, content);
    }
  }

  async run(script) {
    if (!this.isReady) {
      console.warn("Lua Runtime not ready yet");
      return;
    }
    try {
      return await this.lua.doString(script);
    } catch (e) {
      console.error("Lua Error:", e);
    }
  }

  callFunction(name, ...args) {
    if (!this.isReady || !this.lua) return;
    const fn = this.lua.global.get(name);
    if (typeof fn === "function") {
      try {
        return fn(...args);
      } catch (e) {
        console.error(`Error calling Lua function '${name}':`, e);
      }
    }
  }

  setGlobal(name, value) {
    if (this.lua) {
      this.lua.global.set(name, value);
    }
  }
}

export const luaRuntime = new LuaRuntime();
