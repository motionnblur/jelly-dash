-- platformer-test/scripts/init.lua

print("Lua Script Loading...")

-- This script will configure player settings
-- We'll assume the 'config' global is provided from JS

if config then
    print("Configuring player via Lua...")
    config.playerSpeed = 10.0
    config.jumpImpulse = 14.0
    
    -- Print out the current settings
    print("Player Speed set to: " .. config.playerSpeed)
end

-- We can also try creating a platform from Lua if 'game' is provided
if game and game.createPlatform then
    print("Creating a secret LUA platform!")
    game.createPlatform(-15, 8, 0, 4, 0.5, 4, 0x00ffff)
end
