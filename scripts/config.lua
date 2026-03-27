-- scripts/config.lua

local Config = {}

-- Engine Config Bridge
if config then
    config.playerSpeed = config.playerSpeed or 8.0
    config.jumpImpulse = config.jumpImpulse or 12.0
    config.gravity = config.gravity or -19.6

    Config.playerSpeed = config.playerSpeed
    Config.jumpImpulse = config.jumpImpulse
    Config.gravity = config.gravity
    Config.movement = config.movement or {}
    Config.gelEconomy = config.gelEconomy or {}
    Config.detection = config.detection or {}
    Config.boundaries = config.boundaries or {}
    Config.camera = config.camera or {}
    Config.rockets = config.rockets or {}

    if game.setGravity then
        game.setGravity(Config.gravity)
    end
end

-- Script-level constants
Config.DASH_FORCE = 30
Config.DASH_COOLDOWN = 1.0

return Config
