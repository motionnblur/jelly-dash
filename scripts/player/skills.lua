-- scripts/player/skills.lua

local Skills = {}

local config = {
    thrust = 0.42,
    drainRate = 0.45,
    refillRate = 0.22,
    rocketGelCost = 0.005,
    maxRiseSpeed = 10.0,
}

local function spawnParticles(translation)
    if game.player and game.player.spawnParticles then
        game.player.spawnParticles(
            translation.x + ((math.random() - 0.5) * 1.2),
            translation.y - 0.5,
            translation.z,
            0xff4433,
            4,
            0.5,
            { sizeScale = 2.0 }
        )
    end
end

function Skills.configure(playerConfig)
    local rockets = playerConfig.rockets or {}
    local gelEconomy = playerConfig.gelEconomy or {}

    config.thrust = rockets.thrust or 0.42
    config.drainRate = rockets.drainRate or 0.45
    config.refillRate = rockets.refillRate or 0.22
    config.rocketGelCost = gelEconomy.rocketGelCost or 0.005
    config.maxRiseSpeed = rockets.maxRiseSpeed or 10.0
end

function Skills.resetState(state)
    state.rocketLevel = 1.0
    state.isRocketActive = false
    state.rocketSpin = 0
    state.rocketSpinBaseDirection = 1
end

function Skills.update(state, runtime, delta)
    -- Consume pending rocket fuel from pickups (now bundled in snapshot)
    local fuel = runtime.pendingRocketFuel or 0
    if fuel > 0 then
        state.rocketLevel = math.min(1.0, state.rocketLevel + fuel)
    end

    if runtime.isGameOver or runtime.isTransitioning or runtime.isGameComplete then
        state.isRocketActive = false
        return
    end

    local rkeys = runtime.keys or {}
    local shiftPressed = rkeys.boost
    local translation = runtime.translation or { x = 0, y = 0, z = 0 }
    local nextVelocity = state.pendingVelocity or { x = 0, y = 0, z = 0 }
    local hasFuel = state.rocketLevel > 0

    if shiftPressed and hasFuel then
        if not state.isRocketActive then
            state.rocketSpinBaseDirection = math.random() < 0.5 and 1 or -1
        end

        state.isRocketActive = true

        if not state.isRocketBoy then
            state.rocketLevel = math.max(0, state.rocketLevel - config.drainRate * delta)
            if game.player and game.player.drainGel then
                local gelMass = game.player.drainGel(config.rocketGelCost * delta)
                if type(gelMass) == "number" then
                    state.gelMass = gelMass
                end
            end
        else
            state.rocketLevel = 1.0
        end

        nextVelocity.y = math.min(
            config.maxRiseSpeed,
            (nextVelocity.y or 0) + config.thrust
        )

        if math.random() < 0.3 then
            spawnParticles(translation)
        end
    else
        state.isRocketActive = false

        if not shiftPressed then
            state.rocketLevel = math.min(
                1.0,
                state.rocketLevel + config.refillRate * delta
            )
        end
    end

    if state.isRocketActive then
        local horizontalMove =
            (rkeys.right and 1 or 0)
            - (rkeys.left and 1 or 0)
        local spinSpeed = 10.0 + math.abs(horizontalMove) * 12.0
        local spinDirection = horizontalMove ~= 0 and -horizontalMove
            or state.rocketSpinBaseDirection

        state.rocketSpin = state.rocketSpin + delta * spinSpeed * spinDirection
    else
        state.rocketSpin = state.rocketSpin * math.max(0, 1 - delta * 6.0)
    end

    state.pendingVelocity = nextVelocity
end

return Skills
