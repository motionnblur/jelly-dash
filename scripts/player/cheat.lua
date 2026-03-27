-- scripts/player/cheat.lua

local Cheat = {}

function Cheat.resetState(state)
    state.isGodMode = false
    state.isRocketBoy = false
end

function Cheat.handle(command, state)
    local normalized = string.lower(tostring(command or ""))

    if normalized == "godmode" then
        state.isGodMode = not state.isGodMode
        if game.logConsole then
            game.logConsole(
                "God Mode: " .. (state.isGodMode and "ENABLED" or "DISABLED")
            )
        end
        return true
    end

    if normalized == "rocketboy" then
        state.isRocketBoy = not state.isRocketBoy
        if state.isRocketBoy then
            state.rocketLevel = 1.0
        end
        if game.logConsole then
            game.logConsole(
                "Unlimited Fuel: " .. (state.isRocketBoy and "ENABLED" or "DISABLED")
            )
        end
        return true
    end

    if game.logConsole then
        game.logConsole("Unknown command: " .. normalized)
    end

    return false
end

return Cheat
