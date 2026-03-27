-- scripts/init.lua

local Config = require("config")
local World = require("world")
local Player = require("player")

print("Game Scripts Initializing (SOLID Refactor)...")

-- 1. Initialize Objects
World.init()
Player.init()

-- 2. Define global Update Hook (called from JS Engine)
function onUpdate(delta)
    Player.update(delta)
end

function onPlayerLevelReset(x, y, z)
    Player.onPlayerLevelReset(x, y, z)
end

function onCheatCommand(command)
    Player.onCheatCommand(command)
end

print("All Modules Loaded Successfully!")
