-- scripts/player/movement.lua

local Movement = {}

local config = {
    playerSpeed = 8.0,
    jumpImpulse = 12.0,
    groundCoyoteTime = 0.14,
    jumpGelCost = 0.045,
    walkGelCost = 0.018,
    walkStepDistance = 2.0,
    spaceshipAltitudeThreshold = 24.0,
}

local function clamp(value, minValue, maxValue)
    if value < minValue then
        return minValue
    end

    if value > maxValue then
        return maxValue
    end

    return value
end

-- Writes jelly scale directly into state.jellyScale to avoid table allocation
local function computeJellyScale(state, velocity, isGrounded)
    local scaleY, scaleXZ

    if not isGrounded then
        local stretch = math.abs(velocity.y or 0) * 0.025
        scaleY  = (1.0 + stretch) * state.gelMass
        scaleXZ = (1.0 - stretch * 0.5) * state.gelMass
    else
        local speedFactor = math.abs(velocity.x or 0) * 0.02
        scaleXZ = (1.0 + speedFactor) * state.gelMass
        scaleY  = (1.0 - speedFactor * 0.2) * state.gelMass
    end

    state.jellyScale.x = scaleXZ
    state.jellyScale.y = scaleY
    state.jellyScale.z = scaleXZ
end

local function spawnParticles(translation, color, count, speedScale, options)
    if game.player and game.player.spawnParticles then
        local gelMass = game.player.spawnParticles(
            translation.x,
            translation.y,
            translation.z,
            color,
            count or 8,
            speedScale or 1.0,
            options or {}
        )
        if type(gelMass) == "number" then
            return gelMass
        end
    end
end

local function triggerLandingCameraEffect(state)
    if game.player and game.player.triggerLandingCameraEffect then
        game.player.triggerLandingCameraEffect(
            state.airborneTime,
            state.lastLandingImpactSpeed
        )
    end
end

function Movement.configure(playerConfig)
    local movement = playerConfig.movement or {}
    local gelEconomy = playerConfig.gelEconomy or {}
    local detection = playerConfig.detection or {}
    local boundaries = playerConfig.boundaries or {}

    config.playerSpeed = movement.speed or playerConfig.playerSpeed or 8.0
    config.jumpImpulse = movement.jumpImpulse or playerConfig.jumpImpulse or 12.0
    config.groundCoyoteTime = detection.groundCoyoteTime or 0.14
    config.jumpGelCost = gelEconomy.jumpCost or 0.045
    config.walkGelCost = gelEconomy.walkCost or 0.018
    config.walkStepDistance = gelEconomy.walkStepDistance or 2.0
    config.spaceshipAltitudeThreshold =
        boundaries.spaceshipAltitudeThreshold or 24.0
end

function Movement.resetState(state)
    state.gelMass = 1.0
    state.isGameOver = false
    state.lastGrounded = true
    state.lastVelY = 0
    state.airborneTime = 0
    state.lastLandingAirTime = 0
    state.lastLandingImpactSpeed = 0
    state.walkDistanceAccumulator = 0
    state.groundedCoyoteTimer = 0
    state.spawnLandingGrace = true
    state.jellyTime = 0
    state.jellyTilt = 0
    state.jellyImpact = 0
    state.jellyVelocity = { x = 0, y = 0, z = 0 }
    state.jellyScale = { x = 1, y = 1, z = 1 }
    state.jumpWasHeld = false
    state.pendingVelocity = { x = 0, y = 0, z = 0 }
    state.doubleJumpUsed = false
end

function Movement.update(state, runtime, delta)
    -- Consume pending health restore from pickups (now bundled in snapshot)
    local restore = runtime.pendingHealthRestore or 0
    if restore > 0 then
        state.gelMass = math.min(1.0, state.gelMass + restore)
    end

    local velocity = runtime.velocity or { x = 0, y = 0, z = 0 }
    local translation = runtime.translation or { x = 0, y = 0, z = 0 }
    local isGrounded = runtime.isGrounded and true or false
    local rkeys = runtime.keys or {}

    state.jellyTime = state.jellyTime + delta

    -- Mutate existing tables in place instead of allocating new ones
    state.pendingVelocity.x = velocity.x or 0
    state.pendingVelocity.y = velocity.y or 0
    state.pendingVelocity.z = velocity.z or 0
    state.jellyVelocity.x = velocity.x or 0
    state.jellyVelocity.y = velocity.y or 0
    state.jellyVelocity.z = velocity.z or 0

    computeJellyScale(state, velocity, isGrounded)
    state.jellyTilt = (velocity.x or 0) * -0.05
    state.jellyImpact = state.lastLandingImpactSpeed

    if runtime.isGameOver or runtime.isTransitioning or runtime.isGameComplete then
        state.isGameOver = runtime.isGameOver and true or state.isGameOver
        state.isRocketActive = false
        if runtime.isTransitioning then
            state.pendingVelocity.x = 0
            state.pendingVelocity.z = 0
        end
        return true
    end

    local wasGrounded = state.lastGrounded
    state.groundedCoyoteTimer = isGrounded
        and config.groundCoyoteTime
        or math.max(0, state.groundedCoyoteTimer - delta)

    if isGrounded and not wasGrounded then
        state.lastLandingAirTime = state.airborneTime
        local platformVelY = runtime.groundPlatformVelY or 0
        state.lastLandingImpactSpeed = math.abs((state.lastVelY or 0) - platformVelY)
        triggerLandingCameraEffect(state)

        if state.spawnLandingGrace then
            state.spawnLandingGrace = false
        else
            local impactSpeed = state.lastLandingImpactSpeed
            local landingDrain = math.max(0, (impactSpeed - 1.8) * 0.012)
            local gelMass = spawnParticles(
                {
                    x = translation.x,
                    y = translation.y - 0.5,
                    z = translation.z,
                },
                0x44ff44,
                math.min(6 + math.floor(impactSpeed), 18),
                0.3 + impactSpeed / 12,
                {
                    drainGelTotal = landingDrain,
                    playImpactSound = landingDrain > 0,
                }
            )
            if type(gelMass) == "number" then
                state.gelMass = gelMass
            end
        end
    end

    if isGrounded then
        state.airborneTime = 0
    else
        state.airborneTime = state.airborneTime + delta
    end

    local moveX = 0
    if rkeys.left then
        moveX = moveX - config.playerSpeed
    end
    if rkeys.right then
        moveX = moveX + config.playerSpeed
    end

    local jumpHeld = rkeys.jump
    local shiftPressed = rkeys.boost
    local canJump = isGrounded or state.groundedCoyoteTimer > 0

    if isGrounded then
        state.doubleJumpUsed = false
    end

    local canDoubleJump = not canJump and not state.doubleJumpUsed

    if jumpHeld and not state.jumpWasHeld and (canJump or canDoubleJump) and not shiftPressed then
        state.pendingVelocity.y = config.jumpImpulse
        state.groundedCoyoteTimer = 0
        if canDoubleJump then
            state.doubleJumpUsed = true
        end
        if game.player and game.player.playJumpSound then
            game.player.playJumpSound()
        end
        local gelMass = spawnParticles(
            {
                x = translation.x,
                y = translation.y - 0.4,
                z = translation.z,
            },
            0x44ff44,
            8,
            1.0,
            { drainGelTotal = config.jumpGelCost }
        )
        if type(gelMass) == "number" then
            state.gelMass = gelMass
        end
    elseif (not jumpHeld or shiftPressed) and state.pendingVelocity.y > 0 then
        state.pendingVelocity.y = state.pendingVelocity.y * 0.9
    end

    state.jumpWasHeld = jumpHeld and true or false
    state.pendingVelocity.x = moveX
    state.pendingVelocity.z = 0

    state.lastGrounded = isGrounded
    state.lastVelY = velocity.y or 0

    if isGrounded and math.abs(state.pendingVelocity.x or 0) >= 0.25 then
        state.walkDistanceAccumulator =
            state.walkDistanceAccumulator + math.abs(state.pendingVelocity.x) * delta
        if state.walkDistanceAccumulator >= config.walkStepDistance then
            state.walkDistanceAccumulator =
                state.walkDistanceAccumulator - config.walkStepDistance
            local gelMass = spawnParticles(
                {
                    x = translation.x + ((math.random() - 0.5) * 0.35),
                    y = translation.y - 0.48,
                    z = translation.z,
                },
                0x44ff44,
                4,
                0.75,
                { drainGelTotal = config.walkGelCost }
            )
            if type(gelMass) == "number" then
                state.gelMass = gelMass
            end
        end
    end

    if runtime.hitFinal then
        state.isRocketActive = false
        if game.startLevelTransition then
            game.startLevelTransition()
        end
        return true
    end

    if translation.y < -10 then
        state.isGameOver = true
        state.isRocketActive = false
        if game.triggerGameOver then
            game.triggerGameOver("fall")
        end
        return true
    end

    if translation.y > config.spaceshipAltitudeThreshold then
        state.isGameOver = true
        state.isRocketActive = false
        if game.triggerSpaceshipStrike then
            game.triggerSpaceshipStrike(translation.x, translation.y, translation.z)
        else
            if game.triggerGameOver then
                game.triggerGameOver("spaceship", 2000)
            end
        end
        return true
    end

    state.jellyImpact = state.lastLandingImpactSpeed
    state.gelMass = clamp(state.gelMass, 0, 1)
    return false
end

return Movement
