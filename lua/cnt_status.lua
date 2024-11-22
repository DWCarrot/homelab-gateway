local ngx = require "ngx"
local json = require "cjson.safe"
local status = require "status"
local cached_status = ngx.shared.cached_status

local function get_id()
    local key = "id"
    local id = cached_status:get(key)
    if id == nil then
        id = 1
    else
        id = id + 1
    end
    local ok, err, forcible = cached_status:set(key, id)
    if not ok then
        ngx.log(ngx.ERR, "failed to cache cached_status[", key, "] : ", err)
    end
    return id
end

local EMPTY_OBJECT = "{}"

local function get_object(key, gen, expires)
    local s = cached_status:get(key)
    if s == nil then
        local value = gen()
        if #value > 0 or next(value) ~= nil then
            value = {
                timestamp = ngx.now() * 1000,
                value = value,
            }
            s = json.encode(value)
            local ok, err, forcible = cached_status:set(key, s, expires)
            if not ok then
                ngx.log(ngx.ERR, "failed to cache cached_status[", key, "] : ", err)
            end
        else
            return EMPTY_OBJECT
        end
    end
    return s
end

local data = {
    "{", 
        "\"id\":", get_id(),
        ",\"payload\":", math.random(10000),
        ",\"memory\":", get_object("memory", status.get_memory_info, 10),
        ",\"temperature\":", get_object("temperature", status.get_temperature, 10),
        ",\"ip\":", get_object("ip", status.get_ip_addresses, 3600),
        ",\"disk\":", get_object("disk", status.get_disk_usage, 60),
        ",\"global\":", get_object("global", status.get_system_info, 10),
    "}"
}
ngx.print(data)