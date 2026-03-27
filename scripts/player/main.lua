-- scripts/player/main.lua

local Config = require("config")
local Movement = require("player/movement")
local Skills = require("player/skills")
local Cheat = require("player/cheat")

local Player = {}
local state = {}

local function resetPresentation()
    if game.player and game.player.resetPresentation then
        game.player.resetPresentation()
    end
end

local function applyState()
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
        velocity = {
            x = state.pendingVelocity.x or 0,
            y = state.pendingVelocity.y or 0,
            z = state.pendingVelocity.z or 0,
        },
        jelly = {
            velocity = {
                x = state.jellyVelocity.x or 0,
                y = state.jellyVelocity.y or 0,
                z = state.jellyVelocity.z or 0,
            },
            impact = state.jellyImpact,
            time = state.jellyTime,
            scale = {
                x = state.jellyScale.x or 1,
                y = state.jellyScale.y or 1,
                z = state.jellyScale.z or 1,
            },
            tilt = state.jellyTilt,
        },
    })
end

local function resetState()
    Movement.resetState(state)
    Skills.resetState(state)
    Cheat.resetState(state)
    state.jellyTime = 0
    state._lastColliderMass = nil
end

Movement.configure(Config)
Skills.configure(Config)

function Player.init()
    resetState()
    resetPresentation()
    if game.player and game.player.spawn then
        game.player.spawn(0, 2.15, 0)
    end
    applyState()
end

function Player.onPlayerLevelReset(x, y, z)
    resetState()
    resetPresentation()
    if game.player and game.player.spawn then
        game.player.spawn(x or 0, y or 2.15, z or 0)
    end
    applyState()
end

function Player.onCheatCommand(command)
    Cheat.handle(command, state)
    applyState()
end

function Player.update(delta)
    local runtime = game.player and game.player.read and game.player.read()
    if not runtime then
        return
    end

    local terminal = Movement.update(state, runtime, delta)
    if not terminal then
        Skills.update(state, runtime, delta)
    end

    applyState()
end

return Player
