-- scripts/world.lua

local World = {}

function World.init()
    print("Building World...")
    
    if game.createGround then
        game.createGround()
    end
    
    if game.createPlatform then
        -- Generic Platform Creator: x, y, z, w, h, d, color
        game.createPlatform(5, 2, 0, 4, 0.5, 4, 0x00ff88)
        game.createPlatform(-6, 4, 0, 4, 0.5, 4, 0xff3366)
        game.createPlatform(10, 6, 0, 4, 0.5, 4, 0x3366ff)
        game.createPlatform(16, 8, 0, 4, 0.5, 4, 0xff7700)
        game.createPlatform(22, 10, 0, 4, 0.5, 4, 0xdd00ff)
    end
end

return World
