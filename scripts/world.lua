-- scripts/world.lua

local World = {}

function World.init()
    print("Building base world...")

    if game.createGround then
        game.createGround()
    end
end

return World
