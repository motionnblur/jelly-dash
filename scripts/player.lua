-- scripts/player.lua

local Player = {}
local Config = require("config")

local movement = Config.movement or {}
local gelEconomy = Config.gelEconomy or {}
local detection = Config.detection or {}
local boundaries = Config.boundaries or {}
local rockets = Config.rockets or {}

local PLAYER_SPEED = movement.speed or Config.playerSpeed or 8.0
local JUMP_IMPULSE = movement.jumpImpulse or Config.jumpImpulse or 12.0
local GROUND_COYOTE_TIME = detection.groundCoyoteTime or 0.14
local JUMP_GEL_COST = gelEconomy.jumpCost or 0.045
local WALK_GEL_COST = gelEconomy.walkCost or 0.018
local WALK_STEP_DISTANCE = gelEconomy.walkStepDistance or 2.0
local ROCKET_GEL_COST = gelEconomy.rocketGelCost or 0.005
local ROCKET_THRUST = rockets.thrust or 0.42
local ROCKET_DRAIN_RATE = rockets.drainRate or 0.45
local ROCKET_REFILL_RATE = rockets.refillRate or 0.22
local SPACESHIP_ALTITUDE_THRESHOLD =
    boundaries.spaceshipAltitudeThreshold or 24.0

local state = {}

local function clamp(value, minValue, maxValue)
    if value < minValue then
        return minValue
    end

    if value > maxValue then
        return maxValue
    end

    return value
end

local function copyVector(vector)
    return {
        x = vector.x or 0,
        y = vector.y or 0,
        z = vector.z or 0,
    }
end

local function resetState()
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
    state.rocketLevel = 1.0
    state.isRocketActive = false
    state.rocketSpin = 0
    state.rocketSpinBaseDirection = 1
    state.isGodMode = false
    state.isRocketBoy = false
    state.jumpWasHeld = false
    state.pendingVelocity = { x = 0, y = 0, z = 0 }
end

local function resetPresentation()
    if game.player and game.player.resetPresentation then
        game.player.resetPresentation()
    end
end

local function syncState()
    if not (game.player and game.player.apply) then
        return
    end

    game.player.apply({
        gelMass = state.gelMass,
        rocketLevel = state.rocketLevel,
        isRocketActive = state.isRocketActive,
        rocketSpin = state.rocketSpin,
        rocketSpinBaseDirection = state.rocketSpinBaseDirection,
        isGodMode = state.isGodMode,
        isRocketBoy = state.isRocketBoy,
        isGameOver = state.isGameOver,
        lastGrounded = state.lastGrounded,
        lastVelY = state.lastVelY,
        airborneTime = state.airborneTime,
        lastLandingAirTime = state.lastLandingAirTime,
        lastLandingImpactSpeed = state.lastLandingImpactSpeed,
        velocity = copyVector(state.pendingVelocity),
        jelly = {
            velocity = copyVector(state.jellyVelocity),
            impact = state.jellyImpact,
            time = state.jellyTime,
            scale = copyVector(state.jellyScale),
            tilt = state.jellyTilt,
        },
    })
end

local function readRuntime()
    if game.player and game.player.read then
        return game.player.read()
    end

    return nil
end

local function drainGel(amount)
    if amount <= 0 or state.isGodMode then
        return state.gelMass
    end

    if game.player and game.player.drainGel then
        state.gelMass = game.player.drainGel(amount)
    else
        state.gelMass = math.max(0, state.gelMass - amount)
    end

    if state.gelMass <= 0 then
        state.isGameOver = true
        state.isRocketActive = false
    end

    return state.gelMass
end

local function spawnParticles(x, y, z, color, count, speedScale, options)
    if game.player and game.player.spawnParticles then
        game.player.spawnParticles(x, y, z, color, count or 8, speedScale or 1.0, options or {})
    end
end

local function triggerLandingCameraEffect(airborneTime, impactSpeed)
    if game.player and game.player.triggerLandingCameraEffect then
        game.player.triggerLandingCameraEffect(airborneTime, impactSpeed)
    end
end

local function endRun(cause, delayMs)
    state.isGameOver = true
    state.isRocketActive = false
    if game.triggerGameOver then
        game.triggerGameOver(cause, delayMs or 0)
    end
end

local function computeJellyScale(velocity, isGrounded)
    local scaleY = 1.0
    local scaleXZ = 1.0

    if not isGrounded then
        local stretch = math.abs(velocity.y or 0) * 0.025
        scaleY = 1.0 + stretch
        scaleXZ = 1.0 - stretch * 0.5
    else
        local speedFactor = math.abs(velocity.x or 0) * 0.02
        scaleXZ = 1.0 + speedFactor
        scaleY = 1.0 - speedFactor * 0.2
    end

    scaleY = scaleY * state.gelMass
    scaleXZ = scaleXZ * state.gelMass

    return {
        x = scaleXZ,
        y = scaleY,
        z = scaleXZ,
    }
end

local function pushFrame(velocity, isGrounded)
    state.pendingVelocity = copyVector(velocity)
    state.jellyVelocity = copyVector(velocity)
    state.jellyScale = computeJellyScale(velocity, isGrounded and true or false)
    state.jellyTilt = (velocity.x or 0) * -0.05
    state.jellyImpact = state.lastLandingImpactSpeed
    syncState()
end

function Player.init()
    resetState()
    resetPresentation()
    if game.player and game.player.spawn then
        game.player.spawn(0, 2.15, 0)
    end
    syncState()
end

function Player.onPlayerLevelReset(x, y, z)
    resetState()
    resetPresentation()
    if game.player and game.player.spawn then
        game.player.spawn(x or 0, y or 2.15, z or 0)
    end
    syncState()
end

function Player.onCheatCommand(command)
    local normalized = string.lower(tostring(command or ""))

    if normalized == "godmode" then
        state.isGodMode = not state.isGodMode
        if game.logConsole then
            game.logConsole(
                "God Mode: " .. (state.isGodMode and "ENABLED" or "DISABLED")
            )
        end
    elseif normalized == "rocketboy" then
        state.isRocketBoy = not state.isRocketBoy
        if state.isRocketBoy then
            state.rocketLevel = 1.0
        end
        if game.logConsole then
            game.logConsole(
                "Unlimited Fuel: " .. (state.isRocketBoy and "ENABLED" or "DISABLED")
            )
        end
    else
        if game.logConsole then
            game.logConsole("Unknown command: " .. normalized)
        end
    end

    syncState()
end

function Player.update(delta)
    local runtime = readRuntime()
    if not runtime then
        return
    end

    if runtime.isGameOver or runtime.isTransitioning or runtime.isGameComplete then
        state.isRocketActive = false
        pushFrame(runtime.velocity or { x = 0, y = 0, z = 0 }, runtime.isGrounded)
        return
    end

    local velocity = runtime.velocity or { x = 0, y = 0, z = 0 }
    local translation = runtime.translation or { x = 0, y = 0, z = 0 }
    local isGrounded = runtime.isGrounded and true or false
    local hitFinal = runtime.hitFinal and true or false
    local wasGrounded = state.lastGrounded
    local shiftPressed = (game.isKeyDown and game.isKeyDown("ShiftLeft"))
        or (game.isKeyDown and game.isKeyDown("ShiftRight"))
    local jumpHeld = game.isKeyDown and game.isKeyDown("Space")
    local moveLeft = (game.isKeyDown and game.isKeyDown("KeyA"))
        or (game.isKeyDown and game.isKeyDown("ArrowLeft"))
    local moveRight = (game.isKeyDown and game.isKeyDown("KeyD"))
        or (game.isKeyDown and game.isKeyDown("ArrowRight"))

    state.jellyTime = state.jellyTime + delta
    state.groundedCoyoteTimer = isGrounded and GROUND_COYOTE_TIME
        or math.max(0, state.groundedCoyoteTimer - delta)

    if isGrounded and not wasGrounded then
        local impactSpeed = math.abs(state.lastVelY or 0)
        state.lastLandingAirTime = state.airborneTime
        state.lastLandingImpactSpeed = impactSpeed
        triggerLandingCameraEffect(state.airborneTime, impactSpeed)

        if state.spawnLandingGrace then
            state.spawnLandingGrace = false
        else
            local particleCount = math.min(6 + math.floor(impactSpeed), 18)
            local speedScale = 0.3 + impactSpeed / 12
            spawnParticles(
                translation.x,
                translation.y - 0.5,
                translation.z,
                0x44ff44,
                particleCount,
                speedScale
            )
        end
    end

    if isGrounded then
        state.airborneTime = 0
    else
        state.airborneTime = state.airborneTime + delta
    end

    local moveX = 0
    if moveLeft then
        moveX = moveX - PLAYER_SPEED
    end
    if moveRight then
        moveX = moveX + PLAYER_SPEED
    end

    local nextVelocity = {
        x = moveX,
        y = velocity.y or 0,
        z = 0,
    }

    local canJump = isGrounded or state.groundedCoyoteTimer > 0
    if jumpHeld and not state.jumpWasHeld and canJump and not shiftPressed then
        nextVelocity.y = JUMP_IMPULSE
        state.groundedCoyoteTimer = 0
        spawnParticles(
            translation.x,
            translation.y - 0.4,
            translation.z,
            0x44ff44,
            8,
            1.0
        )
        drainGel(JUMP_GEL_COST)
        if state.isGameOver then
            pushFrame(nextVelocity, isGrounded)
            return
        end
    end
    state.jumpWasHeld = jumpHeld and true or false

    if not jumpHeld and nextVelocity.y > 0 then
        nextVelocity.y = nextVelocity.y * 0.9
    end

    local horizontalMove = (moveRight and 1 or 0) - (moveLeft and 1 or 0)
    local rocketActive = false
    if shiftPressed and state.rocketLevel > 0 then
        if not state.isRocketActive then
            state.rocketSpinBaseDirection = (game.random and game.random() < 0.5)
                and 1
                or -1
        end

        rocketActive = true
        if not state.isRocketBoy then
            state.rocketLevel = math.max(
                0,
                state.rocketLevel - ROCKET_DRAIN_RATE * delta
            )
            drainGel(ROCKET_GEL_COST * delta)
        else
            state.rocketLevel = 1.0
        end

        nextVelocity.y = nextVelocity.y + ROCKET_THRUST

        if game.random and game.random() < 0.3 then
            spawnParticles(
                translation.x + ((game.random and game.random() or 0.5) - 0.5) * 1.2,
                translation.y - 0.5,
                translation.z,
                0xff4433,
                4,
                0.5,
                { sizeScale = 2.0 }
            )
        end
    elseif not shiftPressed then
        state.rocketLevel = math.min(
            1.0,
            state.rocketLevel + ROCKET_REFILL_RATE * delta
        )
    end

    state.isRocketActive = rocketActive

    if state.isRocketActive then
        local spinSpeed = 10.0 + math.abs(horizontalMove) * 12.0
        local spinDirection = horizontalMove ~= 0 and -horizontalMove
            or state.rocketSpinBaseDirection
        state.rocketSpin = state.rocketSpin + delta * spinSpeed * spinDirection
    else
        state.rocketSpin = state.rocketSpin * math.max(0, 1 - delta * 6.0)
    end

    state.lastGrounded = isGrounded
    state.lastVelY = velocity.y or 0
    state.gelMass = clamp(state.gelMass, 0, 1)
    state.jellyImpact = state.lastLandingImpactSpeed
    pushFrame(nextVelocity, isGrounded)

    if state.gelMass <= 0 then
        endRun("depleted")
        return
    end

    if isGrounded and math.abs(nextVelocity.x or 0) >= 0.25 then
        state.walkDistanceAccumulator =
            state.walkDistanceAccumulator + math.abs(nextVelocity.x) * delta
        if state.walkDistanceAccumulator >= WALK_STEP_DISTANCE then
            state.walkDistanceAccumulator =
                state.walkDistanceAccumulator - WALK_STEP_DISTANCE
            spawnParticles(
                translation.x + ((game.random and game.random() or 0.5) - 0.5) * 0.35,
                translation.y - 0.48,
                translation.z,
                0x44ff44,
                4,
                0.75
            )
            drainGel(WALK_GEL_COST)
            if state.isGameOver then
                return
            end
        end
    end

    if hitFinal then
        if game.startLevelTransition then
            game.startLevelTransition()
        end
        return
    end

    if translation.y < -10 then
        endRun("fall")
        return
    end

    if translation.y > SPACESHIP_ALTITUDE_THRESHOLD then
        if game.triggerSpaceshipStrike then
            game.triggerSpaceshipStrike(translation.x, translation.y, translation.z)
        else
            endRun("spaceship", 2000)
        end
    end
end

return Player
