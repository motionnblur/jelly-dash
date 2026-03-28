-- scripts/player/main.lua

local Config = require("shared/config")
local Movement = require("player/movement")
local Skills = require("player/skills")
local Cheat = require("player/cheat")

local Player = {}
local state = {}

-- Pre-allocated buffer reused every frame to avoid per-frame table allocation
local _applyBuf = {
    gelMass = 0,
    rocketLevel = 0,
    isRocketActive = false,
    rocketSpin = 0,
    rocketSpinBaseDirection = 1,
    isGodMode = false,
    isRocketBoy = false,
    isGameOver = false,
    lastGrounded = false,
    lastVelY = 0,
    airborneTime = 0,
    lastLandingAirTime = 0,
    lastLandingImpactSpeed = 0,
    velocity = { x = 0, y = 0, z = 0 },
    jelly = {
        velocity = { x = 0, y = 0, z = 0 },
        impact = 0,
        time = 0,
        scale = { x = 1, y = 1, z = 1 },
        tilt = 0,
    },
}

local function resetPresentation()
    if game.player and game.player.resetPresentation then
        game.player.resetPresentation()
    end
end

local function applyState()
    if not (game.player and game.player.apply) then
        return
    end

    _applyBuf.gelMass = state.gelMass
    _applyBuf.rocketLevel = state.rocketLevel
    _applyBuf.isRocketActive = state.isRocketActive
    _applyBuf.rocketSpin = state.rocketSpin
    _applyBuf.rocketSpinBaseDirection = state.rocketSpinBaseDirection
    _applyBuf.isGodMode = state.isGodMode
    _applyBuf.isRocketBoy = state.isRocketBoy
    _applyBuf.isGameOver = state.isGameOver
    _applyBuf.lastGrounded = state.lastGrounded
    _applyBuf.lastVelY = state.lastVelY
    _applyBuf.airborneTime = state.airborneTime
    _applyBuf.lastLandingAirTime = state.lastLandingAirTime
    _applyBuf.lastLandingImpactSpeed = state.lastLandingImpactSpeed
    _applyBuf.velocity.x = state.pendingVelocity.x or 0
    _applyBuf.velocity.y = state.pendingVelocity.y or 0
    _applyBuf.velocity.z = state.pendingVelocity.z or 0
    _applyBuf.jelly.velocity.x = state.jellyVelocity.x or 0
    _applyBuf.jelly.velocity.y = state.jellyVelocity.y or 0
    _applyBuf.jelly.velocity.z = state.jellyVelocity.z or 0
    _applyBuf.jelly.impact = state.jellyImpact
    _applyBuf.jelly.time = state.jellyTime
    _applyBuf.jelly.scale.x = state.jellyScale.x or 1
    _applyBuf.jelly.scale.y = state.jellyScale.y or 1
    _applyBuf.jelly.scale.z = state.jellyScale.z or 1
    _applyBuf.jelly.tilt = state.jellyTilt

    game.player.apply(_applyBuf)
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
