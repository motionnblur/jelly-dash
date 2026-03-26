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

    -- Spawn Random Coins on the ground
    if game.createCoin then
        print("Spawning Coins...")
        for i = 1, 10 do
            local rx = (math.random() * 40) - 10 -- Random X between -10 and 30
            game.createCoin(rx, 0.5, 0)          -- Place on the Z=0 plane for collection
        end
    end
end

return World
