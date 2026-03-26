-- scripts/player.lua

local Player = {}
local Config = require("config")

local dashCooldown = 0

function Player.init()
    if game.spawnPlayer then
        print("Spawning Player in space...")
        game.spawnPlayer(0, 2.15, 0)
    end
end

function Player.update(delta)
    -- Handle Cooldown
    if dashCooldown > 0 then
        dashCooldown = dashCooldown - delta
    end
    
    -- Dash Ability (L-Shift)
    if game.isKeyDown("ShiftLeft") and dashCooldown <= 0 then
        local direction = 0
        if game.isKeyDown("KeyD") or game.isKeyDown("ArrowRight") then direction = 1 end
        if game.isKeyDown("KeyA") or game.isKeyDown("ArrowLeft") then direction = -1 end
        
        if direction ~= 0 then
            print("Player: Dash Impulse Applied")
            game.applyImpulse(direction * Config.DASH_FORCE, 0, 0)
            dashCooldown = Config.DASH_COOLDOWN
        end
    end
end

return Player
