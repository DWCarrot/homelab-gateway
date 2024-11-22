local ngx = require "ngx"
local InetAddress = require "inetaddr"
local Proxy = require "wsproxy"

local MAP_MODE = {
    ["v4"] = InetAddress.MODE_IPV4,
    ["v6"] = InetAddress.MODE_IPV6,
    ["v4+"] = InetAddress.MODE_PREFER_IPV4,
    ["v6+"] = InetAddress.MODE_PREFER_IPV6,
}


local function parse()
    local uri = ngx.var.uri
    local base = ngx.var.location
    if not string.find(uri, base, 1, true) == 1 then
        return "invalid url: location not match"
    end
    local i = string.len(base) + 1
    local j = string.find(uri, "/", i, true)
    if not j then
        return "invalid url: no type"
    end
    local s_type = string.sub(uri, i, j - 1)
    if not Proxy.check(s_type) then
        return "invalid url: unknown type \"" .. s_type .. "\""
    end
    i = j + 1
    j = string.find(uri, "/", i, true)
    if not j then
        return "invalid url: no host"
    end
    local s_host = string.sub(uri, i, j - 1)
    local s_port = string.sub(uri, j + 1)
    local i_port = tonumber(s_port, 10)
    if not i_port then
        return "invalid url: invalid port \"" .. s_port .. "\""
    end
    if i_port < 0 or i_port > 65535 then
        return "invalid url: port out of range"
    end
    local args = ngx.req.get_uri_args()
    local mode = args["mode"]
    if mode then
        mode = MAP_MODE[mode]
    end
    local server_name = args["server_name"]
    local force_update = args["force_update"]
    if force_update then
        local v = tonumber(force_update, 16);
        if v then
            force_update = v > 0
        else
            force_update = (string.lower(force_update) == "true")
        end
    end
    return nil, s_type, s_host, i_port, mode, server_name, force_update
end

local err0, socket_type, host, port, mode, server_name, force_update = parse()
if not host then
    ngx.status = ngx.HTTP_BAD_REQUEST
    ngx.print(err0)
    return ngx.exit(ngx.OK)
end
ngx.log(ngx.DEBUG, "request: ", socket_type, " ", host, " ", port, " ", mode, " ", server_name)

local addr = InetAddress.new(host)
local ok, err1 = addr:resolve(mode, force_update)
if not ok then
    ngx.status = ngx.HTTP_BAD_REQUEST
    ngx.print(err1)
    return ngx.exit(ngx.OK)
end

if not Proxy.ipfilter:apply(addr) then
    ngx.status = ngx.HTTP_FORBIDDEN
    return ngx.exit(ngx.OK)
end

local proxy = Proxy.new()
local code, err = proxy:proxy(socket_type, addr, port, mode, server_name)

return ngx.exit(ngx.OK)