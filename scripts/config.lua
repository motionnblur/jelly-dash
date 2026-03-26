-- scripts/config.lua

local Config = {}

-- Engine Config Bridge
if config then
    config.playerSpeed = 8.0
    config.jumpImpulse = 12.0
    
    if game.setGravity then
        game.setGravity(-19.6)
    end
end

-- Script-level constants
Config.DASH_FORCE = 30
Config.DASH_COOLDOWN = 1.0

return Config
