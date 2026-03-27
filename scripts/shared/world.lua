-- scripts/shared/world.lua

local World = {}

function World.init()
    print("Building space backdrop...")

    if game.createGround then
        game.createGround()
    end
end

return World
