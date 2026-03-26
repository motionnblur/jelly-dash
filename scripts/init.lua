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
    
    game.createPlatform(16, 8, 0, 4, 0.5, 4, 0xff7700)
    game.createPlatform(22, 10, 0, 4, 0.5, 4, 0xdd00ff)
end

-- 4. Spawn Player
if game and game.spawnPlayer then
    print("Spawning Player...")
    game.spawnPlayer(0, 5, 0)
end

-- 5. Define Game Loop Hooks
local dashCooldown = 0
local DASH_FORCE = 30
local DASH_COOLDOWN_TIME = 1.0 -- seconds

function onUpdate(delta)
    -- Handle Cooldown
    if dashCooldown > 0 then
        dashCooldown = dashCooldown - delta
    end
    
    -- Check for "Dash" ability (Shift Key)
    if game.isKeyDown("ShiftLeft") and dashCooldown <= 0 then
        print("DASHING!")
        
        -- Get current velocity to determine dash direction
        local vel = game.getVelocity()
        local direction = 0
        
        -- Determine direction based on movement keys
        if game.isKeyDown("KeyD") or game.isKeyDown("ArrowRight") then
            direction = 1
        elseif game.isKeyDown("KeyA") or game.isKeyDown("ArrowLeft") then
            direction = -1
        end
        
        -- Apply a horizontal impulse if a direction is held
        if direction ~= 0 then
            game.applyImpulse(direction * DASH_FORCE, 0, 0)
            dashCooldown = DASH_COOLDOWN_TIME
        end
    end
end

print("Game Script Loaded Successfully!")
