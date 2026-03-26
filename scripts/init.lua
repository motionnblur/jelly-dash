-- platformer-test/scripts/init.lua

print("Game Script Initializing...")

-- 1. Setup World configuration
if config then
    config.playerSpeed = 8.0
    config.jumpImpulse = 12.0
    
    -- We can also change gravity dynamically
    if game.setGravity then
        game.setGravity(-19.6)
    end
end

-- 2. Create the environment
if game and game.createGround then
    print("Creating Ground...")
    game.createGround()
end

-- 3. Create Platforms (Our new LUA-based Level Layout)
if game and game.createPlatform then
    print("Spawning platforms...")
    
    -- Generic Platform Creator: x, y, z, w, h, d, color
    game.createPlatform(5, 2, 0, 4, 0.5, 4, 0x00ff88)
    game.createPlatform(-6, 4, 0, 4, 0.5, 4, 0xff3366)
    game.createPlatform(10, 6, 0, 4, 0.5, 4, 0x3366ff)
    
    -- Create a few more steps for the level
    game.createPlatform(16, 8, 0, 4, 0.5, 4, 0xff7700)
    game.createPlatform(22, 10, 0, 4, 0.5, 4, 0xdd00ff)
end

-- 4. Spawn Player
if game and game.spawnPlayer then
    print("Spawning Player...")
    game.spawnPlayer(0, 5, 0)
end

-- 5. Define Game Loop Hooks
function onUpdate(delta)
    -- This runs every frame! (60fps)
    -- Use it for custom script logic, level animations, or AI.
    
    -- Example: We can print the delta time (caution: very spammy)
    -- print("Delta: " .. delta)
    
    -- Moving platforms, powerups, or custom timers would go here!
end

print("Game Script Loaded Successfully!")
